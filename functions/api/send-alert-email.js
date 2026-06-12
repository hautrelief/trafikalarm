const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.RESEND_API_KEY) {
    return json({ error: "RESEND_API_KEY mangler i Cloudflare." }, 500);
  }

  const payload = await request.json().catch(() => null);
  if (!payload || !isEmail(payload.to) || !payload.subject || !payload.text) {
    return json({ error: "Ugyldig mailforespørgsel." }, 400);
  }

  const from = env.ALERT_FROM || "Trafikalarm <onboarding@resend.dev>";
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: payload.to,
      subject: payload.subject.slice(0, 180),
      text: payload.text,
      reply_to: env.ALERT_REPLY_TO || undefined,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return json({ error: result.message || "Mail kunne ikke sendes." }, response.status);
  }

  return json({ ok: true, id: result.id });
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
