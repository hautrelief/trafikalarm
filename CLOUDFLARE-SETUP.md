# Trafikalarm på Cloudflare

Denne version kan gemme brugerprofiler, ruter og alarmvalg i Cloudflare D1 og sende mails via Resend.

## 1. Opret D1-database

I Cloudflare:

1. Gå til **Storage & databases**.
2. Vælg **D1 SQL Database**.
3. Opret en database, fx `trafikalarm-db`.
4. Kør SQL-filen `migrations/0001_initial.sql` i databasen.

## 2. Tilføj database til Pages

På Pages-projektet:

1. Gå til **Workers & Pages**.
2. Åbn Pages-projektet.
3. Gå til **Settings**.
4. Vælg **Bindings**.
5. Tilføj en **D1 database binding** med navnet `DB`.
6. Vælg din D1-database.

Binding-navnet skal være præcis `DB`, fordi API-koden bruger `env.DB`.

## 3. Tilføj miljøvariabler

På Pages-projektet under **Settings** → **Variables and secrets**:

- `RESEND_API_KEY` som secret.
- `ALERT_FROM` som almindelig variabel, fx `Trafikalarm <onboarding@resend.dev>`.
- `CRON_SECRET` som secret, fx en lang tilfældig tekst.

Når du får dit eget domæne godkendt i Resend, kan `ALERT_FROM` ændres til en rigtig afsender på dit domæne.

## 4. Deploy igen

Lav en ny deployment efter databasebinding og variabler er sat. Ellers bruger Cloudflare stadig den gamle opsætning.

## 5. Alarmtjek uden åben browser

Endpointet:

```text
POST /api/run-alert-check
```

Det gennemgår gemte profiler og sender mails, hvis en gemt rute matcher en trafikmelding.

Kald det med headeren:

```text
X-Cron-Secret: værdien-fra-CRON_SECRET
```

På sigt bør dette kaldes af en Cloudflare Worker Cron Trigger hvert 5. minut i pendler-tidsrum.

## 6. Automatisk tjek hvert 5. minut

Projektet har nu en lille Worker i `workers/alert-cron.js`, som kalder Pages-endpointet automatisk.

Den bruger konfigurationen i `wrangler.alert-cron.toml`:

```text
crons = ["*/5 * * * *"]
```

Det betyder, at Cloudflare forsøger at køre alarmtjekket hvert 5. minut. Selve appen filtrerer bagefter på brugerens ugedage og tidspunkter, så en bruger kun får mail, hvis vedkommendes rute og tidsvindue er relevant.

Workerens navn er:

```text
trafikalarm-alert-cron
```

Den kalder:

```text
https://roadrunner-284.pages.dev/api/run-alert-check
```

### Vigtigt om secret

Sæt den samme `CRON_SECRET` to steder:

1. På Pages-projektet `roadrunner`.
2. På Worker-projektet `trafikalarm-alert-cron`.

Pages bruger den til at beskytte `/api/run-alert-check`, og Worker bruger den til at bevise, at kaldet kommer fra din scheduler.

### Test

Når Workeren er deployet, kan den testes med:

```text
https://trafikalarm-alert-cron.<dit-worker-subdomain>.workers.dev/run-now
```

Svaret bør indeholde `ok: true` og et resultat med antal profiler tjekket og mails sendt.

## 7. Officielle trafikh�ndelser

Appen bruger ikke l�ngere lokale demo-h�ndelser som trafikdata. Den matcher kun ruter mod h�ndelser fra en officiel JSON/GeoJSON-kilde, n�r kilden er sat op i Cloudflare.

P� Pages-projektet under **Settings** -> **Variables and secrets** kan du tilf�je:

- `TRAFFIC_EVENTS_URL` som almindelig variabel med URL'en til den officielle trafikfeed.
- `TRAFFIC_EVENTS_SOURCE` som almindelig variabel, fx `Vejdirektoratet`, s� kilden st�r p�nt i appen og i mails.

Hvis `TRAFFIC_EVENTS_URL` ikke er sat, bruger appen stadig Google-rejsetid, men den viser ikke falske h�ndelser p� ruten.
