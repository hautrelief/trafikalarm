import { requireDb } from "../_shared/auth.js";
import { sendEmail } from "../_shared/email.js";
import { json, optionsResponse } from "../_shared/http.js";
import { evaluateProfile, evaluateRoute, inferDirections } from "../_shared/traffic.js";
import { fetchTrafficEvents } from "../_shared/traffic-events.js";
import { getTomTomRouteTraffic } from "../_shared/tomtom-traffic.js";

const GOOGLE_ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;

  if (env.CRON_SECRET) {
    const supplied = request.headers.get("X-Cron-Secret") || "";
    if (!(await secretsMatch(supplied, env.CRON_SECRET))) return json({ error: "Manglende adgang til alarmtjek." }, 401);
  }

  const rows = await env.DB.prepare(
    "SELECT user_id, profile_json FROM profiles WHERE monitoring_enabled = 1 ORDER BY updated_at DESC LIMIT 200"
  ).all();

  let checked = 0;
  let sent = 0;
  const errors = [];
  let trafficEvents = [];
  const now = new Date();

  try {
    const trafficResult = await fetchTrafficEvents(env);
    trafficEvents = trafficResult.events;
  } catch (error) {
    errors.push({ source: "traffic-events", message: error.message || "Trafikkilden kunne ikke hentes." });
  }

  for (const row of rows.results || []) {
    try {
      checked += 1;
      const profile = JSON.parse(row.profile_json);
      const email = profile.user && profile.user.email;
      if (!email) continue;
      const liveTrafficMemo = new Map();

      const alerts = evaluateProfile(profile, now, trafficEvents);
      const sentOfficialRouteIds = new Set();
      for (const alert of alerts) {
        const strongest = [...alert.matches].sort((a, b) => b.delay - a.delay)[0];
        const routeOverview = await buildRouteOverview(profile, alert, env, trafficEvents, liveTrafficMemo);
        const dedupeKey = `${row.user_id}:${alert.direction}:${alert.route.id}:${strongest.id}:${new Date().toISOString().slice(0, 13)}`;
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
          sentOfficialRouteIds.add(`${alert.direction}:${alert.route.id}`);
        } catch (error) {
          errors.push({ userId: row.user_id, message: error.message });
        }
      }

      const googleTrafficAlerts = await buildLiveTrafficAlerts(profile, now, env, trafficEvents, sentOfficialRouteIds, liveTrafficMemo);
      for (const googleTrafficAlert of googleTrafficAlerts) {
        const dedupeKey = `${row.user_id}:live-traffic-heavy:${googleTrafficAlert.direction}:${googleTrafficAlert.strongest.route.id}:${new Date().toISOString().slice(0, 13)}`;
        const alreadySent = await env.DB.prepare("SELECT id FROM alert_log WHERE dedupe_key = ?")
          .bind(dedupeKey)
          .first();
        if (!alreadySent) {
          try {
            await sendEmail(env, {
              to: email,
              subject: `Rutealarm: Unormalt meget trafik på ${googleTrafficAlert.strongest.route.name || "din rute"}`,
              text: makeLiveTrafficAlertText(googleTrafficAlert),
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
    } catch (error) {
      errors.push({ userId: row.user_id, message: error.message || "Profilens alarmtjek fejlede." });
    }
  }

  return json({ ok: true, checked, sent, errors });
}

async function buildLiveTrafficAlerts(profile, now, env, trafficEvents, skippedRouteIds = new Set(), memo = new Map()) {
  if (!env.TOMTOM_API_KEY && !env.GOOGLE_MAPS_API_KEY) return [];
  const directions = inferDirections(profile, now);
  const alerts = [];

  for (const direction of directions) {
    const routes = profile.routes && Array.isArray(profile.routes[direction]) ? profile.routes[direction] : [];
    const evaluated = routes.map((route) => evaluateRoute(profile, route, direction, trafficEvents)).filter((result) => result.valid);
    if (!evaluated.length) continue;

    const enriched = [];
    for (const result of evaluated.slice(0, 6)) {
      const liveTraffic = await getLiveTraffic(env, result.route.points || [], memo);
      enriched.push({
        ...result,
        liveTraffic,
        score: result.delay + (liveTraffic && liveTraffic.ok ? Math.round((liveTraffic.delaySeconds || 0) / 60) : 0),
      });
    }

    const heavyRoutes = enriched.filter((result) =>
      !skippedRouteIds.has(`${direction}:${result.route.id}`) &&
      result.liveTraffic &&
      result.liveTraffic.ok &&
      ["heavy", "severe", "closed"].includes(result.liveTraffic.trafficLevel)
    );
    if (!heavyRoutes.length) continue;

    const strongest = [...heavyRoutes].sort((a, b) =>
      trafficSeverity(b.liveTraffic.trafficLevel) - trafficSeverity(a.liveTraffic.trafficLevel) ||
      (b.liveTraffic.delaySeconds || 0) - (a.liveTraffic.delaySeconds || 0)
    )[0];
    const recommended = [...enriched].sort((a, b) => a.score - b.score || a.matches.length - b.matches.length)[0] || strongest;

    alerts.push({
      direction,
      strongest,
      overview: {
        routes: enriched,
        recommended,
      },
    });
  }

  return alerts;
}

async function secretsMatch(provided, expected) {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const providedBytes = new Uint8Array(providedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  if (providedBytes.length !== expectedBytes.length) return false;

  let diff = 0;
  for (let index = 0; index < providedBytes.length; index += 1) {
    diff |= providedBytes[index] ^ expectedBytes[index];
  }
  return diff === 0;
}

async function buildRouteOverview(profile, alert, env, trafficEvents, memo = new Map()) {
  const routes = profile.routes && Array.isArray(profile.routes[alert.direction]) ? profile.routes[alert.direction] : [];
  const evaluated = routes.map((route) => evaluateRoute(profile, route, alert.direction, trafficEvents)).filter((result) => result.valid);
  const enriched = [];

  for (const result of evaluated.slice(0, 6)) {
    const liveTraffic = await getLiveTraffic(env, result.route.points || [], memo);
    enriched.push({
      ...result,
      liveTraffic,
      score: result.delay + (liveTraffic && liveTraffic.ok ? Math.round((liveTraffic.delaySeconds || 0) / 60) : 0),
    });
  }

  const recommended = [...enriched].sort((a, b) => a.score - b.score || a.matches.length - b.matches.length)[0] || alert.best;
  return { routes: enriched, recommended };
}

function makeAlertText(alert, strongest, overview) {
  const routeName = alert.route.name || "din rute";
  const direction = alert.direction === "work" ? "Fra" : "Til";
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

function makeLiveTrafficAlertText(alert) {
  const routeName = alert.strongest.route.name || "din rute";
  const direction = alert.direction === "work" ? "Fra" : "Til";
  const delayMinutes = Math.round((alert.strongest.liveTraffic.delaySeconds || 0) / 60);
  const recommended = alert.overview.recommended && alert.overview.recommended.route
    ? alert.overview.recommended.route.name || "alternativ rute"
    : routeName;
  const routeLines = alert.overview.routes.length
    ? alert.overview.routes.map(formatRouteOverview).join("\n\n")
    : "Ingen øvrige ruter kunne vurderes.";
  const provider = alert.strongest.liveTraffic.provider || "Google Maps Platform";

  return `${provider} melder unormalt meget trafik.

Rute: ${routeName}
Retning: ${direction}
Forventet ekstra tid: ca. ${delayMinutes} minutter
Kilde: ${provider}

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
${formatLiveTraffic(result.liveTraffic)}
Varsler:
${alertText}`;
}

function formatLiveTraffic(liveTraffic) {
  if (!liveTraffic) return "Live trafik: Ikke slået til.";
  if (!liveTraffic.ok) return `Live trafik: ${liveTraffic.message || "Kunne ikke hentes."}`;
  const delayMinutes = Math.round((liveTraffic.delaySeconds || 0) / 60);
  const level = {
    closed: "mulig vejlukning",
    severe: "kraftig kø",
    heavy: "unormalt meget trafik",
    moderate: "mere trafik end normalt",
    normal: "normal trafik",
  }[liveTraffic.trafficLevel] || "ukendt trafikniveau";

  if (liveTraffic.provider === "Google Maps Platform") {
    const durationMinutes = Math.round((liveTraffic.durationSeconds || 0) / 60);
    const distanceKm = Number.isFinite(liveTraffic.distanceMeters)
      ? `, ${((liveTraffic.distanceMeters || 0) / 1000).toFixed(1).replace(".", ",")} km`
      : "";
    return `Google Maps Platform: ${level}, ${durationMinutes} min rejsetid${distanceKm}${delayMinutes ? `, ca. ${delayMinutes} min ekstra` : ""}.`;
  }

  const speed = Number.isFinite(liveTraffic.currentSpeed) && Number.isFinite(liveTraffic.freeFlowSpeed)
    ? `, ${Math.round(liveTraffic.currentSpeed)} km/t mod normalt ${Math.round(liveTraffic.freeFlowSpeed)} km/t`
    : "";
  return `${liveTraffic.provider || "TomTom Traffic"}: ${level}${speed}${delayMinutes ? `, mindst ca. ${delayMinutes} min ekstra` : ""}.`;
}

async function getLiveTraffic(env, points, memo) {
  const key = (points || [])
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    .map((point) => `${Number(point.lat).toFixed(4)},${Number(point.lng).toFixed(4)}`)
    .join(";");
  if (memo.has(key)) return memo.get(key);
  try {
    const result = await getGoogleTrafficWithTomTomFallback(env, points);
    memo.set(key, result);
    return result;
  } catch (error) {
    const result = { ok: false, message: error.message || "Live trafik-kald fejlede." };
    memo.set(key, result);
    return result;
  }
}

async function getGoogleTrafficWithTomTomFallback(env, points) {
  const google = await getGoogleTraffic(env, points);
  if (google && google.ok) return google;
  if (!env.TOMTOM_API_KEY) return google || { ok: false, disabled: true, message: "GOOGLE_MAPS_API_KEY mangler i Cloudflare." };

  const tomtom = await getTomTomRouteTraffic(env, points, { maxSamples: 1 });
  if (tomtom && tomtom.ok) {
    return {
      ...tomtom,
      fallbackFrom: google && google.provider ? google.provider : "Google Maps Platform",
    };
  }
  return google || tomtom;
}

async function getGoogleTraffic(env, points) {
  if (!env.GOOGLE_MAPS_API_KEY) return null;
  const route = (points || []).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (route.length < 2) return { ok: false, message: "Ruten har for få punkter." };

  const response = await fetch(GOOGLE_ROUTES_ENDPOINT, {
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
    return { ok: false, provider: "Google Maps Platform", message: result.error?.message || "Google Routes svarede ikke." };
  }
  const googleRoute = result.routes && result.routes[0];
  if (!googleRoute) return { ok: false, provider: "Google Maps Platform", message: "Google fandt ingen rute." };
  const durationSeconds = parseGoogleDuration(googleRoute.duration);
  const staticDurationSeconds = parseGoogleDuration(googleRoute.staticDuration);
  const delaySeconds = Math.max(0, durationSeconds - staticDurationSeconds);
  const speedIntervals = googleRoute.travelAdvisory?.speedReadingIntervals || [];
  return {
    ok: true,
    provider: "Google Maps Platform",
    distanceMeters: googleRoute.distanceMeters || 0,
    durationSeconds,
    delaySeconds,
    trafficLevel: classifyGoogleTraffic(delaySeconds, durationSeconds, speedIntervals),
  };
}

function googleWaypoint(point) {
  return { location: { latLng: { latitude: point.lat, longitude: point.lng } } };
}

function parseGoogleDuration(value) {
  const match = String(value || "0s").match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Math.round(Number(match[1])) : 0;
}

function classifyGoogleTraffic(delaySeconds, durationSeconds, speedIntervals) {
  const jamCount = speedIntervals.filter((interval) => interval.speed === "TRAFFIC_JAM").length;
  const slowCount = speedIntervals.filter((interval) => interval.speed === "SLOW").length;
  const delayRatio = durationSeconds > 0 ? delaySeconds / durationSeconds : 0;
  if (jamCount || delaySeconds >= 15 * 60 || delayRatio >= 0.25) return "heavy";
  if (slowCount || delaySeconds >= 6 * 60 || delayRatio >= 0.12) return "moderate";
  return "normal";
}

function trafficSeverity(level) {
  return { unknown: 0, normal: 1, moderate: 2, heavy: 3, severe: 4, closed: 5 }[level] || 0;
}
