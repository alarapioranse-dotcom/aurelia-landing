const ALLOWED_ORIGINS = [
  "https://bys-store-3284974-447163.myshopify.com",
  "https://aurelia-beauty.netlify.app",
];

// حد أقصى لحجم الطلب لمنع إساءة الاستخدام (بالحروف)
const MAX_BODY_CHARS = 8000;

exports.handler = async (event) => {
  const origin = event.headers && (event.headers.origin || event.headers.Origin);
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  const corsHeaders = {
    "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };

  // طلب فحص CORS المسبق
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  // ارفض أي مصدر غير مسموح قبل استهلاك مفتاح الـ API
  if (!isAllowed) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Forbidden" }),
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // ارفض الطلبات الضخمة
  if (event.body && event.body.length > MAX_BODY_CHARS) {
    return {
      statusCode: 413,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Payload too large" }),
    };
  }

  try {
    const { messages, max_tokens } = JSON.parse(event.body || "{}");

    if (!Array.isArray(messages) || messages.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "messages must be a non-empty array" }),
      };
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: Math.min(max_tokens || 1000, 3000),
        messages,
      }),
    });

    const data = await response.json();

    return {
      statusCode: response.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Proxy error" }),
    };
  }
};
