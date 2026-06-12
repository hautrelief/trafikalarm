import { createSession, requireDb } from "../_shared/auth.js";
import { isEmail, json, optionsResponse, readJson } from "../_shared/http.js";

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;

  const payload = await readJson(request);
  const email = String((payload && payload.email) || "").trim().toLowerCase();
  const code = String((payload && payload.code) || "").trim();
  if (!isEmail(email) || !/^\d{6}$/.test(code)) {
    return json({ error: "Mail eller kode er ikke gyldig." }, 400);
  }

  const login = await env.DB.prepare(
    `SELECT login_codes.id, users.id AS user_id, users.email, users.name
     FROM login_codes
     JOIN users ON users.id = login_codes.user_id
     WHERE users.email = ? AND login_codes.code = ? AND login_codes.expires_at > ? AND login_codes.used_at IS NULL
     ORDER BY login_codes.created_at DESC
     LIMIT 1`
  )
    .bind(email, code, new Date().toISOString())
    .first();

  if (!login) return json({ error: "Koden er forkert eller udløbet." }, 401);

  await env.DB.prepare("UPDATE login_codes SET used_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), login.id)
    .run();

  const sessionToken = await createSession(env, login.user_id);
  const profile = await env.DB.prepare("SELECT profile_json FROM profiles WHERE user_id = ?")
    .bind(login.user_id)
    .first();

  return json({
    ok: true,
    sessionToken,
    user: {
      id: login.user_id,
      email: login.email,
      name: login.name || "",
    },
    profile: profile ? JSON.parse(profile.profile_json) : null,
  });
}
