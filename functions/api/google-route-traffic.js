import { json, optionsResponse, readJson } from "../_shared/http.js";

const ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  if (!env.GOOGLE_MAPS_API_KEY) {
    return json({ ok: false, disabled: true, message: "GOOGLE_MAPS_API_KEY mangler i Cloudflare." });
  }

  const payload = await readJson(request);
  const points = Array.isArray(payload && payload.points) ? payload.points.filter(isPoint) : [];
  if (points.length < 2) return json({ error: "Ruten skal have mindst to punkter." }, 400);

  const departureTime = normalizeDepartureTime(payload.departureTime);
  const body = {
    origin: waypoint(points[0]),
    destination: waypoint(points[points.length - 1]),
    intermediates: points.slice(1, -1).slice(0, 8).map((point) => ({ ...waypoint(point), via: true })),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE_OPTIMAL",
    departureTime,
    computeAlternativeRoutes: false,
    units: "METRIC",
  };

  const response = await fetch(ROUTES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters,routes.travelAdvisory.speedReadingIntervals",
    },
    body: JSON.stringify(body),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return json({ error: result.error && result.error.message ? result.error.message : "Google Routes svarede ikke." }, 502);
  }

  const route = result.routes && result.routes[0];
  if (!route) return json({ error: "Google fandt ingen rute." }, 502);

  const durationSeconds = parseGoogleDuration(route.duration);
  const staticDurationSeconds = parseGoogleDuration(route.staticDuration);
  const delaySeconds = Math.max(0, durationSeconds - staticDurationSeconds);
  const speedIntervals = route.travelAdvisory && Array.isArray(route.travelAdvisory.speedReadingIntervals)
    ? route.travelAdvisory.speedReadingIntervals
    : [];

  return json({
    ok: true,
    provider: "Google Maps Platform",
    departureTime,
    distanceMeters: route.distanceMeters || 0,
    durationSeconds,
    staticDurationSeconds,
    delaySeconds,
    trafficLevel: classifyTraffic(delaySeconds, durationSeconds, speedIntervals),
  });
}

function waypoint(point) {
  return {
    location: {
      latLng: {
        latitude: point.lat,
        longitude: point.lng,
      },
    },
  };
}

function isPoint(point) {
  return Number.isFinite(point && point.lat) && Number.isFinite(point && point.lng);
}

function normalizeDepartureTime(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime()) || date.getTime() < Date.now()) return new Date().toISOString();
  return date.toISOString();
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
