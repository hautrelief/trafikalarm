const STORAGE_KEY = "trafikalarm.prototype.v4";
let users = [];
let sessionToken = "";

const elements = {
  loading: document.querySelector("#adminLoading"),
  error: document.querySelector("#adminError"),
  errorText: document.querySelector("#adminErrorText"),
  content: document.querySelector("#adminContent"),
  totalUsers: document.querySelector("#totalUsers"),
  monitoringUsers: document.querySelector("#monitoringUsers"),
  recentUsers: document.querySelector("#recentUsers"),
  search: document.querySelector("#userSearch"),
  rows: document.querySelector("#userRows"),
  empty: document.querySelector("#adminEmpty"),
  refresh: document.querySelector("#refreshUsers"),
  toast: document.querySelector("#adminToast"),
};

init();

function init() {
  sessionToken = readSessionToken();
  elements.search.addEventListener("input", renderUsers);
  elements.refresh.addEventListener("click", loadUsers);
  elements.rows.addEventListener("click", handleAction);
  loadUsers();
}

function readSessionToken() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")?.cloud?.sessionToken || "";
  } catch {
    return "";
  }
}

async function loadUsers() {
  setLoading(true);
  try {
    const result = await apiRequest("/api/admin-users");
    users = result.users || [];
    elements.totalUsers.textContent = result.totals.totalUsers;
    elements.monitoringUsers.textContent = result.totals.monitoringUsers;
    elements.recentUsers.textContent = result.totals.recentUsers;
    elements.error.hidden = true;
    elements.content.hidden = false;
    renderUsers();
  } catch (error) {
    elements.content.hidden = true;
    elements.errorText.textContent = error.message;
    elements.error.hidden = false;
  } finally {
    setLoading(false);
  }
}

function renderUsers() {
  const query = elements.search.value.trim().toLowerCase();
  const visible = users.filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(query));
  elements.rows.innerHTML = visible.map(userRow).join("");
  elements.empty.hidden = visible.length > 0;
}

function userRow(user) {
  const status = user.monitoringEnabled
    ? '<span class="admin-status active">Aktiv</span>'
    : '<span class="admin-status paused">Pauset</span>';
  return `<tr>
    <td data-label="Bruger"><strong>${escapeHtml(user.name || "Uden navn")}</strong><small>${escapeHtml(user.email)}</small></td>
    <td data-label="Oprettet">${formatDate(user.createdAt)}</td>
    <td data-label="Overvågning">${status}</td>
    <td data-label="Alarmer">${user.alertCount}${user.lastAlertAt ? `<small>Senest ${formatDate(user.lastAlertAt)}</small>` : ""}</td>
    <td class="admin-actions">
      <button class="button secondary compact" data-action="monitoring" data-user-id="${escapeHtml(user.id)}" data-enabled="${!user.monitoringEnabled}" type="button">${user.monitoringEnabled ? "Pause" : "Start"}</button>
      <button class="text-button" data-action="logout" data-user-id="${escapeHtml(user.id)}" type="button">Log ud</button>
      <button class="text-button danger" data-action="delete" data-user-id="${escapeHtml(user.id)}" data-user-label="${escapeHtml(user.email)}" type="button">Slet</button>
    </td>
  </tr>`;
}

async function handleAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const userId = button.dataset.userId;
  const action = button.dataset.action;

  if (action === "delete") {
    const confirmed = window.confirm(`Slet ${button.dataset.userLabel} permanent? Brugerens profil, ruter og alarmhistorik bliver også slettet.`);
    if (!confirmed) return;
  }

  button.disabled = true;
  try {
    if (action === "monitoring") {
      await apiRequest("/api/admin-users", { method: "PATCH", body: { userId, action: "setMonitoring", enabled: button.dataset.enabled === "true" } });
      showToast(button.dataset.enabled === "true" ? "Overvågningen er startet." : "Overvågningen er sat på pause.");
    } else if (action === "logout") {
      await apiRequest("/api/admin-users", { method: "PATCH", body: { userId, action: "revokeSessions" } });
      showToast("Brugeren er logget ud på alle enheder.");
    } else if (action === "delete") {
      await apiRequest("/api/admin-users", { method: "DELETE", body: { userId } });
      showToast("Brugeren er slettet.");
    }
    await loadUsers();
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
}

async function apiRequest(url, options = {}) {
  if (!sessionToken) throw new Error("Log ind på Rutevarsling med din administratorkonto først.");
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Handlingen kunne ikke gennemføres.");
  return result;
}

function setLoading(loading) {
  elements.loading.hidden = !loading;
  elements.refresh.disabled = loading;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.setTimeout(() => elements.toast.classList.remove("show"), 3200);
}

function formatDate(value) {
  if (!value) return "–";
  return new Intl.DateTimeFormat("da-DK", { dateStyle: "medium" }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}
