const DEFAULT_RADIUS_METERS = 600;

export async function fetchTrafficEvents(env) {
  const url = env.TRAFFIC_EVENTS_URL || env.VD_TRAFFIC_EVENTS_URL;
  if (!url) {
    return fetchStoredTrafficEvents(env);
  }

  const source = env.TRAFFIC_EVENTS_SOURCE || "Officiel trafikdata";
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Rutealarm/1.0",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Trafikkilden svarede med HTTP ${response.status}.`);
  }

  const payload = safeJson(text);
  if (!payload) throw new Error("Trafikkilden sendte ikke gyldig JSON.");

  return {
    configured: true,
    source,
    events: normalizeTrafficEvents(payload, source),
  };
}

export async function fetchStoredTrafficEvents(env) {
  const source = env.TRAFFIC_EVENTS_SOURCE || "Dataudveksleren";
  if (!env.DB) {
    return {
      configured: false,
      source,
      events: [],
      message: "Trafikdatabasen er ikke sat op endnu.",
    };
  }

  try {
    const rows = await env.DB.prepare(
      `SELECT event_json
       FROM traffic_events
       WHERE source = ? AND expires_at > ?
       ORDER BY updated_at DESC
       LIMIT 500`
    )
      .bind(source, new Date().toISOString())
      .all();

    return {
      configured: true,
      source,
      events: (rows.results || []).map((row) => safeJson(row.event_json)).filter(Boolean),
      message: rows.results && rows.results.length ? "" : "Der er endnu ikke modtaget trafikhændelser fra Dataudveksleren.",
    };
  } catch (error) {
    return {
      configured: false,
      source,
      events: [],
      message: "Trafikhændelsestabellen mangler. Kør migrations/0003_traffic_events.sql i D1.",
    };
  }
}

export function normalizeTrafficEvents(payload, defaultSource = "Officiel trafikdata") {
  const rawItems = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.events)
      ? payload.events
      : Array.isArray(payload.items)
        ? payload.items
        : Array.isArray(payload.results)
          ? payload.results
          : Array.isArray(payload.features)
            ? payload.features
            : [];

  return rawItems
    .map((item, index) => normalizeTrafficEvent(item, index, defaultSource))
    .filter(Boolean);
}

function normalizeTrafficEvent(item, index, defaultSource) {
  const properties = item && item.properties && typeof item.properties === "object" ? item.properties : item;
  const coordinates = extractCoordinates(item);
  if (!coordinates) return null;

  const delay = firstNumber(
    properties.delay,
    properties.delayMinutes,
    properties.duration,
    properties.expectedDelay,
    properties.estimatedDelayMinutes
  );
  const severity = normalizeSeverity(firstText(properties.severity, properties.level, properties.priority));

  return {
    id: String(firstText(properties.id, properties.identifier, properties.eventId, `official-event-${index}`)),
    lat: coordinates.lat,
    lng: coordinates.lng,
    roadName: firstText(properties.roadName, properties.road, properties.street, properties.vejnavn, properties.locationName, "Ukendt vej"),
    type: firstText(properties.type, properties.category, properties.eventType, properties.haendelsestype, "Trafikhændelse"),
    severity,
    delay: Number.isFinite(delay) ? Math.max(0, Math.round(delay)) : defaultDelayForSeverity(severity),
    title: firstText(properties.title, properties.description, properties.message, properties.summary, "Officiel trafikhændelse"),
    window: normalizeWindow(properties),
    source: firstText(properties.source, properties.provider, defaultSource),
    radiusMeters: firstNumber(properties.radiusMeters, properties.radius, properties.matchRadiusMeters) || DEFAULT_RADIUS_METERS,
  };
}

function extractCoordinates(item) {
  const geometry = item && item.geometry;
  if (geometry && Array.isArray(geometry.coordinates)) {
    const point = firstCoordinatePair(geometry.coordinates);
    if (point) return point;
  }

  const lat = firstNumber(item.lat, item.latitude, item.y, item.properties && item.properties.lat, item.properties && item.properties.latitude);
  const lng = firstNumber(item.lng, item.lon, item.longitude, item.x, item.properties && item.properties.lng, item.properties && item.properties.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

function firstCoordinatePair(value) {
  if (!Array.isArray(value)) return null;
  if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
    return { lng: Number(value[0]), lat: Number(value[1]) };
  }
  for (const child of value) {
    const result = firstCoordinatePair(child);
    if (result) return result;
  }
  return null;
}

function normalizeWindow(properties) {
  const explicit = firstText(properties.window, properties.timeWindow);
  if (explicit) return explicit;

  const start = firstText(properties.startTime, properties.start, properties.validFrom);
  const end = firstText(properties.endTime, properties.end, properties.validTo);
  if (!start || !end) return "00:00-23:59";
  return `${toClock(start)}-${toClock(end)}`;
}

function toClock(value) {
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  const match = String(value).match(/\b(\d{1,2}):(\d{2})\b/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "00:00";
}

function normalizeSeverity(value) {
  const normalized = String(value || "").toLowerCase();
  if (["high", "critical", "major", "severe", "alvorlig"].some((word) => normalized.includes(word))) return "high";
  if (["medium", "moderate", "warning", "middel"].some((word) => normalized.includes(word))) return "medium";
  return "low";
}

function defaultDelayForSeverity(severity) {
  if (severity === "high") return 15;
  if (severity === "medium") return 8;
  return 3;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Number.isFinite(value)) return String(value);
  }
  return "";
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
