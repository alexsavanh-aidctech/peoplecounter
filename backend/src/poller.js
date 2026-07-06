// videoStatServer poller (Phase 4B) — the pull-based ingest.
//
// Every pollIntervalSeconds it asks each camera for today's hourly NumberStat
// counts and writes them into the SAME tables the API reads (counting_hourly +
// occupancy_state). The device is the source of truth, so writes are idempotent
// SETs (not increments): each poll overwrites today's numbers. This replaces the
// event-driven ingest for these gates; the frontend/API shapes are unchanged.
//
// Run: node backend/src/poller.js   (needs DB + camera LAN reachable)
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { query, withTransaction, runMigrations, closePool } from './db.js';
import { VideoStatClient } from './dahuaVideoStat.js';
import { businessDay } from './ingest.js';

// Map a camera's device Entered/Exited to our in/out, honoring the per-camera
// swap flag (some doors are wired so "Entered" means leaving).
function toInOut(row, swap) {
  return swap
    ? { in: row.exited, out: row.entered }
    : { in: row.entered, out: row.exited };
}

// Write today's hourly rows + the day's occupancy snapshot for one gate, atomically.
async function persist(gate, rows, swap, now) {
  const day = businessDay(now);
  let sumIn = 0;
  let sumOut = 0;

  await withTransaction(async (client) => {
    for (const row of rows) {
      if (!row.startTime) continue;
      const { in: inC, out: outC } = toInOut(row, swap);
      sumIn += inC;
      sumOut += outC;
      // Authoritative SET (not +=): device value wins for this hour bucket.
      await client.query(
        `INSERT INTO counting_hourly (gate, direction, hour_bucket, count)
         VALUES ($1, 'in', $2, $3), ($1, 'out', $2, $4)
         ON CONFLICT (gate, direction, hour_bucket)
         DO UPDATE SET count = EXCLUDED.count`,
        [gate, row.startTime, inC, outC],
      );
    }

    // occupancy = today's entries minus exits, clamped at 0 (can't go negative).
    const occupancy = Math.max(0, sumIn - sumOut);
    await client.query(
      `INSERT INTO occupancy_state (gate, in_count, out_count, occupancy, day, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (gate) DO UPDATE
         SET in_count = $2, out_count = $3, occupancy = $4, day = $5, updated_at = now()`,
      [gate, sumIn, sumOut, occupancy, day],
    );
  });

  return { sumIn, sumOut, occupancy: Math.max(0, sumIn - sumOut) };
}

// One poll for one camera. Never throws — logs and lets the loop continue so one
// bad camera can't stop the other.
async function pollCamera(cam, client) {
  if (!cam.ip || !cam.user || !cam.pass) {
    console.warn(`[poller] ${cam.gate}: no camera creds in .env — skipping`);
    return;
  }
  try {
    const now = new Date();
    const rows = await client.fetchTodayHourly(now);
    const { sumIn, sumOut, occupancy } = await persist(cam.gate, rows, cam.swapInOut, now);
    console.log(`[poller] ${cam.gate}: in=${sumIn} out=${sumOut} occupancy=${occupancy} (swap=${cam.swapInOut}, ${rows.length} hourly rows)`);
  } catch (err) {
    console.error(`[poller] ${cam.gate}: poll failed — ${err.message}`);
  }
}

export async function pollOnce(clients) {
  await Promise.all(config.cameras.map((cam) => pollCamera(cam, clients.get(cam.gate))));
}

async function start() {
  await runMigrations();
  const clients = new Map(config.cameras.map((cam) => [cam.gate, new VideoStatClient(cam)]));
  const intervalMs = Math.max(5, config.pollIntervalSeconds) * 1000;
  console.log(`[poller] starting — every ${config.pollIntervalSeconds}s, cameras: ${config.cameras.map((c) => c.gate).join(', ')}`);

  await pollOnce(clients); // first poll immediately

  const loop = setInterval(() => {
    pollOnce(clients).catch((e) => console.error('[poller] cycle error:', e.message));
  }, intervalMs);

  // keepAlive sessions warm between polls (best-effort).
  const ka = setInterval(() => {
    for (const c of clients.values()) c.keepAlive().catch(() => {});
  }, 30000);

  const shutdown = async (sig) => {
    console.log(`[poller] ${sig} — shutting down`);
    clearInterval(loop);
    clearInterval(ka);
    await closePool();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((err) => {
    console.error('[poller] fatal:', err);
    process.exit(1);
  });
}
