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
- `GOOGLE_MAPS_API_KEY` som secret. Det er standardkilden til live rejsetid og trafikniveau.
- `TOMTOM_API_KEY` som secret, hvis du vil have TomTom som backup. Nøglen bruges kun af backend-funktionerne og sendes aldrig til browseren.

Google Maps Platform bruges som standard til live rejsetid og til at vurdere, om der er unormalt meget trafik. Hvis Google ikke er sat op eller ikke kan levere et svar, prøver appen TomTom som backup, når `TOMTOM_API_KEY` findes.

TomTom-backup bruger som standard højst tre målepunkter pr. manuelt rutetjek og et samlet budget på 600 segmentopslag pr. UTC-døgn. Grænserne kan justeres med de almindelige variabler `TOMTOM_ROUTE_SAMPLE_LIMIT`, `TOMTOM_MINUTE_LIMIT` og `TOMTOM_DAILY_SAMPLE_LIMIT`. Segmentdata caches hos Cloudflare i 60 sekunder.

Indtil `TOMTOM_API_KEY` er sat, fortsætter appen automatisk med Google-trafikkilden. Dermed virker live trafik stadig uden TomTom-backup.

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

## 7. Officielle trafikhændelser

Appen bruger ikke længere lokale demo-hændelser som trafikdata. Den matcher kun ruter mod hændelser fra en officiel JSON/GeoJSON-kilde, når kilden er sat op i Cloudflare.

På Pages-projektet under **Settings** → **Variables and secrets** kan du tilføje:

- `TRAFFIC_EVENTS_URL` som almindelig variabel med URL'en til den officielle trafikfeed.
- `TRAFFIC_EVENTS_SOURCE` som almindelig variabel, fx `Vejdirektoratet`, så kilden står pænt i appen og i mails.

Hvis `TRAFFIC_EVENTS_URL` ikke er sat, bruger appen stadig Google live trafik med TomTom som backup, men den viser ikke falske hændelser på ruten.

### Dataudveksleren via AMQP

Hvis Dataudveksleren leverer datasættet via AMQP, skal der bruges en lille bridge i stedet for en direkte `TRAFFIC_EVENTS_URL`.

1. Kør `migrations/0003_traffic_events.sql` i D1.
2. Sæt `TRAFFIC_INGEST_SECRET` på Pages-projektet som secret.
3. Sæt `TRAFFIC_EVENTS_SOURCE` til `Dataudveksleren`.
4. Kør bridgen i `dataudveksleren-bridge/` på en server eller service, der kan holde en AMQP-forbindelse åben.

Bridgen sender hændelser ind i `/api/ingest-traffic-events`, og appen læser derefter de seneste hændelser fra D1.
