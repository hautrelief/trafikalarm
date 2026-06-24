CREATE TABLE IF NOT EXISTS traffic_events (
  id TEXT PRIMARY KEY,
  event_json TEXT NOT NULL,
  source TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  road_name TEXT,
  severity TEXT,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_traffic_events_expires
  ON traffic_events(expires_at);

CREATE INDEX IF NOT EXISTS idx_traffic_events_source
  ON traffic_events(source, updated_at);
