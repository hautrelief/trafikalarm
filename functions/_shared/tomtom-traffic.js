const FLOW_SEGMENT_ENDPOINT = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json";
const DEFAULT_ROUTE_SAMPLES = 3;
const MAX_ROUTE_SAMPLES = 6;
const DEFAULT_DAILY_SAMPLE_LIMIT = 600;

const LEVEL_PRIORITY = {
  unknown: 0,
  normal: 1,
  moderate: 2,
  heavy: 3,
  severe: 4,
  closed: 5,
};

export async function getTomTomRouteTraffic(env, points, options = {}) {
  if (!env.TOMTOM_API_KEY) {
    return { ok: false, disabled: true, message: "TOMTOM_API_KEY mangler i Cloudflare." };
  }
  if (!env.DB) {
    return { ok: false, disabled: true, message: "D1-databasen mangler, så TomTom-kald er midlertidigt slået fra." };
  }

  const route = (points || []).filter(isPoint);
  if (route.length < 2) {
    return { ok: false, message: "Ruten skal have mindst to punkter." };
  }

  const maxSamples = clampPositiveInt(options.maxSamples, DEFAULT_ROUTE_SAMPLES, MAX_ROUTE_SAMPLES);
  const samples = selectRouteSamples(route, maxSamples);
  const segments = [];
  const errors = [];

  for (const point of samples) {
    const budget = await consumeRateLimit(env, {
      bucket: "tomtom-flow-day",
      key: new Date().toISOString().slice(0, 10),
      limit: positiveInt(env.TOMTOM_DAILY_SAMPLE_LIMIT, DEFAULT_DAILY_SAMPLE_LIMIT),
      resetAt: nextUtcDay(),
    });

    if (!budget.allowed) {
      errors.push({ message: `Dagens TomTom-budget er nået.`, retryAfter: budget.retryAfter });
      break;
    }

    try {
      segments.push(await fetchFlowSegment(env.TOMTOM_API_KEY, point, options.fetcher || fetch));
    } catch (error) {
      errors.push({ message: error.message || "TomTom-kald fejlede." });
    }
  }

  if (!segments.length) {
    return {
      ok: false,
      rateLimited: errors.some((error) => error.retryAfter),
      retryAfter: errors.find((error) => error.retryAfter)?.retryAfter,
      message: errors[0]?.message || "TomTom returnerede ingen trafikdata.",
    };
  }

  return aggregateRouteTraffic(segments, samples.length, errors);
}

export async function consumeRateLimit(env, options) {
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
    return { allowed: false, retryAfter: resetAt };
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

  return { allowed: true, retryAfter: resetAt };
}

export function selectRouteSamples(points, limit = DEFAULT_ROUTE_SAMPLES) {
  const route = (points || []).filter(isPoint);
  const sampleLimit = clampPositiveInt(limit, DEFAULT_ROUTE_SAMPLES, MAX_ROUTE_SAMPLES);
  if (route.length <= sampleLimit) return route.map(roundPoint);

  const selected = [];
  for (let index = 1; index <= sampleLimit; index += 1) {
    const routeIndex = Math.round((index * (route.length - 1)) / (sampleLimit + 1));
    selected.push(roundPoint(route[routeIndex]));
  }
  return dedupePoints(selected);
}

export function classifyCongestion(currentSpeed, freeFlowSpeed, roadClosure = false) {
  if (roadClosure) return "closed";
  if (!Number.isFinite(freeFlowSpeed) || freeFlowSpeed <= 0 || !Number.isFinite(currentSpeed)) return "unknown";
  const ratio = currentSpeed / freeFlowSpeed;
  if (ratio >= 0.8) return "normal";
  if (ratio >= 0.6) return "moderate";
  if (ratio >= 0.35) return "heavy";
  return "severe";
}

export function aggregateRouteTraffic(segments, requestedSamples = segments.length, errors = []) {
  const valid = (segments || []).filter((segment) => segment && segment.trafficLevel);
  const average = (field) => {
    const values = valid.map((segment) => segment[field]).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const trafficLevel = valid.reduce(
    (worst, segment) => LEVEL_PRIORITY[segment.trafficLevel] > LEVEL_PRIORITY[worst] ? segment.trafficLevel : worst,
    "unknown"
  );

  return {
    ok: true,
    provider: "TomTom Traffic",
    trafficLevel,
    currentSpeed: roundNullable(average("currentSpeed")),
    freeFlowSpeed: roundNullable(average("freeFlowSpeed")),
    ratio: roundNullable(average("ratio"), 3),
    currentTravelTime: sumField(valid, "currentTravelTime"),
    freeFlowTravelTime: sumField(valid, "freeFlowTravelTime"),
    delaySeconds: valid.reduce(
      (sum, segment) => sum + Math.max(0, Number(segment.currentTravelTime || 0) - Number(segment.freeFlowTravelTime || 0)),
      0
    ),
    confidence: roundNullable(average("confidence"), 2),
    roadClosure: valid.some((segment) => segment.roadClosure),
    congestedSegments: valid.filter((segment) => LEVEL_PRIORITY[segment.trafficLevel] >= LEVEL_PRIORITY.heavy).length,
    sampleCount: valid.length,
    requestedSamples,
    partial: valid.length < requestedSamples,
    errors: errors.map((error) => error.message),
    segments: valid,
    checkedAt: new Date().toISOString(),
  };
}

async function fetchFlowSegment(apiKey, point, fetcher) {
  const url = new URL(FLOW_SEGMENT_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("point", `${point.lat},${point.lng}`);
  url.searchParams.set("unit", "kmph");

  const response = await fetcher(url, {
    headers: { Accept: "application/json" },
    cf: { cacheEverything: true, cacheTtl: 60 },
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const upstreamMessage = body.detailedError && body.detailedError.message;
    if (response.status === 429) throw new Error("TomToms kaldgrænse er nået. Prøv igen senere.");
    throw new Error(upstreamMessage || `TomTom svarede med status ${response.status}.`);
  }

  const data = body.flowSegmentData;
  if (!data || !Number.isFinite(Number(data.currentSpeed))) {
    throw new Error("TomTom returnerede ikke gyldige segmentdata.");
  }

  const currentSpeed = Number(data.currentSpeed);
  const freeFlowSpeed = Number(data.freeFlowSpeed);
  const roadClosure = Boolean(data.roadClosure);
  return {
    point,
    roadClass: data.frc || null,
    currentSpeed,
    freeFlowSpeed,
    currentTravelTime: finiteOrNull(data.currentTravelTime),
    freeFlowTravelTime: finiteOrNull(data.freeFlowTravelTime),
    confidence: finiteOrNull(data.confidence),
    roadClosure,
    ratio: freeFlowSpeed > 0 ? currentSpeed / freeFlowSpeed : null,
    trafficLevel: classifyCongestion(currentSpeed, freeFlowSpeed, roadClosure),
  };
}

function dedupePoints(points) {
  const seen = new Set();
  return points.filter((point) => {
    const key = `${point.lat},${point.lng}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function roundPoint(point) {
  return { lat: Math.round(point.lat * 10000) / 10000, lng: Math.round(point.lng * 10000) / 10000 };
}

function isPoint(point) {
  return Number.isFinite(point && point.lat) && Number.isFinite(point && point.lng) &&
    point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundNullable(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sumField(values, field) {
  return values.reduce((sum, value) => sum + (Number.isFinite(value[field]) ? value[field] : 0), 0);
}

function clampPositiveInt(value, fallback, maximum) {
  return Math.min(positiveInt(value, fallback), maximum);
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nextUtcDay() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}
