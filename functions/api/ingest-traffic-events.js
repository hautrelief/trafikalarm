import { requireDb } from "../_shared/auth.js";
import { json, optionsResponse, readJson } from "../_shared/http.js";
import { normalizeTrafficEvents } from "../_shared/traffic-events.js";

const DEFAULT_TTL_MINUTES = 180;

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;

  const ingestSecret = getEnv(env, "TRAFFIC_INGEST_SECRET");
  if (!ingestSecret) {
    return json({ error: "TRAFFIC_INGEST_SECRET mangler i Cloudflare Pages." }, 500);
  }

  const supplied = request.headers.get("X-Traffic-Ingest-Secret") || "";
  if (supplied !== ingestSecret) {
    return json({ error: "Manglende adgang til trafikindtag." }, 401);
  }

  const payload = await readJson(request);
  if (!payload) return json({ error: "Payload mangler eller er ikke JSON." }, 400);

  const source = payload.source || env.TRAFFIC_EVENTS_SOURCE || "Dataudveksleren";
  const events = normalizeTrafficEvents(payload.events || payload, source);
  if (!events.length) {
    return json({ error: "Ingen brugbare trafikhændelser i payload." }, 400);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const ttlMinutes = Number(env.TRAFFIC_EVENT_TTL_MINUTES || DEFAULT_TTL_MINUTES);
  const expiresAt = new Date(now.getTime() + Math.max(5, ttlMinutes) * 60 * 1000).toISOString();

  await env.DB.prepare("DELETE FROM traffic_events WHERE source = ? OR expires_at <= ?")
    .bind(source, nowIso)
    .run();

  const statements = events.slice(0, 500).map((event) => env.DB.prepare(
    `INSERT INTO traffic_events (id, event_json, source, lat, lng, road_name, severity, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       event_json = excluded.event_json,
       source = excluded.source,
       lat = excluded.lat,
       lng = excluded.lng,
       road_name = excluded.road_name,
       severity = excluded.severity,
       updated_at = excluded.updated_at,
       expires_at = excluded.expires_at`
  ).bind(
    event.id,
    JSON.stringify(event),
    source,
    event.lat,
    event.lng,
    event.roadName || "",
    event.severity || "low",
    nowIso,
    expiresAt
  ));

  await env.DB.batch(statements);

  return json({
    ok: true,
    stored: statements.length,
    source,
    expiresAt,
  });
}

function getEnv(env, name) {
  if (env[name]) return env[name];
  const match = Object.keys(env).find((key) => key.trim() === name);
  return match ? env[match] : "";
}
