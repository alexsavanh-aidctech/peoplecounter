// Edge-case checks for ingest — dedup, occupancy clamp at 0, cross-day reset.
// Talks to the DB directly (via ingest) so it can forge ts for the day-rollover
// case. DESTRUCTIVE: truncates the three tables. Point DATABASE_URL at a dev DB.
//
//   node backend/scripts/testEdgeCases.js
import { pathToFileURL } from 'node:url';
import { query, closePool } from '../src/db.js';
import { runMigrations } from '../src/db.js';
import { recordEvent } from '../src/ingest.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name} — ${detail ?? ''}`);
  }
}

async function occupancy(gate) {
  const { rows } = await query(
    `SELECT in_count, out_count, occupancy, day::text AS day
     FROM occupancy_state WHERE gate = $1`,
    [gate],
  );
  return rows[0];
}

async function reset() {
  await query('TRUNCATE counting_events, counting_hourly, occupancy_state');
}

async function run() {
  await runMigrations();

  // ── 1. Dedup — same (gate, direction, trackId) counted once ──
  console.log('dedup:');
  await reset();
  const first = await recordEvent({ gate: 'left', direction: 'in', trackId: 'T1' });
  const second = await recordEvent({ gate: 'left', direction: 'in', trackId: 'T1' });
  check('first insert is new', first.duplicate === false, JSON.stringify(first));
  check('second insert is duplicate', second.duplicate === true, JSON.stringify(second));
  const evCount = (await query(`SELECT count(*)::int AS n FROM counting_events`)).rows[0].n;
  check('only one raw event stored', evCount === 1, `got ${evCount}`);
  const hourly = (await query(`SELECT count FROM counting_hourly WHERE gate='left' AND direction='in'`)).rows[0];
  check('hourly counted once', hourly && hourly.count === 1, JSON.stringify(hourly));
  const occ1 = await occupancy('left');
  check('occupancy in=1 after dedup', occ1.in_count === 1 && occ1.occupancy === 1, JSON.stringify(occ1));

  // ── 2. Clamp — occupancy never negative when out > in ──
  console.log('clamp:');
  await reset();
  await recordEvent({ gate: 'right', direction: 'out', trackId: 'O1' });
  await recordEvent({ gate: 'right', direction: 'out', trackId: 'O2' });
  const occ2 = await occupancy('right');
  check('out_count=2', occ2.out_count === 2, JSON.stringify(occ2));
  check('occupancy clamped to 0', occ2.occupancy === 0, JSON.stringify(occ2));

  // ── 3. Cross-day reset — a new day's first event zeroes prior counts ──
  console.log('cross-day reset:');
  await reset();
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
  await recordEvent({ gate: 'left', direction: 'in', trackId: 'Y1', ts: yesterday });
  await recordEvent({ gate: 'left', direction: 'in', trackId: 'Y2', ts: yesterday });
  await recordEvent({ gate: 'left', direction: 'in', trackId: 'Y3', ts: yesterday });
  const occYesterday = await occupancy('left');
  check('yesterday accrued in=3', occYesterday.in_count === 3, JSON.stringify(occYesterday));

  await recordEvent({ gate: 'left', direction: 'in', trackId: 'TODAY1', ts: new Date() });
  const occToday = await occupancy('left');
  check('today reset then counted in=1', occToday.in_count === 1, JSON.stringify(occToday));
  check('today occupancy=1', occToday.occupancy === 1, JSON.stringify(occToday));
  check('day advanced past yesterday', occToday.day !== occYesterday.day, JSON.stringify(occToday));

  console.log('');
  if (failures === 0) {
    console.log('ALL EDGE-CASE CHECKS PASSED');
  } else {
    console.error(`${failures} CHECK(S) FAILED`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run()
    .catch((err) => {
      console.error('test run error:', err);
      process.exitCode = 1;
    })
    .finally(closePool);
}
