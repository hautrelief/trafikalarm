const STORAGE_KEY = "trafikalarm.prototype.v4";
const COPENHAGEN_CENTER = { lat: 55.6761, lng: 12.5683 };
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const SVG_NS = "http://www.w3.org/2000/svg";
const TILE_SIZE = 256;
const MIN_ZOOM = 10;
const MAX_ZOOM = 18;

const roadNameCache = new Map();

const simulatedEvents = [
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

const sampleRoutes = {
  work: [
    { lat: 55.68888, lng: 12.49193, roadName: "Jyllingevej" },
    { lat: 55.6931, lng: 12.51457, roadName: "Borups Alle" },
    { lat: 55.69508, lng: 12.53656, roadName: "Borups Alle" },
    { lat: 55.70442, lng: 12.54968, roadName: "Tagensvej" },
    { lat: 55.71062, lng: 12.56161, roadName: "Lyngbyvej" },
    { lat: 55.70754, lng: 12.58981, roadName: "Strandboulevarden" },
  ],
  home: [
    { lat: 55.70754, lng: 12.58981, roadName: "Strandboulevarden" },
    { lat: 55.70442, lng: 12.54968, roadName: "Tagensvej" },
    { lat: 55.69508, lng: 12.53656, roadName: "Borups Alle" },
    { lat: 55.6917, lng: 12.52091, roadName: "Hulgårdsvej" },
    { lat: 55.68888, lng: 12.49193, roadName: "Jyllingevej" },
  ],
};

const defaultState = {
  user: {
    name: "",
    email: "",
    home: "Vanløse",
    work: "Nordhavn",
    homeLocation: null,
    workLocation: null,
  },
  routeMode: "work",
  activeRoutes: {
    work: "work-main",
    home: "home-main",
  },
  drawMode: true,
  schedule: {
    days: ["mon", "tue", "wed", "thu", "fri"],
    departFrom: "07:15",
    departTo: "08:45",
    returnFrom: "15:30",
    returnTo: "17:30",
    lead: 25,
    minDelay: 8,
    channels: {
      push: true,
      email: true,
    },
  },
  routes: {
    work: [{ id: "work-main", name: "Primær rute", points: [] }],
    home: [{ id: "home-main", name: "Primær rute", points: [] }],
  },
  routeStatuses: {},
  inbox: [],
  lastMatches: [],
  lastCheck: null,
};

let state = sanitizeState(loadState());
let mapState = null;
const addressLookupTimer = {
  home: null,
  work: null,
};
const addressSuggestions = {
  home: [],
  work: [],
};

const elements = {
  authBanner: document.querySelector("#authBanner"),
  quickProfileForm: document.querySelector("#quickProfileForm"),
  quickName: document.querySelector("#quickName"),
  quickEmail: document.querySelector("#quickEmail"),
  profileForm: document.querySelector("#profileForm"),
  nameInput: document.querySelector("#nameInput"),
  emailInput: document.querySelector("#emailInput"),
  homeInput: document.querySelector("#homeInput"),
  workInput: document.querySelector("#workInput"),
  homeSuggestions: document.querySelector("#homeSuggestions"),
  workSuggestions: document.querySelector("#workSuggestions"),
  daysGroup: document.querySelector("#daysGroup"),
  departFrom: document.querySelector("#departFrom"),
  departTo: document.querySelector("#departTo"),
  returnFrom: document.querySelector("#returnFrom"),
  returnTo: document.querySelector("#returnTo"),
  leadInput: document.querySelector("#leadInput"),
  leadOutput: document.querySelector("#leadOutput"),
  delayInput: document.querySelector("#delayInput"),
  delayOutput: document.querySelector("#delayOutput"),
  pushChannel: document.querySelector("#pushChannel"),
  emailChannel: document.querySelector("#emailChannel"),
  modeButtons: document.querySelectorAll(".segment[data-mode]"),
  routeTabs: document.querySelector("#routeTabs"),
  addRoute: document.querySelector("#addRoute"),
  routeNameInput: document.querySelector("#routeNameInput"),
  deleteRoute: document.querySelector("#deleteRoute"),
  sampleRoute: document.querySelector("#sampleRoute"),
  drawToggle: document.querySelector("#drawToggle"),
  clearRoute: document.querySelector("#clearRoute"),
  requestNotifications: document.querySelector("#requestNotifications"),
  runCheck: document.querySelector("#runCheck"),
  clearInbox: document.querySelector("#clearInbox"),
  routeMap: document.querySelector("#routeMap"),
  mapHelp: document.querySelector("#mapHelp"),
  roadChips: document.querySelector("#roadChips"),
  segmentCount: document.querySelector("#segmentCount"),
  eventList: document.querySelector("#eventList"),
  matchCount: document.querySelector("#matchCount"),
  inbox: document.querySelector("#inbox"),
  nextTripTile: document.querySelector("#nextTripTile"),
  routeOptions: document.querySelector("#routeOptions"),
  routeCount: document.querySelector("#routeCount"),
  systemStatus: document.querySelector("#systemStatus"),
  toast: document.querySelector("#toast"),
};

init();

function init() {
  initMap();
  bindEvents();
  syncForm();
  renderAll();
  registerServiceWorker();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultState);
    return mergeState(structuredClone(defaultState), JSON.parse(raw));
  } catch {
    return structuredClone(defaultState);
  }
}

