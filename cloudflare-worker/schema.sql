-- ShiftFlow D1 Database Schema
-- Execute via Wrangler:
--   npx wrangler d1 execute shiftflow-db --remote --file=./schema.sql
-- (Also auto-initialized on first request if tables do not yet exist.)

CREATE TABLE IF NOT EXISTS roster_meta (
  id TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 0,
  origin_client_id TEXT,
  sched_hash TEXT,
  admin_password TEXT,
  show_process_schedule INTEGER NOT NULL DEFAULT 1,
  published_range_json TEXT,
  unlocked_months_json TEXT
);

CREATE TABLE IF NOT EXISTS roster_sections (
  section_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  event TEXT NOT NULL,
  client_id TEXT,
  origin TEXT,
  updated_at TEXT,
  version INTEGER,
  revision INTEGER,
  sched_hash TEXT,
  details_json TEXT
);

CREATE TABLE IF NOT EXISTS roster_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  snapshot_type TEXT NOT NULL,
  label TEXT,
  version INTEGER,
  revision INTEGER,
  sched_hash TEXT,
  shift_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_audit_recent ON sync_audit (id DESC);
CREATE INDEX IF NOT EXISTS idx_roster_snapshots_recent ON roster_snapshots (id DESC);
