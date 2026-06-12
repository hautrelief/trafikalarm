export const simulatedEvents = [
  {
    id: "event-borups-crash",
    lat: 55.69423,
    lng: 12.53556,
    roadName: "Borups Alle",
    type: "Uheld",
    severity: "high",
    delay: 18,
    title: "Uheld blokerer højre spor",
    window: "07:05-09:20",
    source: "Vejdirektoratet",
    radiusMeters: 550,
  },
  {
    id: "event-tagens-roadwork",
    lat: 55.70545,
    lng: 12.55021,
    roadName: "Tagensvej",
    type: "Vejarbejde",
    severity: "medium",
    delay: 9,
    title: "Akut vejarbejde ved kryds",
    window: "06:30-10:00",
    source: "Dataudveksleren",
    radiusMeters: 450,
  },
  {
    id: "event-strandboulevard-queue",
    lat: 55.70483,
    lng: 12.58794,
    roadName: "Strandboulevarden",
    type: "Kø",
    severity: "medium",
    delay: 12,
    title: "Langsom trafik mod Nordhavn",
    window: "15:00-18:30",
    source: "DR Trafik",
    radiusMeters: 450,
  },
  {
    id: "event-amager-closure",
    lat: 55.63874,
    lng: 12.58292,
    roadName: "Amagermotorvejen",
    type: "Spor lukket",
    severity: "high",
    delay: 24,
    title: "Et spor lukket efter tabt gods",
    window: "07:30-08:50",
    source: "Vejdirektoratet",
    radiusMeters: 700,
  },
  {
    id: "event-roskilde-slow",
    lat: 55.67251,
    lng: 12.50633,
    roadName: "Roskildevej",
    type: "Langsom trafik",
    severity: "low",
    delay: 5,
    title: "Tæt trafik mod byen",
    window: "07:00-09:00",
    source: "Trafikinfo",
    radiusMeters: 420,
  },
];

export function evaluateProfile(profile, now = new Date()) {
  const direction = inferDirection(profile, now);
  if (!direction) return [];

  const routes = profile.routes && Array.isArray(profile.routes[direction]) ? profile.routes[direction] : [];
  const results = routes.map((route) => evaluateRoute(profile, route, direction)).filter((result) => result.valid);
  if (!results.length) return [];

  const best = [...results].sort((a, b) => a.delay - b.delay || a.matches.length - b.matches.length)[0];
  return results
    .filter((result) => result.matches.length)
    .map((result) => ({ ...result, direction, best }));
}

export function evaluateRoute(profile, routeItem, direction) {
  const route = (routeItem.points || []).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (route.length < 2) return { route: routeItem, valid: false, matches: [], delay: 0 };

  const schedule = profile.schedule || {};
  const activeWindow = direction === "work"
    ? [schedule.departFrom || "07:00", schedule.departTo || "09:00"]
    : [schedule.returnFrom || "15:00", schedule.returnTo || "18:00"];
  const routeRoads = new Set(route.map((point) => normalizeName(point.roadName)).filter(Boolean));
  const minDelay = Number(schedule.minDelay || 0);

  const matches = simulatedEvents
    .map((event) => ({
      ...event,
      distanceMeters: Math.round(distanceToRouteMeters(event, route)),
    }))
    .filter((event) => {
      const roadMatch = routeRoads.has(normalizeName(event.roadName));
      const geometryMatch = event.distanceMeters <= event.radiusMeters;
      const severityOverride = event.severity === "high";
      return (
        (roadMatch || geometryMatch) &&
        windowsOverlap(event.window, activeWindow[0], activeWindow[1]) &&
        (event.delay >= minDelay || severityOverride)
      );
    });

  return {
    route: routeItem,
    valid: true,
    matches,
    delay: matches.reduce((sum, event) => sum + event.delay, 0),
  };
}

function inferDirection(profile, now) {
  const schedule = profile.schedule || {};
  const day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now.getDay()];
  if (Array.isArray(schedule.days) && schedule.days.length && !schedule.days.includes(day)) return null;

  const minutes = now.getHours() * 60 + now.getMinutes();
  if (between(minutes, schedule.departFrom, schedule.departTo)) return "work";
  if (between(minutes, schedule.returnFrom, schedule.returnTo)) return "home";
  return null;
}

function between(minutes, from = "00:00", to = "23:59") {
  const start = parseTime(from);
  const end = parseTime(to);
  return minutes >= start && minutes <= end;
}

function parseTime(value) {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

function windowsOverlap(windowValue, start, end) {
  const [eventStart, eventEnd] = String(windowValue || "").split("-");
  if (!eventStart || !eventEnd) return true;
  return parseTime(eventStart) <= parseTime(end) && parseTime(eventEnd) >= parseTime(start);
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function distanceToRouteMeters(point, route) {
  if (route.length === 1) return haversineMeters(point, route[0]);
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < route.length - 1; index += 1) {
    best = Math.min(best, distanceToSegmentMeters(point, route[index], route[index + 1]));
  }
  return best;
}

function distanceToSegmentMeters(point, start, end) {
  const latFactor = 111320;
  const lngFactor = Math.cos(((start.lat + end.lat + point.lat) / 3) * (Math.PI / 180)) * 111320;
  const px = point.lng * lngFactor;
  const py = point.lat * latFactor;
  const ax = start.lng * lngFactor;
  const ay = start.lat * latFactor;
  const bx = end.lng * lngFactor;
  const by = end.lat * latFactor;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function haversineMeters(a, b) {
  const earthRadius = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}
