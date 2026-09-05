import test from "node:test";
import assert from "node:assert/strict";
import { evaluateProfile, inferDirection, inferDirections } from "../functions/_shared/traffic.js";

const profile = {
  schedule: {
    days: ["mon", "tue", "wed", "thu", "fri"],
    departFrom: "06:00",
    departTo: "22:00",
    returnFrom: "15:00",
    returnTo: "22:00",
    minDelay: 5,
  },
  routes: {
    work: [{ id: "work-route", points: [{ lat: 55.67, lng: 12.56 }, { lat: 55.68, lng: 12.57 }] }],
    home: [{ id: "home-route", points: [{ lat: 55.68, lng: 12.57 }, { lat: 55.67, lng: 12.56 }] }],
  },
};

test("bruger dansk sommertid i stedet for Workerens UTC-tid", () => {
  const now = new Date("2026-06-24T04:30:00.000Z");
  assert.equal(inferDirection(profile, now), "work");
});

test("kontrollerer både ud- og hjemruter når tidsvinduerne overlapper", () => {
  const now = new Date("2026-06-24T14:30:00.000Z");
  assert.deepEqual(inferDirections(profile, now), ["work", "home"]);

  const event = {
    id: "event-1",
    lat: 55.675,
    lng: 12.565,
    roadName: "",
    radiusMeters: 1000,
    window: "00:00-23:59",
    delay: 10,
    severity: "medium",
  };
  const alerts = evaluateProfile(profile, now, [event]);
  assert.deepEqual(new Set(alerts.map((alert) => alert.direction)), new Set(["work", "home"]));
});

test("understøtter tidsvinduer der går hen over midnat", () => {
  const overnight = {
    ...profile,
    schedule: { ...profile.schedule, departFrom: "22:00", departTo: "02:00", returnFrom: "03:00", returnTo: "04:00" },
  };
  assert.deepEqual(inferDirections(overnight, new Date("2026-06-24T22:30:00.000Z")), ["work"]);
});
