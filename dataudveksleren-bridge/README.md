# Dataudveksleren bridge

Denne lille bridge lytter på Dataudvekslerens AMQP-kø og sender trafikhændelser videre til Rutealarm via:

```text
POST /api/ingest-traffic-events
```

Selve Rutealarm-browserappen skal ikke kende AMQP-url, brugernavn eller password.

## Cloudflare Pages

Kør først D1-migrationen:

```text
migrations/0003_traffic_events.sql
```

Sæt derefter disse variabler på Pages-projektet:

```text
TRAFFIC_INGEST_SECRET = en lang tilfældig secret
TRAFFIC_EVENTS_SOURCE = Dataudveksleren
```

`TRAFFIC_INGEST_SECRET` skal være den samme værdi, som bridgen bruger i `RUTEALARM_INGEST_SECRET`.

## Bridge secrets

Kopier `.env.example` til `.env` på den maskine/service, hvor bridgen skal køre, og udfyld:

```text
DATAUDVEKSLER_AMQP_URL
DATAUDVEKSLER_USERNAME
DATAUDVEKSLER_PASSWORD
DATAUDVEKSLER_TENANT_ID
RUTEALARM_INGEST_URL
RUTEALARM_INGEST_SECRET
RUTEALARM_SOURCE
```

## Kør lokalt

```text
npm install
npm start
```

Bridgen er lavet til at kunne håndtere JSON og en første DATEX/XML-struktur. Når vi ser en rigtig besked fra Dataudveksleren, kan parseren justeres mere præcist.
