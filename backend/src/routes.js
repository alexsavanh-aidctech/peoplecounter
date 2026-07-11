// HTTP routes. Ingest endpoints answer 200 even on failure (a 5xx would make the
// AI webhook retry and pile on); dashboard endpoints use real status codes.
import { Router } from 'express';
import { config, GATES } from './config.js';
import { query } from './db.js';
import { recordEvent, resetOccupancy, businessDay } from './ingest.js';
import { VideoStatClient } from './dahuaVideoStat.js';
import { signToken, checkPassword, verifyToken, readCookie, STREAM_COOKIE } from './auth.js';

export const router = Router();

// ── Auth (public — NOT behind requireAuth; see server.js allowlist) ─────

// Shared-password login. Correct password → { token }; also drops the token as
// a cookie so the HLS stream (which can't carry a Bearer header) authenticates.
router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!checkPassword(password)) {
    return res.status(401).json({ error: 'wrong password' });
  }
  const token = signToken();
  // Secure only when the request actually arrived over HTTPS (prod behind the
  // proxy sets X-Forwarded-Proto) so a plain-HTTP LAN/compose run still works.
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(STREAM_COOKIE, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    maxAge: config.authTokenDays * 24 * 60 * 60 * 1000,
  });
  return res.json({ token });
});

// Clears the stream cookie. Public so it works even with an expired token.
router.post('/logout', (_req, res) => {
  res.clearCookie(STREAM_COOKIE, { path: '/' });
  return res.json({ ok: true });
});

// nginx auth_request target for /hls/. Reads the token from the cookie (segment
// requests have no Authorization header) and answers 2xx allow / 401 deny.
// Stateless jwt.verify only — no DB — so it stays cheap per HLS segment.
router.get('/verify-stream', (req, res) => {
  const token = readCookie(req, STREAM_COOKIE);
  if (!verifyToken(token)) return res.status(401).end();
  return res.status(204).end();
});

// Detection geometry (counting line + zone) per camera, cached — it changes only
// when someone re-draws the rule on the camera, so a 5-min cache is plenty.
const geoCache = new Map(); // gate -> { at, geometry }
const GEO_TTL_MS = 60 * 1000; // 60s — re-drawn camera lines show up within a minute

// ── Ingest (from AI Engine) ──────────────────────────────────────────

// Case A: AI already resolved line-crossing → { gate, direction, trackId, ts?, confidence? }
router.post('/events', async (req, res) => {
  try {
    const result = await recordEvent(req.body || {});
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    // Never 5xx here: log and 200 so a retrying webhook can't stampede us.
    console.error('[events] ingest error:', err.message);
    res.status(200).json({ ok: false, error: err.message });
  }
});

// Case B (stub): AI sends track id + centroid; virtual-line logic comes once we
// know the real payload. Log and ack so nothing is lost meanwhile.
router.post('/events/crossing', (req, res) => {
  console.log('[events/crossing] stub payload:', JSON.stringify(req.body || {}));
  res.status(200).json({ ok: true, todo: 'line-crossing logic pending AI payload spec' });
});

// ── Dashboard ────────────────────────────────────────────────────────

// Per-gate occupancy snapshot + combined total for the current business day.
router.get('/summary', async (_req, res) => {
  try {
    const today = businessDay(new Date());
    const { rows } = await query(
      `SELECT gate, in_count, out_count, occupancy, day::text AS day
       FROM occupancy_state`,
    );
    const byGate = new Map(rows.map((r) => [r.gate, r]));

    const gates = {};
    const total = { in: 0, out: 0, occupancy: 0 };
    for (const gate of GATES) {
      const r = byGate.get(gate);
      // A stale row (day != today) means no events yet today → show zeros, not
      // yesterday's numbers. The reset itself happens on the day's first event.
      const fresh = r && r.day === today;
      const entry = {
        in: fresh ? r.in_count : 0,
        out: fresh ? r.out_count : 0,
        occupancy: fresh ? r.occupancy : 0,
      };
      gates[gate] = entry;
      total.in += entry.in;
      total.out += entry.out;
      total.occupancy += entry.occupancy;
    }

    res.json({ gates, total, date: today });
  } catch (err) {
    console.error('[summary] error:', err.message);
    res.status(500).json({ error: 'failed to load summary' });
  }
});