function mergeState(base, saved) {
  return {
    ...base,
    ...saved,
    user: { ...base.user, ...(saved.user || {}) },
    activeRoutes: { ...base.activeRoutes, ...(saved.activeRoutes || {}) },
    schedule: {
      ...base.schedule,
      ...(saved.schedule || {}),
      channels: {
        ...base.schedule.channels,
        ...((saved.schedule && saved.schedule.channels) || {}),
      },
    },
    routes: {
      work: saved.routes && saved.routes.work ? saved.routes.work : base.routes.work,
      home: saved.routes && saved.routes.home ? saved.routes.home : base.routes.home,
    },
    routeStatuses: { ...base.routeStatuses, ...(saved.routeStatuses || {}) },
  };
}

function sanitizeState(nextState) {
  nextState.user.homeLocation = sanitizeLocation(nextState.user.homeLocation);
  nextState.user.workLocation = sanitizeLocation(nextState.user.workLocation);

  ["work", "home"].forEach((mode) => {
    nextState.routes[mode] = normalizeRouteList(nextState.routes[mode], mode);
    const activeExists = nextState.routes[mode].some((route) => route.id === nextState.activeRoutes[mode]);
    if (!activeExists) nextState.activeRoutes[mode] = nextState.routes[mode][0].id;
  });
  return nextState;
}

function normalizeRouteList(value, mode) {
  const fallbackId = `${mode}-main`;
  if (Array.isArray(value)) {
    const routes = value.map((route, index) => normalizeRoute(route, `${mode}-${index + 1}`)).filter(Boolean);
    return routes.length ? routes : [{ id: fallbackId, name: "Primær rute", points: [] }];
  }

  if (value && Array.isArray(value.points)) {
    return [normalizeRoute({ id: fallbackId, name: "Primær rute", points: value.points }, fallbackId)];
  }

  return [{ id: fallbackId, name: "Primær rute", points: [] }];
}

function normalizeRoute(route, fallbackId) {
  if (!route) return null;
  return {
    id: route.id || fallbackId,
    name: route.name || "Primær rute",
    points: (route.points || [])
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
      .map((point) => ({
        lat: roundCoord(point.lat),
        lng: roundCoord(point.lng),
        roadName: point.roadName || "Ukendt vej",
      })),
  };
}

function sanitizeLocation(location) {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return null;
  return {
    label: location.label || "",
    roadName: location.roadName || location.label || "Ukendt vej",
    lat: roundCoord(location.lat),
    lng: roundCoord(location.lng),
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function initMap() {
  const tileLayer = document.createElement("div");
  tileLayer.className = "map-tile-layer";

  const overlay = document.createElementNS(SVG_NS, "svg");
  overlay.classList.add("map-overlay");

  const controls = document.createElement("div");
  controls.className = "map-controls";
  controls.innerHTML = `
    <div class="zoom-controls" aria-label="Zoom">
      <button type="button" data-zoom="in" aria-label="Zoom ind">+</button>
      <button type="button" data-zoom="out" aria-label="Zoom ud">-</button>
    </div>
    <div class="pan-controls" aria-label="Flyt kort">
      <button type="button" data-pan="north" aria-label="Flyt kort op">↑</button>
      <button type="button" data-pan="west" aria-label="Flyt kort til venstre">←</button>
      <button type="button" data-pan="east" aria-label="Flyt kort til højre">→</button>
      <button type="button" data-pan="south" aria-label="Flyt kort ned">↓</button>
    </div>
  `;

  const attribution = document.createElement("div");
  attribution.className = "map-attribution";
  attribution.innerHTML = `&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>-bidragsydere`;

  elements.routeMap.textContent = "";
  elements.routeMap.tabIndex = 0;
  elements.routeMap.append(tileLayer, overlay, controls, attribution);

  mapState = {
    center: { ...COPENHAGEN_CENTER },
    zoom: 12,
    tileLayer,
    overlay,
    pointerDown: false,
    isDragging: false,
    startPointer: null,
    startCenterWorld: null,
    renderFrame: null,
    wheelDelta: 0,
    wheelResetTimer: null,
    lastWheelZoom: 0,
  };

  controls.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-zoom]");
    const panButton = event.target.closest("button[data-pan]");
    if (!button && !panButton) return;
    event.stopPropagation();
    if (button) {
      setZoom(mapState.zoom + (button.dataset.zoom === "in" ? 1 : -1));
    } else {
      panMap(panButton.dataset.pan);
    }
  });

  elements.routeMap.addEventListener("pointerdown", handleMapPointerDown);
  elements.routeMap.addEventListener("contextmenu", handleMapContextMenu);
  elements.routeMap.addEventListener("keydown", handleMapKeyDown);
  window.addEventListener("pointermove", handleMapPointerMove);
  window.addEventListener("pointerup", handleMapPointerUp);
  elements.routeMap.addEventListener("wheel", handleMapWheel, { passive: false });

  new ResizeObserver(renderMap).observe(elements.routeMap);
  renderMap();
}

