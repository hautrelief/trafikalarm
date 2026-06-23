import { requireDb } from "../_shared/auth.js";
import { sendEmail } from "../_shared/email.js";
import { json, optionsResponse } from "../_shared/http.js";
import { evaluateProfile, evaluateRoute } from "../_shared/traffic.js";

const ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;

  if (env.CRON_SECRET) {
    const supplied = request.headers.get("X-Cron-Secret") || "";
    if (supplied !== env.CRON_SECRET) return json({ error: "Manglende adgang til alarmtjek." }, 401);
  }

  const rows = await env.DB.prepare(
    "SELECT user_id, profile_json FROM profiles WHERE monitoring_enabled = 1 ORDER BY updated_at DESC LIMIT 200"
  ).all();

  let checked = 0;
  let sent = 0;
  const errors = [];

  for (const row of rows.results || []) {
    checked += 1;
    const profile = JSON.parse(row.profile_json);
    const email = profile.user && profile.user.email;
    if (!email) continue;

    const alerts = evaluateProfile(profile);
    for (const alert of alerts) {
      const strongest = [...alert.matches].sort((a, b) => b.delay - a.delay)[0];
      const routeOverview = await buildRouteOverview(profile, alert, env);
      const dedupeKey = `${row.user_id}:${alert.route.id}:${strongest.id}:${new Date().toISOString().slice(0, 13)}`;
      const alreadySent = await env.DB.prepare("SELECT id FROM alert_log WHERE dedupe_key = ?")
        .bind(dedupeKey)
        .first();
      if (alreadySent) continue;

      try {
        await sendEmail(env, {
          to: email,
          subject: `Rutealarm: ${strongest.roadName}`,
          text: makeAlertText(alert, strongest, routeOverview),
        });
        sent += 1;
        await env.DB.prepare("INSERT INTO alert_log (id, user_id, dedupe_key, sent_at) VALUES (?, ?, ?, ?)")
          .bind(crypto.randomUUID(), row.user_id, dedupeKey, new Date().toISOString())
          .run();
      } catch (error) {
        errors.push({ userId: row.user_id, message: error.message });
      }
    }
  }

  return json({ ok: true, checked, sent, errors });
}

async function buildRouteOverview(profile, alert, env) {
  const routes = profile.routes && Array.isArray(profile.routes[alert.direction]) ? profile.routes[alert.direction] : [];
  const evaluated = routes.map((route) => evaluateRoute(profile, route, alert.direction)).filter((result) => result.valid);
  const enriched = [];

  for (const result of evaluated.slice(0, 6)) {
    const google = await getGoogleTraffic(env, result.route.points || []);
    enriched.push({
      ...result,
      google,
      score: result.delay + (google && google.ok ? Math.round((google.delaySeconds || 0) / 60) : 0),
    });
  }

  const recommended = [...enriched].sort((a, b) => a.score - b.score || a.matches.length - b.matches.length)[0] || alert.best;
  return { routes: enriched, recommended };
}

function makeAlertText(alert, strongest, overview) {
  const routeName = alert.route.name || "din rute";
  const direction = alert.direction === "work" ? "Til arbejde" : "Hjem";
  const recommended = overview.recommended && overview.recommended.route
    ? overview.recommended.route.name || "alternativ rute"
    : routeName;
  const routeLines = overview.routes.length
    ? overview.routes.map(formatRouteOverview).join("\n\n")
    : "Ingen øvrige ruter kunne vurderes.";

  return `${strongest.type}: ${strongest.title}

Rute: ${routeName}
Retning: ${direction}
Forventet ekstra tid: ca. ${strongest.delay} minutter
Kilde: ${strongest.source}
Aktiv periode: ${strongest.window}

Anbefalet rute lige nu:
${recommended}

Ruteoverblik:
${routeLines}

Du kan ændre eller slå dine alarmer fra ved at logge ind i Rutealarm.`;
}

