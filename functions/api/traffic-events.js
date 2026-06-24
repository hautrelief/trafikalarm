import { json, optionsResponse } from "../_shared/http.js";
import { fetchTrafficEvents } from "../_shared/traffic-events.js";

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ env }) {
  try {
    const result = await fetchTrafficEvents(env);
    return noStoreJson(result);
  } catch (error) {
    return noStoreJson({
      configured: true,
      events: [],
      error: error.message || "Trafikkilden kunne ikke hentes.",
    }, 502);
  }
}

function noStoreJson(body, status = 200) {
  const response = json(body, status);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
