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
