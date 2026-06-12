import { json } from "./http.js";

const SESSION_DAYS = 90;

export function requireDb(env) {
  if (!env.DB) {
    return json({ error: "D1-databasen mangler. Tilføj en DB-binding med navnet DB i Cloudflare Pages." }, 500);
  }
  return null;
}

export async function getSessionUser(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const session = await env.DB.prepare(
    `SELECT sessions.user_id, users.email, users.name
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ? AND sessions.expires_at > ?`
  )
    .bind(token, new Date().toISOString())
    .first();

  return session || null;
}

export async function createSession(env, userId) {
  const token = crypto.randomUUID() + "." + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, userId, expiresAt)
    .run();
  return token;
}

export function makeLoginCode() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
}
