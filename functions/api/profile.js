import { getSessionUser, requireDb } from "../_shared/auth.js";
import { json, optionsResponse, readJson } from "../_shared/http.js";

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;

  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "Log ind igen for at hente profilen." }, 401);

  const row = await env.DB.prepare("SELECT profile_json, updated_at FROM profiles WHERE user_id = ?")
    .bind(user.user_id)
    .first();

  return json({
    ok: true,
    user: { id: user.user_id, email: user.email, name: user.name || "" },
    profile: row ? JSON.parse(row.profile_json) : null,
    updatedAt: row ? row.updated_at : null,
  });
}

export async function onRequestPut({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;

  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "Log ind igen for at gemme profilen." }, 401);

  const payload = await readJson(request);
  const profile = payload && payload.profile;
  if (!profile || typeof profile !== "object") {
    return json({ error: "Profilen mangler." }, 400);
  }

  const savedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO profiles (user_id, profile_json, monitoring_enabled, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       profile_json = excluded.profile_json,
       monitoring_enabled = excluded.monitoring_enabled,
       updated_at = excluded.updated_at`
  )
    .bind(user.user_id, JSON.stringify(profile), hasEmailMonitoring(profile) ? 1 : 0, savedAt)
    .run();

  return json({ ok: true, savedAt });
}

function hasEmailMonitoring(profile) {
  return Boolean(profile.user && profile.user.email && profile.schedule && profile.schedule.channels && profile.schedule.channels.email);
}