function bindEvents() {
  elements.quickProfileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.user.name = elements.quickName.value.trim();
    state.user.email = elements.quickEmail.value.trim();
    syncForm();
    renderAll();
    saveState();
    showToast("Profilen er gemt lokalt.");
  });

  elements.profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    readForm();
    renderAll();
    saveState();
    showToast("Ændringerne er gemt.");
  });

  elements.homeInput.addEventListener("input", () => handleAddressInput("home"));
  elements.workInput.addEventListener("input", () => handleAddressInput("work"));
  elements.homeInput.addEventListener("change", () => applySelectedAddress("home"));
  elements.workInput.addEventListener("change", () => applySelectedAddress("work"));

  elements.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.routeMode = button.dataset.mode;
      state.lastMatches = getRouteStatus(state.activeRoutes[state.routeMode]).matches;
      renderAll();
      fitActiveRoute();
      saveState();
    });
  });

  elements.routeTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-route-id]");
    if (!button) return;
    state.activeRoutes[state.routeMode] = button.dataset.routeId;
    state.lastMatches = getRouteStatus(button.dataset.routeId).matches;
    renderAll();
    fitActiveRoute();
    saveState();
  });

  elements.addRoute.addEventListener("click", () => {
    const route = createEmptyRoute();
    getRouteList().push(route);
    state.activeRoutes[state.routeMode] = route.id;
    invalidateActiveRouteStatus();
    renderAll();
    saveState();
    showToast("Alternativ rute er tilføjet.");
  });

  elements.routeNameInput.addEventListener("input", () => {
    const route = getActiveRoute();
    route.name = elements.routeNameInput.value.trim() || "Unavngiven rute";
    renderRouteTabs();
    renderNextTrip();
    renderRouteOptions();
    saveState();
  });

  elements.deleteRoute.addEventListener("click", () => {
    const routes = getRouteList();
    if (routes.length <= 1) {
      showToast("Du skal have mindst én rute i hver retning.");
      return;
    }
    const activeId = state.activeRoutes[state.routeMode];
    const nextRoutes = routes.filter((route) => route.id !== activeId);
    state.routes[state.routeMode] = nextRoutes;
    delete state.routeStatuses[activeId];
    state.activeRoutes[state.routeMode] = nextRoutes[0].id;
    state.lastMatches = getRouteStatus(nextRoutes[0].id).matches;
    renderAll();
    fitActiveRoute();
    saveState();
    showToast("Ruten er slettet.");
  });

  elements.daysGroup.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      readForm();
      renderAll();
      saveState();
    });
  });

  [
    elements.departFrom,
    elements.departTo,
    elements.returnFrom,
    elements.returnTo,
    elements.leadInput,
    elements.delayInput,
    elements.pushChannel,
    elements.emailChannel,
  ].forEach((input) => {
    input.addEventListener("input", () => {
      readForm();
      renderAll();
      saveState();
    });
  });

  elements.sampleRoute.addEventListener("click", () => {
    setSampleRoute(state.routeMode);
    invalidateActiveRouteStatus();
    renderAll();
    fitActiveRoute();
    saveState();
    showToast("Ruten er foreslået på OpenStreetMap og klar til redigering.");
  });

  elements.drawToggle.addEventListener("click", () => {
    state.drawMode = !state.drawMode;
    renderAll();
    saveState();
  });

  elements.clearRoute.addEventListener("click", () => {
    getActiveRoute().points = [];
    invalidateActiveRouteStatus();
    renderAll();
    saveState();
    showToast("Ruten er ryddet.");
  });

  elements.runCheck.addEventListener("click", () => {
    readForm();
    runTrafficCheck();
  });

  elements.requestNotifications.addEventListener("click", requestNotifications);

  elements.clearInbox.addEventListener("click", () => {
    state.inbox = [];
    saveState();
    renderInbox();
  });
}

function syncForm() {
  elements.nameInput.value = state.user.name;
  elements.emailInput.value = state.user.email;
  elements.homeInput.value = state.user.home;
  elements.workInput.value = state.user.work;
  elements.quickName.value = state.user.name;
  elements.quickEmail.value = state.user.email;
  elements.departFrom.value = state.schedule.departFrom;
  elements.departTo.value = state.schedule.departTo;
  elements.returnFrom.value = state.schedule.returnFrom;
  elements.returnTo.value = state.schedule.returnTo;
  elements.leadInput.value = state.schedule.lead;
  elements.delayInput.value = state.schedule.minDelay;
  elements.pushChannel.checked = state.schedule.channels.push;
  elements.emailChannel.checked = state.schedule.channels.email;

  elements.daysGroup.querySelectorAll("input").forEach((input) => {
    input.checked = state.schedule.days.includes(input.value);
  });
}

function readForm() {
  state.user.name = elements.nameInput.value.trim();
  state.user.email = elements.emailInput.value.trim();
  state.user.home = elements.homeInput.value.trim();
  state.user.work = elements.workInput.value.trim();
  clearLocationIfTextChanged("home");
  clearLocationIfTextChanged("work");
  state.schedule.departFrom = elements.departFrom.value || defaultState.schedule.departFrom;
  state.schedule.departTo = elements.departTo.value || defaultState.schedule.departTo;
  state.schedule.returnFrom = elements.returnFrom.value || defaultState.schedule.returnFrom;
  state.schedule.returnTo = elements.returnTo.value || defaultState.schedule.returnTo;
  state.schedule.lead = Number(elements.leadInput.value);
  state.schedule.minDelay = Number(elements.delayInput.value);
  state.schedule.channels.push = elements.pushChannel.checked;
  state.schedule.channels.email = elements.emailChannel.checked;
  state.schedule.days = Array.from(elements.daysGroup.querySelectorAll("input:checked")).map((input) => input.value);
}

function handleAddressInput(kind) {
  const input = kind === "home" ? elements.homeInput : elements.workInput;
  const value = input.value.trim();
  state.user[kind] = value;
  applySelectedAddress(kind, false);

  clearTimeout(addressLookupTimer[kind]);
  if (value.length < 3) {
    renderAddressSuggestions(kind, []);
    return;
  }

  addressLookupTimer[kind] = setTimeout(async () => {
    const suggestions = await fetchDawaAddresses(value);
    addressSuggestions[kind] = suggestions;
    renderAddressSuggestions(kind, suggestions);
  }, 260);
}

