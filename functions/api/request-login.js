import { createSession, makeLoginCode, requireDb } from "../_shared/auth.js";
import { sendEmail } from "../_shared/email.js";
import { isEmail, json, optionsResponse, readJson } from "../_shared/http.js";

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;

  const payload = await readJson(request);
  const email = String((payload && payload.email) || "").trim().toLowerCase();
  const name = String((payload && payload.name) || "").trim();
  if (!isEmail(email)) return json({ error: "Skriv en gyldig mailadresse." }, 400);

  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`
  )
    .bind(userId, email, name, now, now)
    .run();

  const user = await env.DB.prepare("SELECT id, email, name FROM users WHERE email = ?")
    .bind(email)
    .first();

  const code = makeLoginCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO login_codes (id, user_id, code, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), user.id, code, expiresAt, now)
    .run();

  try {
    await sendEmail(env, {
      to: email,
      subject: "Din login-kode til Trafikalarm",
      text: `Din Trafikalarm-kode er ${code}\n\nKoden virker i 10 minutter. Hvis du ikke bad om den, kan du bare ignorere mailen.`,
    });
  } catch (error) {
    return json({ error: error.message || "Login-koden kunne ikke sendes via mail." }, 500);
  }

  if (env.AUTO_LOGIN_ON_REQUEST === "true") {
    return json({ ok: true, sessionToken: await createSession(env, user.id) });
  }

  return json({ ok: true });
}
