const DEFAULT_ALERT_CHECK_URL = "https://roadrunner-284.pages.dev/api/run-alert-check";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAlertCheck(env, event.scheduledTime));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, worker: "trafikalarm-alert-cron" });
    }

    if (url.pathname === "/run-now") {
      const result = await runAlertCheck(env, Date.now());
      return Response.json(result, { status: result.ok ? 200 : 500 });
    }

    return Response.json(
      {
        ok: true,
        message: "Trafikalarm scheduler er aktiv. Brug /health eller /run-now til test.",
      },
      { status: 200 }
    );
  },
};

async function runAlertCheck(env, scheduledTime) {
  const endpoint = env.PAGES_ALERT_CHECK_URL || DEFAULT_ALERT_CHECK_URL;
  const startedAt = new Date(scheduledTime || Date.now()).toISOString();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.CRON_SECRET ? { "X-Cron-Secret": env.CRON_SECRET } : {}),
      },
      body: JSON.stringify({ source: "trafikalarm-alert-cron", startedAt }),
    });

    const result = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      endpoint,
      startedAt,
      result,
    };
  } catch (error) {
    return {
      ok: false,
      endpoint,
      startedAt,
      error: error.message || "Alarmtjekket kunne ikke kaldes.",
    };
  }
}
