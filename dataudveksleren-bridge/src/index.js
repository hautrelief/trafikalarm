import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { URL } from "node:url";
import { XMLParser } from "fast-xml-parser";
import { Connection } from "rhea-promise";

loadEnvFile();

const required = [
  "DATAUDVEKSLER_AMQP_URL",
  "DATAUDVEKSLER_USERNAME",
  "DATAUDVEKSLER_PASSWORD",
  "RUTEALARM_INGEST_URL",
  "RUTEALARM_INGEST_SECRET",
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

function loadEnvFile() {
  const candidates = [
    process.env.RUTEALARM_ENV_FILE,
    "my.env",
    ".env",
    "dataudveksleren-bridge/my.env",
    "dataudveksleren-bridge/.env",
  ].filter(Boolean);

  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (!envPath) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = unquote(rawValue.trim());
  }

  console.log(`Loaded environment variables from ${envPath}`);
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

const source = process.env.RUTEALARM_SOURCE || "Dataudveksleren";
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
});

const amqpUrl = new URL(process.env.DATAUDVEKSLER_AMQP_URL);
const address = amqpUrl.pathname.replace(/^\/+/, "");
const connection = new Connection({
  hostname: amqpUrl.hostname,
  port: Number(amqpUrl.port || 5671),
  transport: "tls",
  username: process.env.DATAUDVEKSLER_USERNAME,
  password: process.env.DATAUDVEKSLER_PASSWORD,
  container_id: `rutealarm-${Date.now()}`,
  reconnect: true,
});

console.log(`Connecting to Dataudveksleren AMQP host ${amqpUrl.hostname}`);
await connection.open();

const receiver = await connection.createReceiver({
  source: {
    address,
  },
  credit_window: 10,
});

console.log(`Listening on AMQP address ${address}`);

receiver.on("message", async (context) => {
  const message = context.message;
  const text = bodyToText(message.body);
  if (!text) {
    console.warn("Skipped empty message");
    context.delivery.accept();
    return;
  }

  try {
    const events = parseTrafficMessage(text);
    if (!events.length) {
      console.warn("Message did not contain usable traffic events");
      context.delivery.accept();
      return;
    }

    const result = await postEvents(events);
    console.log(`Stored ${result.stored || events.length} traffic events`);
    context.delivery.accept();
  } catch (error) {
    console.error("Failed to process traffic message:", error.message);
    context.delivery.release();
  }
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown() {
  console.log("Closing AMQP connection");
  await receiver.close().catch(() => {});
  await connection.close().catch(() => {});
  process.exit(0);
}

function bodyToText(body) {
  if (typeof body === "string") return body;
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (body && Buffer.isBuffer(body.content)) return body.content.toString("utf8");
  if (body && typeof body === "object") return JSON.stringify(body);
  return "";
}

function parseTrafficMessage(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const payload = JSON.parse(trimmed);
    return Array.isArray(payload) ? payload : payload.events || payload.features || payload.items || [payload];
  }
  if (trimmed.startsWith("<")) {
    return extractDatexEvents(xmlParser.parse(trimmed));
  }
  return [];
}

function extractDatexEvents(payload) {
  const records = findObjects(payload, (item) => {
    const type = String(item["@_xsi:type"] || item["xsi:type"] || item.situationRecordType || "");
    return Boolean(item.situationRecordCreationTime || item.situationRecordVersionTime || type.includes("Record"));
  });

  return records.map((record, index) => {
    const point = findFirstPoint(record);
    if (!point) return null;
    const roadName = firstText(
      record.roadName,
      record.roadIdentifier,
      record.locationDescription && record.locationDescription.values,
      record.groupOfLocations && JSON.stringify(record.groupOfLocations).slice(0, 80)
    );
    return {
      id: firstText(record.id, record.situationRecordId, record.version, `datex-${index}`),
      lat: point.lat,
      lng: point.lng,
      roadName: roadName || "Ukendt vej",
      type: firstText(record.accidentType, record.maintenanceVehicleActions, record.mobilityOfTraffic, record["@_xsi:type"], "Trafikhændelse"),
      severity: severityFromDatex(record),
      delay: delayFromDatex(record),
      title: firstText(record.generalPublicComment, record.nonGeneralPublicComment, record.situationRecordObservationTime, "Trafikhændelse fra Dataudveksleren"),
      window: windowFromDatex(record),
      source,
      radiusMeters: 800,
    };
  }).filter(Boolean);
}

function findObjects(value, predicate, matches = []) {
  if (!value || typeof value !== "object") return matches;
  if (predicate(value)) matches.push(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => findObjects(item, predicate, matches));
    else findObjects(child, predicate, matches);
  }
  return matches;
}

function findFirstPoint(value) {
  const points = findObjects(value, (item) => {
    const lat = Number(item.latitude || item.lat);
    const lng = Number(item.longitude || item.lng || item.lon);
    return Number.isFinite(lat) && Number.isFinite(lng);
  });
  if (!points.length) return null;
  const point = points[0];
  return {
    lat: Number(point.latitude || point.lat),
    lng: Number(point.longitude || point.lng || point.lon),
  };
}

function severityFromDatex(record) {
  const text = JSON.stringify(record).toLowerCase();
  if (text.includes("high") || text.includes("severe") || text.includes("impossible") || text.includes("blocked")) return "high";
  if (text.includes("medium") || text.includes("slow") || text.includes("congested")) return "medium";
  return "low";
}

function delayFromDatex(record) {
  const text = JSON.stringify(record);
  const minuteMatch = text.match(/(\d+)\s*(?:min|minute)/i);
  if (minuteMatch) return Number(minuteMatch[1]);
  const severity = severityFromDatex(record);
  if (severity === "high") return 15;
  if (severity === "medium") return 8;
  return 3;
}

function windowFromDatex(record) {
  const start = firstText(record.overallStartTime, record.situationRecordCreationTime, record.validityTimeSpecification?.overallStartTime);
  const end = firstText(record.overallEndTime, record.validityTimeSpecification?.overallEndTime);
  if (!start || !end) return "00:00-23:59";
  return `${toClock(start)}-${toClock(end)}`;
}

function toClock(value) {
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return "00:00";
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Number.isFinite(value)) return String(value);
    if (value && typeof value === "object") {
      const nested = firstText(...Object.values(value));
      if (nested) return nested;
    }
  }
  return "";
}

async function postEvents(events) {
  const response = await fetch(process.env.RUTEALARM_INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Traffic-Ingest-Secret": process.env.RUTEALARM_INGEST_SECRET,
    },
    body: JSON.stringify({
      source,
      events,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Rutealarm ingest failed with HTTP ${response.status}`);
  }
  return result;
}
