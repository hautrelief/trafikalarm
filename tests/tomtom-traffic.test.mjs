import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateRouteTraffic,
  classifyCongestion,
  getTomTomRouteTraffic,
  selectRouteSamples,
} from "../functions/_shared/tomtom-traffic.js";

test("klassificerer trafik efter forholdet mellem aktuel og fri hastighed", () => {
  assert.equal(classifyCongestion(80, 100), "normal");
  assert.equal(classifyCongestion(60, 100), "moderate");
  assert.equal(classifyCongestion(35, 100), "heavy");
  assert.equal(classifyCongestion(20, 100), "severe");
  assert.equal(classifyCongestion(80, 100, true), "closed");
});

test("vælger få, afrundede punkter inde på en længere rute", () => {
  const points = Array.from({ length: 11 }, (_, index) => ({ lat: 55 + index / 1000, lng: 12 + index / 1000 }));
  const samples = selectRouteSamples(points, 3);
  assert.equal(samples.length, 3);
  assert.deepEqual(samples, [
    { lat: 55.003, lng: 12.003 },
    { lat: 55.005, lng: 12.005 },
    { lat: 55.008, lng: 12.008 },
  ]);
});

test("samler segmenter til ét konservativt ruteniveau", () => {
  const result = aggregateRouteTraffic([
    { trafficLevel: "normal", currentSpeed: 80, freeFlowSpeed: 90, ratio: 80 / 90, currentTravelTime: 60, freeFlowTravelTime: 55, confidence: 0.9, roadClosure: false },
    { trafficLevel: "heavy", currentSpeed: 30, freeFlowSpeed: 80, ratio: 30 / 80, currentTravelTime: 150, freeFlowTravelTime: 70, confidence: 0.8, roadClosure: false },
  ], 3, [{ message: "Et punkt fejlede." }]);

  assert.equal(result.ok, true);
  assert.equal(result.trafficLevel, "heavy");
  assert.equal(result.sampleCount, 2);
  assert.equal(result.partial, true);
  assert.equal(result.delaySeconds, 85);
  assert.equal(result.congestedSegments, 1);
});

test("henter TomTom-data via backendnøglen og returnerer et normaliseret svar", async () => {
  const db = {
    prepare() {
      return {
        bind() { return this; },
        async first() { return null; },
        async run() { return { success: true }; },
      };
    },
  };
  const requestedUrls = [];
  const fetcher = async (url) => {
    requestedUrls.push(String(url));
    return new Response(JSON.stringify({
      flowSegmentData: {
        frc: "FRC2",
        currentSpeed: 42,
        freeFlowSpeed: 80,
        currentTravelTime: 120,
        freeFlowTravelTime: 60,
        confidence: 0.92,
        roadClosure: false,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const result = await getTomTomRouteTraffic(
    { DB: db, TOMTOM_API_KEY: "server-secret" },
    Array.from({ length: 8 }, (_, index) => ({ lat: 55.67 + index / 1000, lng: 12.56 + index / 1000 })),
    { maxSamples: 3, fetcher }
  );

  assert.equal(result.ok, true);
  assert.equal(result.trafficLevel, "heavy");
  assert.equal(result.sampleCount, 3);
  assert.equal(requestedUrls.length, 3);
  assert.ok(requestedUrls.every((url) => url.includes("key=server-secret")));
  assert.equal(JSON.stringify(result).includes("server-secret"), false);
});
