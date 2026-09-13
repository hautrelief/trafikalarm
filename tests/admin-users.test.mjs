import test from "node:test";
import assert from "node:assert/strict";
import { onRequestDelete, onRequestGet } from "../functions/api/admin-users.js";

test("afviser en almindelig bruger fra administrationen", async () => {
  const response = await onRequestGet({
    request: request("GET"),
    env: mockEnv({ sessionEmail: "bruger@example.dk", adminEmails: "admin@example.dk" }),
  });
  assert.equal(response.status, 403);
});

test("viser brugerstatistik til en administrator", async () => {
  const response = await onRequestGet({
    request: request("GET", undefined, "?summary=1"),
    env: mockEnv({ sessionEmail: "admin@example.dk", adminEmails: "admin@example.dk" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.admin, true);
  assert.deepEqual(body.totals, { totalUsers: 3, monitoringUsers: 2, recentUsers: 1 });
});

test("forhindrer administratoren i at slette sin egen konto", async () => {
  const response = await onRequestDelete({
    request: request("DELETE", { userId: "admin-id" }),
    env: mockEnv({ sessionEmail: "admin@example.dk", adminEmails: "admin@example.dk" }),
  });
  assert.equal(response.status, 409);
});

function request(method, body, suffix = "") {
  return new Request(`https://rutevarsling.dk/api/admin-users${suffix}`, {
    method,
    headers: { Authorization: "Bearer test-token", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function mockEnv({ sessionEmail, adminEmails }) {
  return {
    ADMIN_EMAILS: adminEmails,
    DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          async first() {
            if (sql.includes("FROM sessions")) return { user_id: "admin-id", email: sessionEmail, name: "Admin" };
            if (sql.includes("total_users")) return { total_users: 3, monitoring_users: 2, recent_users: 1 };
            if (sql.startsWith("SELECT id FROM users")) return { id: "admin-id" };
            return null;
          },
          async all() {
            return { results: [] };
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
      },
      async batch() {
        return [];
      },
    },
  };
}
