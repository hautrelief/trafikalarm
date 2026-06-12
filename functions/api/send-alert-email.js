import { sendEmail } from "../_shared/email.js";
import { isEmail, json, optionsResponse, readJson } from "../_shared/http.js";

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  const payload = await readJson(request);
  if (!payload || !isEmail(payload.to) || !payload.subject || !payload.text) {
    return json({ error: "Ugyldig mailforespørgsel." }, 400);
  }

  try {
    const result = await sendEmail(env, {
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
    });
    return json({ ok: true, id: result.id });
  } catch (error) {
    return json({ error: error.message || "Mail kunne ikke sendes." }, 500);
  }
}
