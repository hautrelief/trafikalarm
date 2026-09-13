import { getSessionUser, requireDb } from "../_shared/auth.js";
import { json, optionsResponse, readJson } from "../_shared/http.js";

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env }) {
  const access = await requireAdmin(request, env);
  if (access.response) return access.response;

  const url = new URL(request.url);
  const totals = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM users) AS total_users,
       (SELECT COUNT(*) FROM profiles WHERE monitoring_enabled = 1) AS monitoring_users,
       (SELECT COUNT(*) FROM users WHERE created_at >= ?) AS recent_users`
  )
    .bind(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .first();

  if (url.searchParams.get("summary") === "1") {
    return noStoreJson({ ok: true, admin: true, totals: normalizeTotals(totals) });
  }

  const result = await env.DB.prepare(
    `SELECT
       users.id,
       users.email,
       users.name,
       users.created_at,
       users.updated_at,
       profiles.monitoring_enabled,
       profiles.updated_at AS profile_updated_at,
       COUNT(alert_log.id) AS alert_count,
       MAX(alert_log.sent_at) AS last_alert_at
     FROM users
     LEFT JOIN profiles ON profiles.user_id = users.id
     LEFT JOIN alert_log ON alert_log.user_id = users.id
     GROUP BY users.id, users.email, users.name, users.created_at, users.updated_at,
              profiles.monitoring_enabled, profiles.updated_at
     ORDER BY users.created_at DESC
     LIMIT 500`
  ).all();

  return noStoreJson({
    ok: true,
    admin: { email: access.user.email, name: access.user.name || "" },
    totals: normalizeTotals(totals),
    users: (result.results || []).map(normalizeUser),
  });
}

export async function onRequestPatch({ request, env }) {
  const access = await requireAdmin(request, env);
  if (access.response) return access.response;

  const payload = await readJson(request);
  const userId = String(payload?.userId || "").trim();
  const action = String(payload?.action || "").trim();
  if (!userId) return noStoreJson({ error: "Brugeren mangler." }, 400);

  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
  if (!target) return noStoreJson({ error: "Brugeren findes ikke længere." }, 404);

  if (action === "setMonitoring") {
    const enabled = payload?.enabled === true ? 1 : 0;
    const result = await env.DB.prepare("UPDATE profiles SET monitoring_enabled = ?, updated_at = ? WHERE user_id = ?")
      .bind(enabled, new Date().toISOString(), userId)
      .run();
    if (!result.meta?.changes) return noStoreJson({ error: "Brugeren har endnu ikke gemt en profil." }, 409);
    return noStoreJson({ ok: true, monitoringEnabled: Boolean(enabled) });
  }

  if (action === "revokeSessions") {
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
    return noStoreJson({ ok: true });
  }

  return noStoreJson({ error: "Ukendt handling." }, 400);
}

export async function onRequestDelete({ request, env }) {
  const access = await requireAdmin(request, env);
  if (access.response) return access.response;

  const payload = await readJson(request);
  const userId = String(payload?.userId || "").trim();
  if (!userId) return noStoreJson({ error: "Brugeren mangler." }, 400);
  if (userId === access.user.user_id) return noStoreJson({ error: "Du kan ikke slette din egen administratorkonto." }, 409);

  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
  if (!target) return noStoreJson({ error: "Brugeren findes ikke længere." }, 404);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM alert_log WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM profiles WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM login_codes WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);

  return noStoreJson({ ok: true });
}

async function requireAdmin(request, env) {
  const dbError = requireDb(env);
  if (dbError) return { response: dbError };

  const user = await getSessionUser(request, env);
  if (!user) return { response: noStoreJson({ error: "Log ind på Rutevarsling først." }, 401) };

  const adminEmails = String(env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!adminEmails.includes(String(user.email || "").toLowerCase())) {
    return { response: noStoreJson({ error: "Du har ikke administratoradgang." }, 403) };
  }

  return { user };
}

function normalizeTotals(row = {}) {
  return {
    totalUsers: Number(row.total_users || 0),
    monitoringUsers: Number(row.monitoring_users || 0),
    recentUsers: Number(row.recent_users || 0),
  };
}

function normalizeUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name || "",
    createdAt: row.created_at,
    lastSeenAt: row.updated_at,
    profileUpdatedAt: row.profile_updated_at || null,
    monitoringEnabled: Boolean(row.monitoring_enabled),
    alertCount: Number(row.alert_count || 0),
    lastAlertAt: row.last_alert_at || null,
  };
}

function noStoreJson(body, status = 200) {
  const response = json(body, status);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
