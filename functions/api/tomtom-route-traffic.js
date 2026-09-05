import { json, optionsResponse, readJson } from "../_shared/http.js";
import { consumeRateLimit, getTomTomRouteTraffic } from "../_shared/tomtom-traffic.js";

const DEFAULT_MINUTE_LIMIT = 5;

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.TOMTOM_API_KEY) {
      return json({ ok: false, disabled: true, message: "TOMTOM_API_KEY mangler i Cloudflare." });
    }
    if (!env.DB) {
      return json({ ok: false, disabled: true, message: "D1-databasen mangler, så TomTom-kald er midlertidigt slået fra." }, 503);
    }

    const minuteLimit = positiveInt(env.TOMTOM_MINUTE_LIMIT, DEFAULT_MINUTE_LIMIT);
    const now = new Date();
    const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
    const rateLimit = await consumeRateLimit(env, {
      bucket: "tomtom-route-minute",
      key: `${now.toISOString().slice(0, 16)}:${ip}`,
      limit: minuteLimit,
      resetAt: new Date(Math.ceil(now.getTime() / 60000) * 60000),
    });
    if (!rateLimit.allowed) {
      return json({ error: "Der er lavet for mange TomTom-tjek på kort tid.", retryAfter: rateLimit.retryAfter }, 429);
    }

    const payload = await readJson(request);
    const result = await getTomTomRouteTraffic(env, payload && payload.points, {
      maxSamples: env.TOMTOM_ROUTE_SAMPLE_LIMIT,
    });
    if (!result.ok && result.rateLimited) return json(result, 429);
    if (!result.ok && !result.disabled) return json(result, 502);
    return json(result);
  } catch (error) {
    return json({ error: `TomTom-trafik fejlede: ${error.message || "Ukendt serverfejl."}` }, 500);
  }
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