function applySelectedAddress(kind, shouldToast = true) {
  const input = kind === "home" ? elements.homeInput : elements.workInput;
  const locationKey = kind === "home" ? "homeLocation" : "workLocation";
  const selected = addressSuggestions[kind].find((suggestion) => suggestion.label === input.value.trim());

  if (!selected) {
    clearLocationIfTextChanged(kind);
    return false;
  }

  state.user[kind] = selected.label;
  state.user[locationKey] = {
    label: selected.label,
    roadName: selected.roadName,
    lat: selected.lat,
    lng: selected.lng,
  };
  saveState();
  if (shouldToast) showToast(`${kind === "home" ? "Hjem" : "Arbejde"} er valgt via DAWA.`);
  return true;
}

function clearLocationIfTextChanged(kind) {
  const locationKey = kind === "home" ? "homeLocation" : "workLocation";
  const input = kind === "home" ? elements.homeInput : elements.workInput;
  const location = state.user[locationKey];
  if (location && input.value.trim() !== location.label) {
    state.user[locationKey] = null;
  }
}

async function fetchDawaAddresses(query) {
  const endpoint = new URL("https://api.dataforsyningen.dk/adresser/autocomplete");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("per_side", "8");
  endpoint.searchParams.set("type", "adresse");
  endpoint.searchParams.set("srid", "4326");

  try {
    const response = await fetch(endpoint.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("DAWA lookup failed");
    const data = await response.json();
    return data.map(parseDawaSuggestion).filter(Boolean);
  } catch {
    return [];
  }
}

function parseDawaSuggestion(item) {
  const address = item.adresse || item.data || {};
  const lng = Number(address.x ?? address.lon ?? address.lng);
  const lat = Number(address.y ?? address.lat);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const label = item.tekst || address.betegnelse || address.adressebetegnelse;
  if (!label) return null;

  return {
    label,
    roadName: address.vejnavn || label,
    lat: roundCoord(lat),
    lng: roundCoord(lng),
  };
}

function renderAddressSuggestions(kind, suggestions) {
  const list = kind === "home" ? elements.homeSuggestions : elements.workSuggestions;
  list.textContent = "";
  suggestions.forEach((suggestion) => {
    const option = document.createElement("option");
    option.value = suggestion.label;
    list.append(option);
  });
}

function renderAll() {
  renderMode();
  renderRouteTabs();
  renderAuth();
  renderMap();
  renderSummary();
  renderMatches(state.lastMatches || []);
  renderInbox();
  renderNextTrip();
  renderRouteOptions();
  elements.leadOutput.textContent = `${state.schedule.lead} min`;
  elements.delayOutput.textContent = `${state.schedule.minDelay} min`;
  elements.mapHelp.textContent = state.drawMode
    ? "Klik for rutepunkt. Højreklik tæt på et punkt for at fjerne det. Piletaster flytter kortet, + og - zoomer."
    : "Tegning er slået fra. Piletaster flytter kortet, + og - zoomer.";
}

function renderAuth() {
  elements.authBanner.classList.toggle("show", !state.user.email);
}

function renderMode() {
  elements.modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.routeMode);
  });
  elements.drawToggle.setAttribute("aria-pressed", String(state.drawMode));
  elements.drawToggle.classList.toggle("primary", state.drawMode);
  elements.drawToggle.classList.toggle("secondary", !state.drawMode);
}

