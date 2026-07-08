-- 002_crossing_log.sql — timestamped crossing log (Phase 4B+).
-- The device only exposes hourly totals, so the poller derives per-poll deltas
-- (new crossings since the last poll, ~10s resolution) and appends them here.
-- One row per poll-tick per direction that had activity: (ts, gate, direction, count).
CREATE TABLE IF NOT EXISTS crossing_log (
  id        BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when the poll observed the crossings
  gate      TEXT        NOT NULL CHECK (gate IN ('left', 'right')),
  direction TEXT        NOT NULL CHECK (direction IN ('in', 'out')),
  count     INTEGER     NOT NULL                 -- crossings in this direction since the previous poll
);

-- Newest-first reads for the dashboard table + range/retention scans.
CREATE INDEX IF NOT EXISTS crossing_log_ts ON crossing_log (ts DESC);
