import { json, optionsResponse } from "../_shared/http.js";

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ env }) {
  const dbReady = await hasTrafficEventsTable(env);

  return json({
    ok: true,
    checks: {
      dbBinding: Boolean(env.DB),
      trafficEventsTable: dbReady,
      trafficIngestSecret: Boolean(env.TRAFFIC_INGEST_SECRET),
      trafficEventsSource: Boolean(env.TRAFFIC_EVENTS_SOURCE),
      googleMapsApiKey: Boolean(env.GOOGLE_MAPS_API_KEY),
      resendApiKey: Boolean(env.RESEND_API_KEY),
      alertFrom: Boolean(env.ALERT_FROM),
    },
    trafficEnvKeys: Object.keys(env)
      .filter((key) => key.toUpperCase().includes("TRAFFIC"))
      .sort(),
  });
}

async function hasTrafficEventsTable(env) {
  if (!env.DB) return false;
  try {
    await env.DB.prepare("SELECT 1 FROM traffic_events LIMIT 1").first();
    return true;
  } catch {
    return false;
  }
}