function formatRouteOverview(result) {
  const routeName = result.route.name || "Unavngiven rute";
  const alertText = result.matches.length
    ? result.matches
        .map((event) => `- ${event.type}: ${event.roadName}, ca. ${event.delay} min (${event.source}, aktiv ${event.window})`)
        .join("\n")
    : "- Ingen matchende varsler på denne rute.";
  return `${routeName}
${formatGoogleTraffic(result.google)}
Varsler:
${alertText}`;
}

function formatGoogleTraffic(google) {
  if (!google) return "Google-rejsetid: Ikke slået til.";
  if (!google.ok) return `Google-rejsetid: ${google.message || "Kunne ikke hentes."}`;
  const durationMinutes = Math.round((google.durationSeconds || 0) / 60);
  const delayMinutes = Math.round((google.delaySeconds || 0) / 60);
  const distanceKm = ((google.distanceMeters || 0) / 1000).toFixed(1).replace(".", ",");
  const level = google.trafficLevel === "heavy"
    ? "unormalt meget trafik"
    : google.trafficLevel === "moderate"
      ? "mere trafik end normalt"
      : "normal trafik";
  return `Google-rejsetid: ${durationMinutes} min, ${distanceKm} km, ${level}${delayMinutes ? `, ca. ${delayMinutes} min ekstra` : ""}.`;
}

async function getGoogleTraffic(env, points) {
  if (!env.GOOGLE_MAPS_API_KEY) return null;
  const route = (points || []).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (route.length < 2) return { ok: false, message: "Ruten har for få punkter." };

  try {
    const response = await fetch(ROUTES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters,routes.travelAdvisory.speedReadingIntervals",
      },
      body: JSON.stringify({
        origin: googleWaypoint(route[0]),
        destination: googleWaypoint(route[route.length - 1]),
        intermediates: route.slice(1, -1).slice(0, 8).map((point) => ({ ...googleWaypoint(point), via: true })),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE_OPTIMAL",
        departureTime: new Date().toISOString(),
        computeAlternativeRoutes: false,
        units: "METRIC",
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, message: result.error && result.error.message ? result.error.message : "Google Routes svarede ikke." };
    }
    const googleRoute = result.routes && result.routes[0];
    if (!googleRoute) return { ok: false, message: "Google fandt ingen rute." };
    const durationSeconds = parseGoogleDuration(googleRoute.duration);
    const staticDurationSeconds = parseGoogleDuration(googleRoute.staticDuration);
    const delaySeconds = Math.max(0, durationSeconds - staticDurationSeconds);
    const speedIntervals = googleRoute.travelAdvisory && Array.isArray(googleRoute.travelAdvisory.speedReadingIntervals)
      ? googleRoute.travelAdvisory.speedReadingIntervals
      : [];
    return {
      ok: true,
      distanceMeters: googleRoute.distanceMeters || 0,
      durationSeconds,
      staticDurationSeconds,
      delaySeconds,
      trafficLevel: classifyTraffic(delaySeconds, durationSeconds, speedIntervals),
    };
  } catch (error) {
    return { ok: false, message: error.message || "Google-kald fejlede." };
  }
}

function googleWaypoint(point) {
  return {
    location: {
      latLng: {
        latitude: point.lat,
        longitude: point.lng,
      },
    },
  };
}

function parseGoogleDuration(value) {
  const match = String(value || "0s").match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Math.round(Number(match[1])) : 0;
}

function classifyTraffic(delaySeconds, durationSeconds, speedIntervals) {
  const jamCount = speedIntervals.filter((interval) => interval.speed === "TRAFFIC_JAM").length;
  const slowCount = speedIntervals.filter((interval) => interval.speed === "SLOW").length;
  const delayRatio = durationSeconds > 0 ? delaySeconds / durationSeconds : 0;
  if (jamCount || delaySeconds >= 15 * 60 || delayRatio >= 0.25) return "heavy";
  if (slowCount || delaySeconds >= 6 * 60 || delayRatio >= 0.12) return "moderate";
  return "normal";
}
