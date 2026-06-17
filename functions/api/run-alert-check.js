import { requireDb } from "../_shared/auth.js";
import { sendEmail } from "../_shared/email.js";
import { json, optionsResponse } from "../_shared/http.js";
import { evaluateProfile } from "../_shared/traffic.js";

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;

  if (env.CRON_SECRET) {
    const supplied = request.headers.get("X-Cron-Secret") || "";
    if (supplied !== env.CRON_SECRET) return json({ error: "Manglende adgang til alarmtjek." }, 401);
  }

  const rows = await env.DB.prepare(
    "SELECT user_id, profile_json FROM profiles WHERE monitoring_enabled = 1 ORDER BY updated_at DESC LIMIT 200"
  ).all();

  let checked = 0;
  let sent = 0;
  const errors = [];

  for (const row of rows.results || []) {
    checked += 1;
    const profile = JSON.parse(row.profile_json);
    const email = profile.user && profile.user.email;
    if (!email) continue;

    const alerts = evaluateProfile(profile);
    for (const alert of alerts) {
      const strongest = [...alert.matches].sort((a, b) => b.delay - a.delay)[0];
      const dedupeKey = `${row.user_id}:${alert.route.id}:${strongest.id}:${new Date().toISOString().slice(0, 13)}`;
      const alreadySent = await env.DB.prepare("SELECT id FROM alert_log WHERE dedupe_key = ?")
        .bind(dedupeKey)
        .first();
      if (alreadySent) continue;

      try {
        await sendEmail(env, {
          to: email,
          subject: `Rutealarm: ${strongest.roadName}`,
          text: makeAlertText(profile, alert, strongest),
        });
        sent += 1;
        await env.DB.prepare("INSERT INTO alert_log (id, user_id, dedupe_key, sent_at) VALUES (?, ?, ?, ?)")
          .bind(crypto.randomUUID(), row.user_id, dedupeKey, new Date().toISOString())
          .run();
      } catch (error) {
        errors.push({ userId: row.user_id, message: error.message });
      }
    }
  }

  return json({ ok: true, checked, sent, errors });
}

function makeAlertText(profile, alert, strongest) {
  const routeName = alert.route.name || "din rute";
  const direction = alert.direction === "work" ? "Til arbejde" : "Hjem";
  const alternative = alert.best && alert.best.route.id !== alert.route.id
    ? `\n\nBedste alternativ lige nu: ${alert.best.route.name || "alternativ rute"}.`
    : "";
  return `${strongest.type}: ${strongest.title}

Rute: ${routeName}
Retning: ${direction}
Forventet ekstra tid: ca. ${strongest.delay} minutter
Kilde: ${strongest.source}
Aktiv periode: ${strongest.window}${alternative}

Du kan ændre eller slå dine alarmer fra ved at logge ind i Rutealarm.`;
}