// Hourly in/out series over [from, to). Reads counting_hourly (kept live by
// ingest). gate = left | right | all.
router.get('/timeseries', async (req, res) => {
  const { from, to } = req.query;
  const gate = req.query.gate || 'all';
  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (!from || !to || Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return res.status(400).json({ error: 'from and to must be valid ISO timestamps' });
  }
  if (gate !== 'all' && !GATES.includes(gate)) {
    return res.status(400).json({ error: `invalid gate: ${gate}` });
  }

  try {
    const params = [fromDate, toDate];
    let gateFilter = '';
    if (gate !== 'all') {
      params.push(gate);
      gateFilter = `AND gate = $3`;
    }
    const { rows } = await query(
      `SELECT hour_bucket,
              COALESCE(SUM(count) FILTER (WHERE direction = 'in'), 0)  AS in,
              COALESCE(SUM(count) FILTER (WHERE direction = 'out'), 0) AS out
       FROM counting_hourly
       WHERE hour_bucket >= $1 AND hour_bucket < $2 ${gateFilter}
       GROUP BY hour_bucket
       ORDER BY hour_bucket`,
      params,
    );
    const series = rows.map((r) => ({
      t: r.hour_bucket.toISOString(),
      in: Number(r.in),
      out: Number(r.out),
    }));
    res.json({ series });
  } catch (err) {
    console.error('[timeseries] error:', err.message);
    res.status(500).json({ error: 'failed to load timeseries' });
  }
});

// Manual occupancy reset for one gate or all (mid-day drift correction).
router.post('/occupancy/reset', async (req, res) => {
  const gate = req.query.gate || 'all';
  if (gate !== 'all' && !GATES.includes(gate)) {
    return res.status(400).json({ error: `invalid gate: ${gate}` });
  }
  try {
    const result = await resetOccupancy(gate);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[reset] error:', err.message);
    res.status(500).json({ error: 'failed to reset occupancy' });
  }
});

// Camera stream URLs for the frontend live view (from env via config).
router.get('/live-config', (_req, res) => {
  res.json({
    cameras: config.cameras.map((c) => ({
      gate: c.gate,
      name: c.name,
      hlsUrl: c.hlsUrl,
    })),
  });
});

// Per-camera detection geometry for the live-view overlay (counting line + zone),
// read from the camera over RPC and cached. Failure is non-fatal: the gate just
// returns geometry: null and the frontend draws no overlay.
router.get('/detect-config', async (_req, res) => {
  const cameras = [];
  for (const cam of config.cameras) {
    let entry = geoCache.get(cam.gate);
    if (!entry || Date.now() - entry.at > GEO_TTL_MS) {
      let geometry = null;
      if (cam.ip && cam.user && cam.pass) {
        try {
          geometry = await new VideoStatClient(cam).fetchGeometry();
        } catch (err) {
          console.error(`[detect-config] ${cam.gate}: ${err.message}`);
        }
      }
      entry = { at: Date.now(), geometry };
      geoCache.set(cam.gate, entry);
    }
    cameras.push({ gate: cam.gate, geometry: entry.geometry });
  }
  res.json({ cameras });
});

// Recent crossing log — one row per poll-tick per direction that had activity
// (ts, gate, direction, count). Newest first. ?limit=N (default 50, cap 200).
router.get('/crossings', async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const gate = req.query.gate;
  if (gate && gate !== 'all' && !GATES.includes(gate)) {
    return res.status(400).json({ error: `invalid gate: ${gate}` });
  }
  try {
    const filtered = gate && gate !== 'all';
    const sql = filtered
      ? `SELECT ts, gate, direction, count FROM crossing_log WHERE gate = $1 ORDER BY ts DESC LIMIT $2`
      : `SELECT ts, gate, direction, count FROM crossing_log ORDER BY ts DESC LIMIT $1`;
    const { rows } = await query(sql, filtered ? [gate, limit] : [limit]);
    res.json({
      crossings: rows.map((r) => ({
        ts: r.ts.toISOString(),
        gate: r.gate,
        direction: r.direction,
        count: r.count,
      })),
    });
  } catch (err) {
    console.error('[crossings] error:', err.message);
    res.status(500).json({ error: 'failed to load crossings' });
  }
});

// Health — also pings the DB so a broken pool surfaces as unhealthy.
router.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'db unavailable' });
  }
});