function renderRouteTabs() {
  const activeId = state.activeRoutes[state.routeMode];
  elements.routeTabs.textContent = "";
  getRouteList().forEach((route) => {
    const status = getRouteStatus(route.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "route-tab";
    button.dataset.routeId = route.id;
    button.classList.toggle("active", route.id === activeId);
    button.innerHTML = `
      <span>${escapeHtml(route.name)}</span>
      <small>${route.points.length} punkter${status.checked ? ` · ${status.matches.length} alarmer` : ""}</small>
    `;
    elements.routeTabs.append(button);
  });
  elements.routeNameInput.value = getActiveRoute().name;
  elements.deleteRoute.disabled = getRouteList().length <= 1;
}

function renderMap() {
  if (!mapState) return;

  renderTiles();
  renderOverlay();
}

function renderTiles() {
  const rect = elements.routeMap.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const centerWorld = latLngToWorld(mapState.center, mapState.zoom);
  const topLeft = {
    x: centerWorld.x - width / 2,
    y: centerWorld.y - height / 2,
  };
  const tileStartX = Math.floor(topLeft.x / TILE_SIZE);
  const tileEndX = Math.floor((topLeft.x + width) / TILE_SIZE);
  const tileStartY = Math.floor(topLeft.y / TILE_SIZE);
  const tileEndY = Math.floor((topLeft.y + height) / TILE_SIZE);
  const tileCount = 2 ** mapState.zoom;
  const fragment = document.createDocumentFragment();

  for (let x = tileStartX; x <= tileEndX; x += 1) {
    for (let y = tileStartY; y <= tileEndY; y += 1) {
      if (y < 0 || y >= tileCount) continue;
      const wrappedX = ((x % tileCount) + tileCount) % tileCount;
      const image = document.createElement("img");
      image.className = "map-tile";
      image.alt = "";
      image.decoding = "async";
      image.draggable = false;
      image.addEventListener("error", () => image.remove(), { once: true });
      image.src = TILE_URL
        .replace("{z}", String(mapState.zoom))
        .replace("{x}", String(wrappedX))
        .replace("{y}", String(y));
      image.style.left = `${Math.round(x * TILE_SIZE - topLeft.x)}px`;
      image.style.top = `${Math.round(y * TILE_SIZE - topLeft.y)}px`;
      fragment.append(image);
    }
  }

  mapState.tileLayer.replaceChildren(fragment);
}

function renderOverlay() {
  const rect = elements.routeMap.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  mapState.overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
  mapState.overlay.setAttribute("width", String(width));
  mapState.overlay.setAttribute("height", String(height));
  mapState.overlay.textContent = "";

  const points = getValidRoutePoints().map(latLngToScreen);
  if (points.length > 1) {
    const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
    mapState.overlay.append(
      createSvg("polyline", { class: "route-halo", points: polyline }),
      createSvg("polyline", { class: "route-path", points: polyline })
    );
  }

  points.forEach((point, index) => {
    const circle = createSvg("circle", {
      class: "route-point-svg",
      cx: point.x,
      cy: point.y,
      r: index === 0 || index === points.length - 1 ? 12 : 9,
    });
    const number = createSvg("text", {
      class: "route-number",
      x: point.x,
      y: point.y + 4,
    });
    number.textContent = String(index + 1);
    mapState.overlay.append(circle, number);
  });

  simulatedEvents.forEach((event) => {
    const point = latLngToScreen(event);
    if (point.x < -40 || point.y < -40 || point.x > width + 40 || point.y > height + 40) return;

    const circle = createSvg("circle", {
      class: `event-point ${event.severity}`,
      cx: point.x,
      cy: point.y,
      r: 14,
    });
    const label = createSvg("text", {
      class: "event-label",
      x: point.x,
      y: point.y + 6,
    });
    label.textContent = "!";
    const title = createSvg("title");
    title.textContent = `${event.type}: ${event.title} på ${event.roadName}`;
    circle.append(title);
    mapState.overlay.append(circle, label);
  });
}

function renderSummary() {
  const segments = getRouteSegments();
  elements.segmentCount.textContent = String(segments.length);
  elements.roadChips.textContent = "";

  if (segments.length === 0) {
    elements.roadChips.innerHTML = `<div class="empty">Ingen rute endnu. Klik på kortet eller brug Foreslå rute.</div>`;
    return;
  }

  segments.forEach((segment) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = segment.name;
    elements.roadChips.append(chip);
  });
}

function renderMatches(matches) {
  elements.matchCount.textContent = String(matches.length);
  elements.eventList.textContent = "";

  if (!matches.length) {
    elements.eventList.innerHTML = `<div class="empty">Ingen matchende hændelser på den aktive rute.</div>`;
    return;
  }

  matches.forEach((event) => {
    const item = document.createElement("article");
    item.className = `event-item ${event.severity}`;
    const distanceText = Number.isFinite(event.distanceMeters)
      ? ` · ${event.distanceMeters} m fra ruten`
      : "";
    item.innerHTML = `
      <div class="event-title">
        <strong>${event.type}: ${event.roadName}</strong>
        <span class="badge ${event.severity}">${event.delay} min</span>
      </div>
      <div>${event.title}</div>
      <div class="event-meta">${event.source} · aktiv ${event.window}${distanceText} · matcher din ${routeLabel().toLowerCase()}</div>
    `;
    elements.eventList.append(item);
  });
}

function renderRouteOptions() {
  const routes = getRouteList();
  elements.routeCount.textContent = String(routes.length);
  elements.routeOptions.textContent = "";

  if (!routes.length) {
    elements.routeOptions.innerHTML = `<div class="empty">Ingen ruter gemt endnu.</div>`;
    return;
  }

  routes.forEach((route) => {
    const status = getRouteStatus(route.id);
    const item = document.createElement("button");
    item.type = "button";
    item.className = "route-option";
    item.classList.toggle("active", route.id === state.activeRoutes[state.routeMode]);
    item.dataset.routeId = route.id;
    const label = status.checked
      ? status.matches.length
        ? `${status.matches.length} alarmer · ${status.delay} min`
        : "Fri rute"
      : "Ikke tjekket";
    item.innerHTML = `
      <strong>${escapeHtml(route.name)}</strong>
      <span>${label}</span>
      <small>${route.points.length} rutepunkter</small>
    `;
    item.addEventListener("click", () => {
      state.activeRoutes[state.routeMode] = route.id;
      state.lastMatches = status.matches;
      renderAll();
      fitActiveRoute();
      saveState();
    });
    elements.routeOptions.append(item);
  });
}

function renderInbox() {
  elements.inbox.textContent = "";
  if (!state.inbox.length) {
    elements.inbox.innerHTML = `<div class="empty">Ingen beskeder sendt i prototypen endnu.</div>`;
    return;
  }

  state.inbox.slice(0, 6).forEach((message) => {
    const item = document.createElement("article");
    item.className = "message-item";
    item.innerHTML = `
      <div class="message-title">
        <strong>${message.title}</strong>
        ${message.channel === "mail" ? '<svg><use href="#icon-mail"></use></svg>' : '<svg><use href="#icon-bell"></use></svg>'}
      </div>
      <div>${message.body}</div>
      <div class="message-meta">${message.time} · ${message.channel === "mail" ? "mailkladde" : "browser-push"}</div>
    `;
    elements.inbox.append(item);
  });
}

