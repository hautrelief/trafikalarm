const STORAGE_KEY = "trafikalarm.prototype.v4";
const COPENHAGEN_CENTER = { lat: 55.6761, lng: 12.5683 };
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving";
const SVG_NS = "http://www.w3.org/2000/svg";
const TILE_SIZE = 256;
const MIN_ZOOM = 10;
const MAX_ZOOM = 18;

const roadNameCache = new Map();

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
  cloud: {
    sessionToken: "",
    userId: "",
    lastSync: null,
  },
  login: {
    codeRequestedAt: null,
    codeEmail: "",
  },
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
  googleTraffic: null,
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
let cloudSyncTimer = null;
let isCloudSyncing = false;
let loginResendTimer = null;
let trafficEvents = [];
let trafficEventsStatus = {
  configured: false,
  message: "Officiel trafikkilde er ikke sat op endnu.",
};

const elements = {
  authBanner: document.querySelector("#authBanner"),
  appWorkspace: document.querySelector("#appWorkspace"),
  quickProfileForm: document.querySelector("#quickProfileForm"),
  quickName: document.querySelector("#quickName"),
  quickEmail: document.querySelector("#quickEmail"),
  loginCodeField: document.querySelector("#loginCodeField"),
  loginCode: document.querySelector("#loginCode"),
  requestLoginCode: document.querySelector("#requestLoginCode"),
  resendLoginCode: document.querySelector("#resendLoginCode"),
  verifyLoginCode: document.querySelector("#verifyLoginCode"),
  loginStatus: document.querySelector("#loginStatus"),
  logoutProfile: document.querySelector("#logoutProfile"),
  topLogoutProfile: document.querySelector("#topLogoutProfile"),
  accountTitle: document.querySelector("#accountTitle"),
  accountSubtitle: document.querySelector("#accountSubtitle"),
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
  emailChannel: document.querySelector("#emailChannel"),
  modeButtons: document.querySelectorAll(".segment[data-mode]"),
  routeTabs: document.querySelector("#routeTabs"),
  addRoute: document.querySelector("#addRoute"),
  copyReverseRoute: document.querySelector("#copyReverseRoute"),
  reverseRouteSource: document.querySelector("#reverseRouteSource"),
  routeNameInput: document.querySelector("#routeNameInput"),
  deleteRoute: document.querySelector("#deleteRoute"),
  sampleRoute: document.querySelector("#sampleRoute"),
  drawToggle: document.querySelector("#drawToggle"),
  clearRoute: document.querySelector("#clearRoute"),
  runCheck: document.querySelector("#runCheck"),
  clearInbox: document.querySelector("#clearInbox"),
  routeMap: document.querySelector("#routeMap"),
  mapHelp: document.querySelector("#mapHelp"),
  roadChips: document.querySelector("#roadChips"),
  segmentCount: document.querySelector("#segmentCount"),
  eventList: document.querySelector("#eventList"),
  matchCount: document.querySelector("#matchCount"),
  googleTraffic: document.querySelector("#googleTraffic"),
  googleTrafficBadge: document.querySelector("#googleTrafficBadge"),
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
    cloud: { ...base.cloud, ...(saved.cloud || {}) },
    login: { ...base.login, ...(saved.login || {}) },
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

function saveState(options = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!options.localOnly) scheduleCloudSync();
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
  elements.quickProfileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (elements.loginCode.value.trim()) {
      await verifyLoginCode();
    } else if (!isWaitingForLoginCode()) {
      await requestLoginCode();
    } else {
      showToast("Check din e-mail og kig evt. i din spam folder.");
    }
  });

  elements.requestLoginCode.addEventListener("click", requestLoginCode);
  elements.resendLoginCode.addEventListener("click", requestLoginCode);
  elements.verifyLoginCode.addEventListener("click", verifyLoginCode);
  elements.quickEmail.addEventListener("input", resetLoginRequestState);
  elements.logoutProfile.addEventListener("click", logoutProfile);
  elements.topLogoutProfile.addEventListener("click", logoutProfile);

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
    return;
    showToast(message || "Ruten er foreslået og klar til redigering.");
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

  elements.copyReverseRoute.addEventListener("click", () => {
    const result = copyRouteFromOppositeDirection(elements.reverseRouteSource.value);
    if (!result.ok) {
      showToast(result.message);
      return;
    }
    invalidateActiveRouteStatus();
    renderAll();
    fitActiveRoute();
    saveState();
    showToast(result.message);
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
    elements.emailChannel,
  ].forEach((input) => {
    input.addEventListener("input", () => {
      readForm();
      renderAll();
      saveState();
    });
  });

  elements.sampleRoute.addEventListener("click", async () => {
    elements.sampleRoute.disabled = true;
    readForm();
    showToast("Finder rute ud fra dine adresser...");
    const message = await setSuggestedRoute(state.routeMode);
    invalidateActiveRouteStatus();
    renderAll();
    fitActiveRoute();
    saveState();
    elements.sampleRoute.disabled = false;
    showToast(message || "Ruten er foreslået og klar til redigering.");
    return;
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

  elements.runCheck.addEventListener("click", async () => {
    readForm();
    await runTrafficCheck();
  });

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
  elements.loginCode.value = "";
  elements.departFrom.value = state.schedule.departFrom;
  elements.departTo.value = state.schedule.departTo;
  elements.returnFrom.value = state.schedule.returnFrom;
  elements.returnTo.value = state.schedule.returnTo;
  elements.leadInput.value = state.schedule.lead;
  elements.delayInput.value = state.schedule.minDelay;
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
  state.schedule.channels.push = false;
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
  renderGoogleTraffic();
  renderInbox();
  renderNextTrip();
  renderRouteOptions();
  elements.leadOutput.textContent = `${state.schedule.lead} min`;
  elements.delayOutput.textContent = `${state.schedule.minDelay} min`;
  elements.mapHelp.textContent = state.drawMode
    ? "Klik for rutepunkt. På mobil: tryk på et punkt for at fjerne det. På computer: højreklik tæt på et punkt. Piletaster flytter kortet, + og - zoomer."
    : "Tegning er slået fra. Piletaster flytter kortet, + og - zoomer.";
}

function renderAuth() {
  const isLoggedIn = Boolean(state.cloud.sessionToken);
  document.body.classList.toggle("login-view", !isLoggedIn);
  document.body.classList.toggle("app-view", isLoggedIn);
  elements.authBanner.hidden = isLoggedIn;
  elements.appWorkspace.hidden = !isLoggedIn;
  elements.topLogoutProfile.hidden = !isLoggedIn;
  elements.systemStatus.hidden = !isLoggedIn;
  elements.accountTitle.textContent = isLoggedIn ? "Profilen er koblet på skyen" : "Opret din pendlerprofil";
  elements.accountSubtitle.textContent = isLoggedIn
    ? `Logget ind som ${state.user.email || "pendler"}. Seneste synk: ${formatSyncTime(state.cloud.lastSync)}.`
    : "Log ind med mailkode, så dine ruter kan gemmes og overvåges uden åben browser.";
  elements.loginCode.disabled = isLoggedIn;
  elements.verifyLoginCode.disabled = isLoggedIn;
  renderLoginRequestState(isLoggedIn);
  elements.logoutProfile.hidden = !isLoggedIn;
  if (!isLoggedIn) {
    elements.accountTitle.textContent = "Pendlerprofil";
    elements.accountSubtitle.textContent = "Login med din e-mail. Indtast din e-mail og klik send kode. Systemet sender dig en kode, som du skal taste ind i kode feltet før du klikker på Log ind.";
  }
}

function isWaitingForLoginCode() {
  const requestedAt = state.login.codeRequestedAt ? new Date(state.login.codeRequestedAt).getTime() : 0;
  const sameEmail = state.login.codeEmail && state.login.codeEmail === elements.quickEmail.value.trim().toLowerCase();
  return Boolean(sameEmail && requestedAt && Math.floor((Date.now() - requestedAt) / 1000) < 60);
}

function renderLoginRequestState(isLoggedIn = Boolean(state.cloud.sessionToken)) {
  clearTimeout(loginResendTimer);
  if (isLoggedIn) {
    elements.requestLoginCode.hidden = true;
    elements.requestLoginCode.disabled = true;
    elements.resendLoginCode.hidden = true;
    elements.resendLoginCode.disabled = true;
    elements.loginCodeField.hidden = true;
    elements.verifyLoginCode.hidden = true;
    elements.loginStatus.textContent = "";
    return;
  }

  const requestedAt = state.login.codeRequestedAt ? new Date(state.login.codeRequestedAt).getTime() : 0;
  const sameEmail = state.login.codeEmail && state.login.codeEmail === elements.quickEmail.value.trim().toLowerCase();
  const elapsedSeconds = requestedAt ? Math.floor((Date.now() - requestedAt) / 1000) : Number.POSITIVE_INFINITY;
  const waitSeconds = Math.max(0, 60 - elapsedSeconds);
  const waiting = sameEmail && waitSeconds > 0;
  const hasRequestedCode = Boolean(sameEmail && requestedAt);

  elements.requestLoginCode.hidden = hasRequestedCode;
  elements.requestLoginCode.disabled = false;
  elements.resendLoginCode.hidden = !sameEmail || waiting;
  elements.resendLoginCode.disabled = false;
  elements.loginCodeField.hidden = !hasRequestedCode;
  elements.verifyLoginCode.hidden = !hasRequestedCode;
  elements.loginStatus.textContent = waiting
    ? "Check din e-mail og kig evt. i din spam folder, hvis ikke du modtager den i indbakken inden længe."
    : sameEmail
      ? "Check din e-mail og kig evt. i din spam folder, hvis ikke du modtager den i indbakken inden længe."
      : "";

  if (waiting) {
    loginResendTimer = setTimeout(renderAuth, waitSeconds * 1000);
  }
}

function resetLoginRequestState() {
  state.login.codeRequestedAt = null;
  state.login.codeEmail = "";
  renderAuth();
  saveState({ localOnly: true });
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
  renderReverseRouteSource();
}

function renderReverseRouteSource() {
  const sourceMode = state.routeMode === "work" ? "home" : "work";
  const sourceLabel = sourceMode === "work" ? "til arbejde" : "hjem";
  const routes = getOppositeRoutesWithPoints();
  elements.reverseRouteSource.textContent = "";

  if (!routes.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = `Ingen rute ${sourceLabel} endnu`;
    elements.reverseRouteSource.append(option);
    elements.reverseRouteSource.disabled = true;
    elements.copyReverseRoute.disabled = true;
    elements.copyReverseRoute.title = `Tegn f�rst en rute ${sourceLabel}`;
    return;
  }

  routes.forEach((route) => {
    const option = document.createElement("option");
    option.value = route.id;
    option.textContent = `${route.name} (${route.points.length} punkter)`;
    elements.reverseRouteSource.append(option);
  });

  const activeOppositeId = state.activeRoutes[sourceMode];
  const selectedRoute = routes.find((route) => route.id === activeOppositeId) || routes[0];
  elements.reverseRouteSource.value = selectedRoute.id;
  elements.reverseRouteSource.disabled = false;
  elements.copyReverseRoute.disabled = false;
  elements.copyReverseRoute.title = `Kopier ${selectedRoute.name} som rute tilbage`;
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

  trafficEvents.forEach((event) => {
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
    const message = trafficEventsStatus.configured
      ? "Ingen matchende h�ndelser p� den aktive rute."
      : "Officiel trafikkilde er ikke sat op endnu. Google-rejsetid kan stadig bruges.";
    elements.eventList.innerHTML = `<div class="empty">${message}</div>`;
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

function renderGoogleTraffic() {
  if (!elements.googleTraffic || !elements.googleTrafficBadge) return;
  const traffic = state.googleTraffic;
  if (!traffic) {
    elements.googleTrafficBadge.textContent = "Fra";
    elements.googleTraffic.innerHTML = `<div class="empty">Ikke tjekket endnu.</div>`;
    return;
  }

  if (traffic.status === "loading") {
    elements.googleTrafficBadge.textContent = "Tjekker";
    elements.googleTraffic.innerHTML = `<div class="empty">Henter rejsetid fra Google Maps Platform...</div>`;
    return;
  }

  if (traffic.status === "disabled") {
    elements.googleTrafficBadge.textContent = "Fra";
    elements.googleTraffic.innerHTML = `<div class="empty">${traffic.message}</div>`;
    return;
  }

  if (traffic.status === "error") {
    elements.googleTrafficBadge.textContent = "Fejl";
    elements.googleTraffic.innerHTML = `<div class="empty">${traffic.message}</div>`;
    return;
  }

  const delayMinutes = Math.round((traffic.delaySeconds || 0) / 60);
  const durationMinutes = Math.round((traffic.durationSeconds || 0) / 60);
  const distanceKm = ((traffic.distanceMeters || 0) / 1000).toFixed(1).replace(".", ",");
  const levelText = traffic.trafficLevel === "heavy"
    ? "Unormalt meget trafik"
    : traffic.trafficLevel === "moderate"
      ? "Mere trafik end normalt"
      : "Normal trafik";

  elements.googleTrafficBadge.textContent = traffic.trafficLevel === "heavy" ? "Høj" : traffic.trafficLevel === "moderate" ? "Moderat" : "Normal";
  elements.googleTraffic.innerHTML = `
    <strong>${levelText}</strong>
    <span>${durationMinutes} min rejsetid · ${distanceKm} km</span>
    <small>${delayMinutes ? `Ca. ${delayMinutes} min ekstra trafikforsinkelse` : "Ingen tydelig ekstra forsinkelse"} · Data fra Google Maps Platform</small>
  `;
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
    const meta = message.channel === "mail" ? mailStatusLabel(message.status) : "browser-push";
    item.innerHTML = `
      <div class="message-title">
        <strong>${message.title}</strong>
        ${message.channel === "mail" ? '<svg><use href="#icon-mail"></use></svg>' : '<svg><use href="#icon-bell"></use></svg>'}
      </div>
      <div>${message.body}</div>
      <div class="message-meta">${message.time} · ${meta}</div>
    `;
    elements.inbox.append(item);
  });
}

function mailStatusLabel(status) {
  const labels = {
    sender: "mail sendes",
    sent: "mail sendt",
    failed: "mail fejl",
    "missing-recipient": "mangler mailadresse",
  };
  return labels[status] || "mailkladde";
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
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if ((event.pointerType === "touch" || event.pointerType === "pen") && removeNearestRoutePoint(x, y, 38)) {
      showToast("Rutepunktet er fjernet.");
      return;
    }
    addRoutePoint(screenToLatLng(x, y));
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

function removeNearestRoutePoint(screenX, screenY, maxDistance = 28) {
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

  if (nearest.index < 0 || nearest.distance > maxDistance) return false;

  getActiveRoute().points.splice(nearest.index, 1);
  invalidateActiveRouteStatus();
  renderAll();
  saveState();
  return true;
}

async function runTrafficCheck() {
  await refreshTrafficEvents();
  const routes = [getActiveRoute()];
  const routeResults = routes.map((route) => evaluateRoute(route, trafficEvents));
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
  state.googleTraffic = { status: "loading" };
  renderAll();
  await updateGoogleTraffic(validResults[0].route);
  renderGoogleTraffic();
  sendMessages(activeMatches, best);
  saveState();
  if (!trafficEventsStatus.configured) {
    showToast("Google-rejsetid er tjekket. Officiel trafikkilde er ikke sat op endnu.");
    return;
  }
  showToast(best.matches.length ? `Bedste alternativ: ${best.route.name}` : `${best.route.name} ser fri ud.`);
}

async function refreshTrafficEvents() {
  try {
    const result = await apiRequest("/api/traffic-events");
    trafficEvents = Array.isArray(result.events) ? result.events : [];
    trafficEventsStatus = {
      configured: Boolean(result.configured),
      message: result.message || "",
      source: result.source || "Officiel trafikdata",
    };
  } catch (error) {
    trafficEvents = [];
    trafficEventsStatus = {
      configured: true,
      message: `Trafikkilden kunne ikke hentes: ${error.message}`,
    };
  }
}

function evaluateRoute(routeItem, events = trafficEvents) {
  const route = getValidRoutePoints(routeItem);
  if (route.length < 2) {
    return { route: routeItem, valid: false, matches: [], delay: 0 };
  }

  const activeWindow = state.routeMode === "work"
    ? [state.schedule.departFrom, state.schedule.departTo]
    : [state.schedule.returnFrom, state.schedule.returnTo];
  const routeRoads = new Set(getRouteSegments(routeItem).map((segment) => normalizeName(segment.name)));
  const matches = events
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

async function sendMessages(matches, bestResult = null) {
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

  if (state.schedule.channels.email) {
    const recipient = state.user.email;
    const message = {
      title: `Mail: ${strongest.roadName}`,
      body: `${body} Modtager: ${recipient || "ikke angivet"}.`,
      time,
      channel: "mail",
      status: recipient ? "sender" : "missing-recipient",
    };
    state.inbox.unshift(message);
    renderInbox();

    if (recipient) {
      try {
        await sendAlertEmail({
          to: recipient,
          subject: title,
          text: `${body}\n\nRute: ${getActiveRoute().name}\nRetning: ${routeLabel()}\nKilde: ${strongest.source}\nAktiv: ${strongest.window}`,
        });
        message.status = "sent";
        message.title = `Mail sendt: ${strongest.roadName}`;
      } catch (error) {
        message.status = "failed";
        message.body = `${body} Mail kunne ikke sendes endnu: ${error.message}`;
      }
    }
  }

  state.inbox = state.inbox.slice(0, 12);
  renderInbox();
  saveState();
}

async function sendAlertEmail(payload) {
  const response = await fetch("/api/send-alert-email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || "Serveren afviste mailen.");
  }
  return result;
}

async function updateGoogleTraffic(route) {
  const points = getValidRoutePoints(route);
  if (points.length < 2) {
    state.googleTraffic = { status: "error", message: "Ruten skal have mindst to punkter." };
    return;
  }

  try {
    const result = await apiRequest("/api/google-route-traffic", {
      method: "POST",
      body: {
        points,
        departureTime: nextDepartureTime().toISOString(),
      },
    });

    if (result.disabled) {
      state.googleTraffic = {
        status: "disabled",
        message: "Google Maps API er ikke slået til endnu.",
      };
      return;
    }

    state.googleTraffic = {
      status: "ready",
      provider: result.provider,
      departureTime: result.departureTime,
      distanceMeters: result.distanceMeters,
      durationSeconds: result.durationSeconds,
      staticDurationSeconds: result.staticDurationSeconds,
      delaySeconds: result.delaySeconds,
      trafficLevel: result.trafficLevel,
    };
  } catch (error) {
    state.googleTraffic = {
      status: "error",
      message: `Kunne ikke hente Google-rejsetid: ${error.message}`,
    };
  }
}

function nextDepartureTime() {
  const days = state.schedule.days && state.schedule.days.length ? state.schedule.days : defaultState.schedule.days;
  const time = state.routeMode === "work" ? state.schedule.departFrom : state.schedule.returnFrom;
  const now = new Date();

  for (let offset = 0; offset < 14; offset += 1) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(...timeParts(time), 0, 0);
    const day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][candidate.getDay()];
    if (days.includes(day) && candidate.getTime() > now.getTime()) return candidate;
  }

  return new Date(now.getTime() + 5 * 60 * 1000);
}

function timeParts(value) {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number);
  return [Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0];
}

async function requestLoginCode() {
  const email = (elements.quickEmail.value || elements.emailInput.value).trim();
  const name = (elements.quickName.value || elements.nameInput.value).trim();
  if (!email) {
    showToast("Skriv din mailadresse først.");
    return;
  }

  state.user.email = email;
  state.user.name = name;
  syncForm();
  saveState();

  try {
    await apiRequest("/api/request-login", {
      method: "POST",
      body: {
        email,
        name,
      },
    });
    state.login.codeRequestedAt = new Date().toISOString();
    state.login.codeEmail = email.toLowerCase();
    saveState({ localOnly: true });
    renderAuth();
    elements.loginCode.focus();
    showToast("Check din e-mail og kig evt. i din spam folder.");
  } catch (error) {
    showToast(`Kunne ikke sende login-kode: ${error.message}`);
  }
}

async function verifyLoginCode() {
  const email = (elements.quickEmail.value || elements.emailInput.value).trim();
  const code = elements.loginCode.value.trim();
  if (!email || !code) {
    showToast("Skriv mail og koden fra mailen.");
    return;
  }

  try {
    const result = await apiRequest("/api/verify-login", {
      method: "POST",
      body: { email, code },
    });
    state.cloud.sessionToken = result.sessionToken;
    state.cloud.userId = result.user && result.user.id ? result.user.id : "";
    if (result.profile) {
      state = sanitizeState(mergeState(structuredClone(defaultState), {
        ...result.profile,
        cloud: state.cloud,
      }));
    } else {
      state.user.email = email;
    }
    state.login.codeRequestedAt = null;
    state.login.codeEmail = "";
    state.cloud.lastSync = new Date().toISOString();
    const message = result.profile ? "Du er logget ind, og profilen er hentet." : "Du er logget ind. Dine ændringer gemmes automatisk.";
    syncForm();
    renderAll();
    saveState({ localOnly: true });
    elements.sampleRoute.disabled = false;
    showToast(message || "Ruten er foreslået og klar til redigering.");
    return;
    showToast(result.profile ? "Du er logget ind, og profilen er hentet." : "Du er logget ind. Gem dine ruter i skyen når de er klar.");
  } catch (error) {
    showToast(`Login lykkedes ikke: ${error.message}`);
  }
}

function scheduleCloudSync() {
  if (!state.cloud.sessionToken || isCloudSyncing) return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => {
    syncCloudProfile({ silent: true });
  }, 1200);
}

async function syncCloudProfile(options = {}) {
  readForm();
  if (!state.cloud.sessionToken) {
    saveState({ localOnly: true });
    renderAll();
    if (!options.silent) showToast("Profilen er gemt lokalt. Send en login-kode for at gemme den i skyen.");
    return;
  }

  isCloudSyncing = true;
  try {
    const result = await apiRequest("/api/profile", {
      method: "PUT",
      token: state.cloud.sessionToken,
      body: {
        profile: serializeProfileState(),
      },
    });
    state.cloud.lastSync = result.savedAt || new Date().toISOString();
    saveState({ localOnly: true });
    renderAll();
    if (!options.silent) showToast("Profil, ruter og alarmvalg er gemt i skyen.");
  } catch (error) {
    saveState({ localOnly: true });
    renderAll();
    showToast(`Gemt lokalt, men ikke i skyen: ${error.message}`);
  } finally {
    isCloudSyncing = false;
  }
}

function logoutProfile() {
  state.cloud = structuredClone(defaultState.cloud);
  state.login = structuredClone(defaultState.login);
  saveState();
  renderAll();
  showToast("Du er logget ud på denne enhed.");
}

function serializeProfileState() {
  return {
    user: state.user,
    routeMode: state.routeMode,
    activeRoutes: state.activeRoutes,
    schedule: state.schedule,
    routes: state.routes,
  };
}

async function apiRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  };
  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const responseText = await response.text();
  const result = responseText ? safeJson(responseText) : {};
  if (!response.ok) {
    throw new Error(result.error || result.message || responseText.slice(0, 180) || `Serveren svarede med HTTP ${response.status}.`);
  }
  return result;
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function formatSyncTime(value) {
  if (!value) return "ikke endnu";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ikke endnu";
  return new Intl.DateTimeFormat("da-DK", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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

async function setSuggestedRoute(mode) {
  const endpoints = await resolveAddressEndpoints(mode);
  const route = getActiveRoute();

  if (!endpoints) {
    setSampleRoute(mode);
    return "Jeg kunne ikke finde begge adresser, så demo-ruten blev brugt.";
  }

  const osrmRoute = await fetchSuggestedRoute(endpoints[0], endpoints[1]);
  if (osrmRoute.length >= 2) {
    route.points = osrmRoute;
    return "Ruten er foreslået ud fra hjem og arbejde og klar til redigering.";
  }

  route.points = endpoints;
  return "Adresserne blev fundet, men ruteforslaget fejlede. Jeg har tegnet start og slut ind.";
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

async function resolveAddressEndpoints(mode) {
  const home = await resolveProfileLocation("home");
  const work = await resolveProfileLocation("work");
  if (!home || !work) return null;

  return mode === "work"
    ? [toRouteEndpoint(home, "Start"), toRouteEndpoint(work, "Slut")]
    : [toRouteEndpoint(work, "Start"), toRouteEndpoint(home, "Slut")];
}

async function resolveProfileLocation(kind) {
  const locationKey = kind === "home" ? "homeLocation" : "workLocation";
  const input = kind === "home" ? elements.homeInput : elements.workInput;
  const current = state.user[locationKey];
  if (current && input.value.trim() === current.label) return current;

  const query = input.value.trim();
  if (query.length < 3) return null;

  const suggestion = (await fetchDawaAddresses(query))[0];
  if (!suggestion) return null;

  state.user[kind] = suggestion.label;
  state.user[locationKey] = {
    label: suggestion.label,
    roadName: suggestion.roadName,
    lat: suggestion.lat,
    lng: suggestion.lng,
  };
  input.value = suggestion.label;
  return state.user[locationKey];
}

function toRouteEndpoint(location, fallback) {
  return {
    lat: location.lat,
    lng: location.lng,
    roadName: location.roadName || location.label || fallback,
  };
}

async function fetchSuggestedRoute(start, end) {
  const endpoint = `${OSRM_ROUTE_URL}/${start.lng},${start.lat};${end.lng},${end.lat}`;
  const url = new URL(endpoint);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "true");

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Route lookup failed");

    const data = await response.json();
    const route = data.routes && data.routes[0];
    const stepPoints = extractRouteStepPoints(route);
    if (stepPoints.length >= 2) {
      const points = thinRoutePoints(stepPoints, 64);
      points[0].roadName = start.roadName;
      points[points.length - 1].roadName = end.roadName;
      return points;
    }

    const coordinates = route && route.geometry && route.geometry.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return [];

    return thinCoordinates(coordinates, 64).map(([lng, lat], index, list) => ({
      lat: roundCoord(lat),
      lng: roundCoord(lng),
      roadName: index === 0 ? start.roadName : index === list.length - 1 ? end.roadName : "Ukendt vej",
    }));
  } catch {
    return [];
  }
}

function thinCoordinates(coordinates, maxPoints) {
  if (coordinates.length <= maxPoints) return coordinates;
  const step = (coordinates.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => coordinates[Math.round(index * step)]);
}

function extractRouteStepPoints(route) {
  const steps = ((route && route.legs) || []).flatMap((leg) => leg.steps || []);
  const points = [];

  steps.forEach((step) => {
    const coordinates = step.geometry && step.geometry.coordinates;
    if (!Array.isArray(coordinates) || !coordinates.length) return;

    const roadName = cleanRoadName(step.name) || cleanRoadName(step.ref) || "Ukendt vej";
    coordinates.forEach(([lng, lat]) => {
      points.push({
        lat: roundCoord(lat),
        lng: roundCoord(lng),
        roadName,
      });
    });
  });

  return points;
}

function cleanRoadName(value) {
  const name = String(value || "").trim();
  return name && name !== "undefined" ? name : "";
}

function thinRoutePoints(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => points[Math.round(index * step)]);
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
function copyRouteFromOppositeDirection(sourceRouteId = "") {
  const sourceMode = state.routeMode === "work" ? "home" : "work";
  const sourceRoute = getOppositeRoutesWithPoints().find((route) => route.id === sourceRouteId) || getActiveOppositeRoute();
  if (!sourceRoute || sourceRoute.points.length < 2) {
    const label = sourceMode === "work" ? "til arbejde" : "hjem";
    return { ok: false, message: `Der er ingen tegnet rute ${label} at kopiere endnu.` };
  }

  const points = [...sourceRoute.points]
    .reverse()
    .map((point) => ({ ...point }));
  const route = {
    id: `${state.routeMode}-${Date.now().toString(36)}`,
    name: `${sourceRoute.name || "Rute"} retur`,
    points,
  };

  getRouteList().push(route);
  state.activeRoutes[state.routeMode] = route.id;
  return { ok: true, message: `Ruten er kopieret og vendt fra ${sourceRoute.name || "den anden retning"}.` };
}

function getActiveOppositeRoute() {
  const sourceMode = state.routeMode === "work" ? "home" : "work";
  const routes = getOppositeRoutesWithPoints();
  const activeId = state.activeRoutes[sourceMode];
  return routes.find((route) => route.id === activeId) || routes[0];
}

function getOppositeRoutesWithPoints() {
  const sourceMode = state.routeMode === "work" ? "home" : "work";
  return getRouteList(sourceMode).filter((route) => route.points.length >= 2);
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
    navigator.serviceWorker
      .register("service-worker.js")
      .then((registration) => registration.update())
      .catch(() => {
        // The app still works without offline caching.
      });
  }
}
