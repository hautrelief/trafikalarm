const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendEmail(env, payload) {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY mangler i Cloudflare.");
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
      subject: String(payload.subject || "").slice(0, 180),
      text: payload.text,
      reply_to: env.ALERT_REPLY_TO || undefined,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || "Mail kunne ikke sendes.");
  }

  return result;
}
