-- 001_init.sql — People Counter schema (idempotent).
-- Translated from the data model in CLAUDE.md (originally Mongo) to PostgreSQL.

-- counting_events — one row per person crossing the line (raw, from AI Engine).
CREATE TABLE IF NOT EXISTS counting_events (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gate        TEXT        NOT NULL CHECK (gate IN ('left', 'right')),
  direction   TEXT        NOT NULL CHECK (direction IN ('in', 'out')),
  ts          TIMESTAMPTZ NOT NULL,          -- crossing time (from AI; else receive time)
  track_id    TEXT        NOT NULL,          -- AI track id — dedup key against webhook retries
  confidence  REAL,                          -- optional, if AI sends it
  raw         JSONB                          -- raw AI payload, kept for debugging
);

-- Dedup: a given (gate, direction, track_id) is counted once even if the
-- webhook fires repeatedly. Enforced at the DB via ON CONFLICT in ingest.
CREATE UNIQUE INDEX IF NOT EXISTS counting_events_dedup
  ON counting_events (gate, direction, track_id);

-- Per-gate time scans (today / hourly rollups from raw).
CREATE INDEX IF NOT EXISTS counting_events_gate_ts
  ON counting_events (gate, ts);

-- Retention purge scans by ts (Postgres has no TTL; see scripts/purgeOld.js).
CREATE INDEX IF NOT EXISTS counting_events_ts
  ON counting_events (ts);


-- counting_hourly — pre-aggregated counts per hour × gate × direction (fast 7Day).
CREATE TABLE IF NOT EXISTS counting_hourly (
  gate        TEXT        NOT NULL CHECK (gate IN ('left', 'right')),
  direction   TEXT        NOT NULL CHECK (direction IN ('in', 'out')),
  hour_bucket TIMESTAMPTZ NOT NULL,          -- date_trunc('hour', ts)
  count       INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (gate, direction, hour_bucket)
);


-- occupancy_state — current snapshot of people inside per gate (read without agg).
CREATE TABLE IF NOT EXISTS occupancy_state (
  gate       TEXT        PRIMARY KEY CHECK (gate IN ('left', 'right')),
  in_count   INTEGER     NOT NULL DEFAULT 0,
  out_count  INTEGER     NOT NULL DEFAULT 0,
  occupancy  INTEGER     NOT NULL DEFAULT 0,  -- GREATEST(0, in_count - out_count)
  day        DATE        NOT NULL,            -- business day of this state (reset check)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
