const DEFAULT_ALERT_CHECK_URL = "https://roadrunner-284.pages.dev/api/run-alert-check";

export default {
  async scheduled(event, env) {
    const result = await runAlertCheck(env, event.scheduledTime);
    if (!result.ok) {
      console.error({ message: "Alarmtjek fejlede", ...result });
      throw new Error(`Alarmtjek fejlede med status ${result.status || "ukendt"}.`);
    }
    console.log({
      message: "Alarmtjek fuldført",
      startedAt: result.startedAt,
      status: result.status,
      checked: result.result?.checked || 0,
      sent: result.result?.sent || 0,
      errors: result.result?.errors?.length || 0,
    });
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, worker: "trafikalarm-alert-cron" });
    }

    if (url.pathname === "/run-now" && request.method === "POST") {
      const supplied = request.headers.get("X-Cron-Secret") || "";
      if (!env.CRON_SECRET || !(await secretsMatch(supplied, env.CRON_SECRET))) {
        return Response.json({ ok: false, error: "Manglende adgang." }, { status: 401 });
      }
      const result = await runAlertCheck(env, Date.now());
      return Response.json(result, { status: result.ok ? 200 : 500 });
    }

    return Response.json(
      {
        ok: true,
        message: "Trafikalarm scheduler er aktiv.",
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

async function secretsMatch(provided, expected) {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}