function renderNextTrip() {
  const direction = routeLabel();
  const windowText = state.routeMode === "work"
    ? `${state.schedule.departFrom}-${state.schedule.departTo}`
    : `${state.schedule.returnFrom}-${state.schedule.returnTo}`;
  const route = getValidRoutePoints();
  const pointText = route.length ? `${route.length} rutepunkter` : "ingen rute";
  elements.nextTripTile.innerHTML = `
    <span>Næste tjek</span>
    <strong>${direction} · ${windowText}</strong>
    <small>${state.schedule.lead} min før afgang · ${pointText}</small>
  `;
}

function handleMapPointerDown(event) {
  if (event.button !== 0 || event.target.closest(".map-controls, .map-attribution")) return;
  mapState.pointerDown = true;
  mapState.isDragging = false;
  mapState.startPointer = { x: event.clientX, y: event.clientY };
  mapState.startCenterWorld = latLngToWorld(mapState.center, mapState.zoom);
  elements.routeMap.setPointerCapture(event.pointerId);
}

function handleMapPointerMove(event) {
  if (!mapState || !mapState.pointerDown) return;
  const dx = event.clientX - mapState.startPointer.x;
  const dy = event.clientY - mapState.startPointer.y;
  if (Math.hypot(dx, dy) < 3) return;

  mapState.isDragging = true;
  elements.routeMap.classList.add("is-dragging");
  mapState.center = worldToLatLng(
    mapState.startCenterWorld.x - dx,
    mapState.startCenterWorld.y - dy,
    mapState.zoom
  );
  scheduleRenderMap();
}

function handleMapPointerUp(event) {
  if (!mapState || !mapState.pointerDown) return;
  const wasDragging = mapState.isDragging;
  mapState.pointerDown = false;
  mapState.isDragging = false;
  elements.routeMap.classList.remove("is-dragging");

  if (!wasDragging && state.drawMode) {
    const rect = elements.routeMap.getBoundingClientRect();
    addRoutePoint(screenToLatLng(event.clientX - rect.left, event.clientY - rect.top));
  }
}

function handleMapContextMenu(event) {
  event.preventDefault();
  const rect = elements.routeMap.getBoundingClientRect();
  const removed = removeNearestRoutePoint(event.clientX - rect.left, event.clientY - rect.top);
  showToast(removed ? "Rutepunktet er fjernet." : "Højreklik tættere på et rutepunkt for at fjerne det.");
}

function handleMapKeyDown(event) {
  const keyMap = {
    ArrowUp: "north",
    ArrowRight: "east",
    ArrowDown: "south",
    ArrowLeft: "west",
  };

  if (keyMap[event.key]) {
    event.preventDefault();
    panMap(keyMap[event.key]);
    return;
  }

  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    setZoom(mapState.zoom + 1);
    return;
  }

  if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    setZoom(mapState.zoom - 1);
  }
}

function handleMapWheel(event) {
  event.preventDefault();
  const now = performance.now();
  mapState.wheelDelta += event.deltaY;
  clearTimeout(mapState.wheelResetTimer);
  mapState.wheelResetTimer = setTimeout(() => {
    mapState.wheelDelta = 0;
  }, 220);

  if (Math.abs(mapState.wheelDelta) < 180 || now - mapState.lastWheelZoom < 180) return;

  const direction = mapState.wheelDelta < 0 ? 1 : -1;
  mapState.wheelDelta = 0;
  mapState.lastWheelZoom = now;
  setZoom(mapState.zoom + direction, { x: event.clientX, y: event.clientY });
}

function setZoom(nextZoom, anchorClient = null) {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
  if (zoom === mapState.zoom) return;

  if (anchorClient) {
    const rect = elements.routeMap.getBoundingClientRect();
    const screen = {
      x: anchorClient.x - rect.left,
      y: anchorClient.y - rect.top,
    };
    const anchorLatLng = screenToLatLng(screen.x, screen.y);
    mapState.zoom = zoom;
    const anchorWorld = latLngToWorld(anchorLatLng, mapState.zoom);
    mapState.center = worldToLatLng(
      anchorWorld.x - (screen.x - rect.width / 2),
      anchorWorld.y - (screen.y - rect.height / 2),
      mapState.zoom
    );
  } else {
    mapState.zoom = zoom;
  }

  renderMap();
}

function scheduleRenderMap() {
  if (mapState.renderFrame) return;
  mapState.renderFrame = requestAnimationFrame(() => {
    mapState.renderFrame = null;
    renderMap();
  });
}

function panMap(direction) {
  const amount = 150;
  const offsets = {
    north: [0, -amount],
    east: [amount, 0],
    south: [0, amount],
    west: [-amount, 0],
  };
  const offset = offsets[direction];
  if (!offset) return;
  panByPixels(offset[0], offset[1]);
}

function panByPixels(dx, dy) {
  const centerWorld = latLngToWorld(mapState.center, mapState.zoom);
  mapState.center = worldToLatLng(centerWorld.x + dx, centerWorld.y + dy, mapState.zoom);
  renderMap();
}

async function addRoutePoint(latlng) {
  const point = {
    lat: roundCoord(latlng.lat),
    lng: roundCoord(latlng.lng),
    roadName: "Finder vejnavn...",
  };
  getActiveRoute().points.push(point);
  invalidateActiveRouteStatus();
  renderAll();
  saveState();

  point.roadName = await lookupRoadName(point.lat, point.lng);
  renderAll();
  saveState();
  showToast(`Rutepunkt tilføjet: ${point.roadName}`);
}

