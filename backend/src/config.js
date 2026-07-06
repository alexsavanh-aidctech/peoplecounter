// Central config — every env-driven value is read HERE and nowhere else.
// Rationale: keeps secrets (camera creds, DB url) out of scattered process.env
// reads, and gives one place to see/validate the whole runtime surface.

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// MediaMTX serves HLS at <base>/<gate>/index.m3u8. The RTSP source (with camera
// credentials) is built inside MediaMTX from env — the backend only needs the
// public HLS URL to hand to the frontend, never the camera password.
const hlsBase = (process.env.MEDIAMTX_HLS_BASE || 'http://localhost:8888').replace(/\/$/, '');

// Camera config is grouped per gate so routes/live-config never touch env directly.
// Includes RPC creds + poll settings for the videoStatServer poller (Phase 4B).
function camera(gate, defaultName) {
  const prefix = gate === 'left' ? 'CAM_LEFT' : 'CAM_RIGHT';
  return {
    gate,
    name: process.env[`${prefix}_NAME`] || defaultName,
    hlsUrl: `${hlsBase}/${gate}/index.m3u8`,
    // transcode flag surfaced for docs/diagnostics; MediaMTX does the actual work.
    transcode: process.env[`${prefix}_TRANSCODE`] === '1',
    // ── videoStatServer pull (poller) ──
    ip: process.env[`${prefix}_IP`] || '',
    user: process.env[`${prefix}_USER`] || '',
    pass: process.env[`${prefix}_PASS`] || '',
    channel: num(process.env[`${prefix}_RPC_CHANNEL`], 0), // direct camera = 0
    areaId: num(process.env[`${prefix}_AREA_ID`], 1), // NumberStat rule AreaID
    // Some doors have the count line oriented so the device's Entered = leaving.
    // Set CAM_*_SWAP_INOUT=1 to swap Entered<->Exited into our in/out (verify vs OSD).
    swapInOut: process.env[`${prefix}_SWAP_INOUT`] === '1',
  };
}

const cameras = [camera('left', 'AIDC Tech'), camera('right', 'AIDC')];

export const config = {
  port: num(process.env.PORT, 4100),
  tz: process.env.TZ || 'Asia/Bangkok',
  databaseUrl: process.env.DATABASE_URL || 'postgres://people:people@localhost:5432/peoplecounter',
  // Hour (0-23) at which occupancy resets each day. Kept configurable in case a
  // site's "day" starts at a shift boundary rather than midnight.
  occupancyResetHour: num(process.env.OCCUPANCY_RESET_HOUR, 0),
  // How often the poller pulls videoStatServer counts (seconds).
  pollIntervalSeconds: num(process.env.POLL_INTERVAL_SECONDS, 30),
  cameras,
};

// Valid domain values reused by ingest + routes for validation.
export const GATES = ['left', 'right'];
export const DIRECTIONS = ['in', 'out'];
