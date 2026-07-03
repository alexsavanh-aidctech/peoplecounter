// Central config — every env-driven value is read HERE and nowhere else.
// Rationale: keeps secrets (camera creds, DB url) out of scattered process.env
// reads, and gives one place to see/validate the whole runtime surface.

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Camera config is grouped per gate so routes/live-config never touch env directly.
const cameras = [
  {
    gate: 'left',
    name: process.env.CAM_LEFT_NAME || 'AIDC Tech',
    rtspUrl: process.env.CAM_LEFT_RTSP || '',
    hlsUrl: process.env.CAM_LEFT_HLS || '',
  },
  {
    gate: 'right',
    name: process.env.CAM_RIGHT_NAME || 'AIDC',
    rtspUrl: process.env.CAM_RIGHT_RTSP || '',
    hlsUrl: process.env.CAM_RIGHT_HLS || '',
  },
];

export const config = {
  port: num(process.env.PORT, 4100),
  tz: process.env.TZ || 'Asia/Bangkok',
  databaseUrl: process.env.DATABASE_URL || 'postgres://people:people@localhost:5432/peoplecounter',
  // Hour (0-23) at which occupancy resets each day. Kept configurable in case a
  // site's "day" starts at a shift boundary rather than midnight.
  occupancyResetHour: num(process.env.OCCUPANCY_RESET_HOUR, 0),
  cameras,
};

// Valid domain values reused by ingest + routes for validation.
export const GATES = ['left', 'right'];
export const DIRECTIONS = ['in', 'out'];