function removeNearestRoutePoint(screenX, screenY) {
  const points = getValidRoutePoints();
  if (!points.length) return false;

  const nearest = points.reduce(
    (best, point, index) => {
      const screenPoint = latLngToScreen(point);
      const distance = Math.hypot(screenPoint.x - screenX, screenPoint.y - screenY);
      return distance < best.distance ? { index, distance } : best;
    },
    { index: -1, distance: Number.POSITIVE_INFINITY }
  );

  if (nearest.index < 0 || nearest.distance > 28) return false;

  getActiveRoute().points.splice(nearest.index, 1);
  invalidateActiveRouteStatus();
  renderAll();
  saveState();
  return true;
}

function runTrafficCheck() {
  const routes = getRouteList();
  const routeResults = routes.map((route) => evaluateRoute(route));
  const validResults = routeResults.filter((result) => result.valid);

  if (!validResults.length) {
    showToast("Tilføj mindst to rutepunkter på en rute før tjek.");
    return;
  }

  routeResults.forEach((result) => {
    state.routeStatuses[result.route.id] = {
      checked: result.valid,
      matches: result.matches,
      delay: result.delay,
      checkedAt: new Date().toISOString(),
    };
  });

  state.lastMatches = getRouteStatus(state.activeRoutes[state.routeMode]).matches;
  state.lastCheck = new Date().toISOString();
  const activeMatches = state.lastMatches;
  const best = [...validResults].sort((a, b) => a.delay - b.delay || a.matches.length - b.matches.length)[0];
  elements.systemStatus.textContent = activeMatches.length ? `${activeMatches.length} relevant alarm` : "Ingen relevante alarmer";
  renderAll();
  sendMessages(activeMatches, best);
  saveState();
  showToast(best.matches.length ? `Bedste alternativ: ${best.route.name}` : `${best.route.name} ser fri ud.`);
}

function evaluateRoute(routeItem) {
  const route = getValidRoutePoints(routeItem);
  if (route.length < 2) {
    return { route: routeItem, valid: false, matches: [], delay: 0 };
  }

  const activeWindow = state.routeMode === "work"
    ? [state.schedule.departFrom, state.schedule.departTo]
    : [state.schedule.returnFrom, state.schedule.returnTo];
  const routeRoads = new Set(getRouteSegments(routeItem).map((segment) => normalizeName(segment.name)));
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
        (event.delay >= state.schedule.minDelay || severityOverride)
      );
    });

  return {
    route: routeItem,
    valid: true,
    matches,
    delay: matches.reduce((sum, event) => sum + event.delay, 0),
  };
}

function sendMessages(matches, bestResult = null) {
  if (!matches.length) return;

  const strongest = [...matches].sort((a, b) => b.delay - a.delay)[0];
  const title = `Trafikalarm: ${strongest.roadName}`;
  const alternative = bestResult && bestResult.route.id !== state.activeRoutes[state.routeMode]
    ? ` Bedste alternativ lige nu: ${bestResult.route.name}.`
    : "";
  const body = `${strongest.type}: ${strongest.title}. Forvent cirka ${strongest.delay} min ekstra på ruten ${getActiveRoute().name}.${alternative}`;
  const time = new Intl.DateTimeFormat("da-DK", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  if (state.schedule.channels.push) {
    state.inbox.unshift({ title, body, time, channel: "push" });
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, {
        body,
        tag: strongest.id,
      });
    }
  }

  if (state.schedule.channels.email) {
    state.inbox.unshift({
      title: `Mail: ${strongest.roadName}`,
      body: `${body} Modtager: ${state.user.email || "ikke angivet"}.`,
      time,
      channel: "mail",
    });
  }

  state.inbox = state.inbox.slice(0, 12);
  renderInbox();
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    showToast("Browseren understøtter ikke push-notifikationer.");
    return;
  }

  if (Notification.permission === "granted") {
    showToast("Push er allerede aktiveret.");
    return;
  }

  const permission = await Notification.requestPermission();
  showToast(permission === "granted" ? "Push er aktiveret." : "Push blev ikke aktiveret.");
}

function setSampleRoute(mode) {
  const endpoints = getAddressEndpoints(mode);
  const route = getActiveRoute();
  if (endpoints) {
    route.points = endpoints;
    return;
  }

  route.points = sampleRoutes[mode].map((point) => ({ ...point }));
}

function getAddressEndpoints(mode) {
  const start = mode === "work" ? state.user.homeLocation : state.user.workLocation;
  const end = mode === "work" ? state.user.workLocation : state.user.homeLocation;
  if (!start || !end) return null;

  return [
    {
      lat: start.lat,
      lng: start.lng,
      roadName: start.roadName || start.label || "Start",
    },
    {
      lat: end.lat,
      lng: end.lng,
      roadName: end.roadName || end.label || "Slut",
    },
  ];
}

function getActiveRoute() {
  const routes = getRouteList();
  const activeId = state.activeRoutes[state.routeMode];
  return routes.find((route) => route.id === activeId) || routes[0];
}

function getRouteList(mode = state.routeMode) {
  return state.routes[mode];
}

function createEmptyRoute() {
  const label = routeLabel();
  return {
    id: `${state.routeMode}-${Date.now().toString(36)}`,
    name: `${label} ${getRouteList().length + 1}`,
    points: [],
  };
}

