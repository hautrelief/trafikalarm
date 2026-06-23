import { json, optionsResponse, readJson } from "../_shared/http.js";

const ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";
const DEFAULT_DAILY_LIMIT = 100;
const DEFAULT_MINUTE_LIMIT = 5;

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  try {
    return await handleRequest(request, env);
  } catch (error) {
    return json({ error: `Google-rejsetid fejlede: ${error.message || "Ukendt serverfejl."}` }, 500);
  }
}

async function handleRequest(request, env) {
  if (!env.GOOGLE_MAPS_API_KEY) {
    return json({ ok: false, disabled: true, message: "GOOGLE_MAPS_API_KEY mangler i Cloudflare." });
  }

  const limitError = await enforceGoogleRateLimit(request, env);
  if (limitError) return limitError;

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

async function enforceGoogleRateLimit(request, env) {
  if (!env.DB) {
    return json({ error: "D1-databasen mangler, så Google-kald er midlertidigt slået fra." }, 503);
  }

  const now = new Date();
  const dailyLimit = positiveInt(env.GOOGLE_DAILY_LIMIT, DEFAULT_DAILY_LIMIT);
  const minuteLimit = positiveInt(env.GOOGLE_MINUTE_LIMIT, DEFAULT_MINUTE_LIMIT);
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";

  const minuteError = await incrementLimit(env, {
    bucket: "google-routes-minute",
    key: `${minuteKey(now)}:${ip}`,
    limit: minuteLimit,
    resetAt: nextMinute(now),
    error: `Der er lavet for mange Google-tjek på kort tid. Prøv igen om lidt.`,
  });
  if (minuteError) return minuteError;

  return incrementLimit(env, {
    bucket: "google-routes-day",
    key: dayKey(now),
    limit: dailyLimit,
    resetAt: nextDay(now),
    error: `Dagens Google-grænse på ${dailyLimit} kald er nået.`,
  });
}

async function incrementLimit(env, options) {
  try {
    const nowIso = new Date().toISOString();
    const existing = await env.DB.prepare(
      "SELECT count, reset_at FROM google_rate_limits WHERE bucket = ? AND key = ?"
    )
      .bind(options.bucket, options.key)
      .first();

    const expired = !existing || new Date(existing.reset_at).getTime() <= Date.now();
    const count = expired ? 1 : Number(existing.count || 0) + 1;
    const resetAt = expired ? options.resetAt.toISOString() : existing.reset_at;

    if (count > options.limit) {
      return json({ error: options.error, retryAfter: resetAt }, 429);
    }

    await env.DB.prepare(
      `INSERT INTO google_rate_limits (bucket, key, count, reset_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(bucket, key) DO UPDATE SET
         count = excluded.count,
         reset_at = excluded.reset_at,
         updated_at = excluded.updated_at`
    )
      .bind(options.bucket, options.key, count, resetAt, nowIso)
      .run();

    return null;
  } catch (error) {
    return json({ error: `Google rate limit-tabellen mangler eller fejlede. Kør migrations/0002_google_rate_limits.sql i D1. (${error.message})` }, 500);
  }
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function minuteKey(date) {
  return date.toISOString().slice(0, 16);
}

function nextDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

function nextMinute(date) {
  return new Date(Math.ceil(date.getTime() / 60000) * 60000);
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
