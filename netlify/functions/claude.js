// Aurelia chat proxy — Google Gemini backend.
// The response body keeps the same shape the widget already consumes:
// { content: [{ type: "text", text: "..." }] }

const ALLOWED_ORIGINS = [
  "https://bys-store-3284974-447163.myshopify.com",
  "https://aurelia-beauty.netlify.app",
];

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"]; // fallback order
const GEMINI_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const SYSTEM_PROMPT = `أنتِ "مساعدة أوريليا"، المساعدة الذكية لمتجر Aurelia — علامة تجميل وعناية شخصية فاخرة بطابع أسود وذهبي.
- خاطبي العميلات بصيغة المؤنث، بأسلوب دافئ وراقٍ.
- أجيبي عن أسئلة المنتجات (أبرزها قناع LED للوجه بتقنية العلاج الضوئي المنزلي، وأدوات عناية فاخرة أخرى)، وعن الشحن (شحن مجاني لجميع أنحاء العالم)، وعن كود الخصم WELCOME15 (خصم 15% على أول طلب).
- ردّي دائماً بنفس اللغة التي تكتب بها العميلة.
- لا تخترعي أبداً أسعاراً أو مستويات مخزون أو مواعيد شحن لا تعرفينها؛ اعتذري بلطف ووجّهي العميلة للتواصل عبر رسائل TikTok الخاصة.
- لا تقدمي أي ادعاءات طبية، واجعلي ردودكِ قصيرة (جملتان إلى أربع جمل).`;

const MAX_BODY_CHARS = 8000;
const MAX_MESSAGE_CHARS = 500;
const MAX_HISTORY_MESSAGES = 10;
const UPSTREAM_TIMEOUT_MS = 15000;

const FRIENDLY_ERROR = "عذراً، حدث خطأ مؤقت. حاولي مرة أخرى بعد قليل.";
const FRIENDLY_RATE_LIMIT = "وصلتِ إلى الحد الأقصى من الرسائل حالياً. حاولي مرة أخرى بعد قليل من فضلكِ ✦";
const FRIENDLY_TOO_LONG = "رسالتكِ طويلة جداً — من فضلكِ اختصريها إلى أقل من 500 حرف.";

// In-memory rate limiting (max 10 requests per IP per hour).
// NOTE: this Map lives in the function instance's memory, so it resets on
// every cold start and is not shared across concurrent instances. It is a
// soft limit / abuse speed bump, NOT a hard guarantee.
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const rateMap = new Map(); // ip -> [timestamps]

function isRateLimited(ip) {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;

  // Periodic cleanup of expired timestamps so the Map can't grow unbounded.
  if (rateMap.size > 500) {
    for (const [key, stamps] of rateMap) {
      const fresh = stamps.filter((t) => t > cutoff);
      if (fresh.length === 0) rateMap.delete(key);
      else rateMap.set(key, fresh);
    }
  }

  const stamps = (rateMap.get(ip) || []).filter((t) => t > cutoff);
  if (stamps.length >= RATE_LIMIT_MAX) {
    rateMap.set(ip, stamps);
    return true;
  }
  stamps.push(now);
  rateMap.set(ip, stamps);
  return false;
}

function reply(statusCode, corsHeaders, text, errorCode) {
  const body = { content: [{ type: "text", text }] };
  if (errorCode) body.error = errorCode;
  return {
    statusCode,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function callGemini(contents) {
  const requestBody = JSON.stringify({
    contents,
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
  });

  for (const model of GEMINI_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const res = await fetch(GEMINI_URL(model), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: requestBody,
        signal: controller.signal,
      });
      if (res.status === 404) {
        console.error(`Gemini model ${model} returned 404, trying fallback`);
        continue;
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }
  return null; // every model 404'd
}

exports.handler = async (event) => {
  const origin = event.headers && (event.headers.origin || event.headers.Origin);
  // CORS: exact-match allowlist only — no wildcards, no substring matching.
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  const corsHeaders = {
    ...(isAllowed ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };

  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  // Reject disallowed origins before touching the API key.
  if (!isAllowed) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Forbidden" }),
    };
  }

  // POST only.
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, "Allow": "POST, OPTIONS" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  if (event.body && event.body.length > MAX_BODY_CHARS) {
    return reply(413, corsHeaders, FRIENDLY_TOO_LONG, "payload_too_large");
  }

  const ip =
    (event.headers &&
      (event.headers["x-nf-client-connection-ip"] ||
        (event.headers["x-forwarded-for"] || "").split(",")[0].trim())) ||
    "unknown";
  if (isRateLimited(ip)) {
    return reply(429, corsHeaders, FRIENDLY_RATE_LIMIT, "rate_limited");
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set");
    return reply(500, corsHeaders, FRIENDLY_ERROR, "server_error");
  }

  let messages;
  try {
    ({ messages } = JSON.parse(event.body || "{}"));
  } catch {
    return reply(400, corsHeaders, FRIENDLY_ERROR, "invalid_json");
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return reply(400, corsHeaders, FRIENDLY_ERROR, "invalid_messages");
  }

  for (const m of messages) {
    if (
      !m ||
      (m.role !== "user" && m.role !== "assistant") ||
      typeof m.content !== "string" ||
      m.content.trim() === ""
    ) {
      return reply(400, corsHeaders, FRIENDLY_ERROR, "invalid_messages");
    }
    if (m.content.length > MAX_MESSAGE_CHARS) {
      return reply(400, corsHeaders, FRIENDLY_TOO_LONG, "message_too_long");
    }
  }

  // Cap conversation history at the last 10 messages.
  let recent = messages.slice(-MAX_HISTORY_MESSAGES);
  // Gemini expects the conversation to start with a user turn.
  while (recent.length && recent[0].role !== "user") recent.shift();
  if (recent.length === 0) {
    return reply(400, corsHeaders, FRIENDLY_ERROR, "invalid_messages");
  }

  const contents = recent.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  try {
    const res = await callGemini(contents);
    if (!res) {
      console.error("All Gemini models returned 404");
      return reply(502, corsHeaders, FRIENDLY_ERROR, "upstream_error");
    }

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      // Log upstream details server-side only — never forward them to the client.
      console.error("Gemini error", res.status, JSON.stringify(data).slice(0, 2000));
      return reply(502, corsHeaders, FRIENDLY_ERROR, "upstream_error");
    }

    const text =
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;

    if (typeof text !== "string" || text === "") {
      console.error("Gemini returned no text", JSON.stringify(data).slice(0, 2000));
      return reply(502, corsHeaders, FRIENDLY_ERROR, "upstream_error");
    }

    return reply(200, corsHeaders, text);
  } catch (err) {
    // Log server-side only; never expose stack traces or upstream bodies.
    if (err && err.name === "AbortError") {
      console.error("Gemini request timed out");
      return reply(504, corsHeaders, FRIENDLY_ERROR, "upstream_timeout");
    }
    console.error("Chat proxy error:", err);
    return reply(500, corsHeaders, FRIENDLY_ERROR, "server_error");
  }
};