function getRouteStatus(routeId) {
  return state.routeStatuses[routeId] || { checked: false, matches: [], delay: 0 };
}

function invalidateActiveRouteStatus() {
  delete state.routeStatuses[state.activeRoutes[state.routeMode]];
  state.lastMatches = [];
}

function getValidRoutePoints(route = getActiveRoute()) {
  return route.points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

function getRouteSegments(route = getActiveRoute()) {
  const byName = new Map();
  getValidRoutePoints(route).forEach((point) => {
    const name = point.roadName || "Ukendt vej";
    const normalized = normalizeName(name);
    if (!normalized || normalized === normalizeName("Finder vejnavn...")) return;
    if (!byName.has(normalized)) {
      byName.set(normalized, {
        id: normalized,
        name,
      });
    }
  });
  return Array.from(byName.values());
}

function routeLabel() {
  return state.routeMode === "work" ? "Til arbejde" : "Hjem";
}

function fitActiveRoute() {
  if (!mapState) return;
  const points = getValidRoutePoints();
  if (!points.length) {
    mapState.center = { ...COPENHAGEN_CENTER };
    mapState.zoom = 12;
    renderMap();
    return;
  }

  const bounds = points.reduce(
    (acc, point) => ({
      north: Math.max(acc.north, point.lat),
      south: Math.min(acc.south, point.lat),
      east: Math.max(acc.east, point.lng),
      west: Math.min(acc.west, point.lng),
    }),
    { north: -90, south: 90, east: -180, west: 180 }
  );
  mapState.center = {
    lat: (bounds.north + bounds.south) / 2,
    lng: (bounds.east + bounds.west) / 2,
  };

  const rect = elements.routeMap.getBoundingClientRect();
  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom -= 1) {
    const projected = points.map((point) => latLngToWorld(point, zoom));
    const xs = projected.map((point) => point.x);
    const ys = projected.map((point) => point.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    if (width <= rect.width - 84 && height <= rect.height - 84) {
      mapState.zoom = Math.min(zoom, 15);
      break;
    }
  }

  renderMap();
}

async function lookupRoadName(lat, lng) {
  const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (roadNameCache.has(cacheKey)) return roadNameCache.get(cacheKey);

  try {
    const url = new URL(NOMINATIM_URL);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Reverse geocoding failed");

    const data = await response.json();
    const address = data.address || {};
    const roadName =
      address.road ||
      address.pedestrian ||
      address.cycleway ||
      address.footway ||
      address.path ||
      address.neighbourhood ||
      address.suburb ||
      (data.display_name || "").split(",")[0] ||
      "Ukendt vej";

    roadNameCache.set(cacheKey, roadName);
    return roadName;
  } catch {
    roadNameCache.set(cacheKey, "Ukendt vej");
    return "Ukendt vej";
  }
}

function latLngToWorld(point, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const lat = Math.max(-85.05112878, Math.min(85.05112878, point.lat));
  const sinLat = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((point.lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function worldToLatLng(x, y, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return {
    lat: Math.max(-85.05112878, Math.min(85.05112878, lat)),
    lng: ((lng + 540) % 360) - 180,
  };
}

function screenToLatLng(x, y) {
  const rect = elements.routeMap.getBoundingClientRect();
  const centerWorld = latLngToWorld(mapState.center, mapState.zoom);
  const topLeft = {
    x: centerWorld.x - rect.width / 2,
    y: centerWorld.y - rect.height / 2,
  };
  return worldToLatLng(topLeft.x + x, topLeft.y + y, mapState.zoom);
}

function latLngToScreen(point) {
  const rect = elements.routeMap.getBoundingClientRect();
  const centerWorld = latLngToWorld(mapState.center, mapState.zoom);
  const world = latLngToWorld(point, mapState.zoom);
  return {
    x: world.x - (centerWorld.x - rect.width / 2),
    y: world.y - (centerWorld.y - rect.height / 2),
  };
}

function distanceToRouteMeters(point, route) {
  if (route.length === 1) return haversineMeters(point, route[0]);

  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < route.length - 1; index += 1) {
    const distance = pointToSegmentDistanceMeters(point, route[index], route[index + 1]);
    best = Math.min(best, distance);
  }
  return best;
}

function pointToSegmentDistanceMeters(point, start, end) {
  const latOrigin = (point.lat * Math.PI) / 180;
  const project = (candidate) => ({
    x: candidate.lng * 111320 * Math.cos(latOrigin),
    y: candidate.lat * 110540,
  });
  const p = project(point);
  const a = project(start);
  const b = project(end);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  const closest = {
    x: a.x + t * dx,
    y: a.y + t * dy,
  };
  return Math.hypot(p.x - closest.x, p.y - closest.y);
}

function haversineMeters(a, b) {
  const radius = 6371000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const deltaLat = ((b.lat - a.lat) * Math.PI) / 180;
  const deltaLng = ((b.lng - a.lng) * Math.PI) / 180;
  const value =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function windowsOverlap(eventWindow, start, end) {
  const [eventStart, eventEnd] = eventWindow.split("-").map(toMinutes);
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  return eventStart <= endMinutes && eventEnd >= startMinutes;
}

function toMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function normalizeName(value) {
  return (value || "")
    .toLocaleLowerCase("da-DK")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function createSvg(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function roundCoord(value) {
  return Math.round(Number(value) * 1000000) / 1000000;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2600);
}

function registerServiceWorker() {
  if (location.protocol.startsWith("http") && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {
      // The app still works without offline caching.
    });
  }
}
