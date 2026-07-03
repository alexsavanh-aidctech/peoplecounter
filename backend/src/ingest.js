// Ingest — turn a single line-crossing event into durable state.
import { withTransaction } from './db.js';
import { config, GATES, DIRECTIONS } from './config.js';

// Business day (YYYY-MM-DD) that an event belongs to, in the server TZ, with the
// day boundary shifted to OCCUPANCY_RESET_HOUR. With the default reset hour 0
// this is just the local calendar date. We key occupancy_state.day off this so a
// new day's first event triggers a clean reset (see occupancy note below).
function businessDay(ts) {
  const shifted = new Date(ts.getTime() - config.occupancyResetHour * 3600 * 1000);
  // en-CA formats as YYYY-MM-DD; timeZone makes it independent of the host clock.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
}

/**
 * Record one crossing event. Atomic: the raw insert, the hourly rollup, and the
 * occupancy update all happen in a single transaction so they can never drift.
 *
 * @returns {Promise<{duplicate:boolean, gate?, direction?, day?}>}
 */
export async function recordEvent({ gate, direction, trackId, ts, confidence, raw }) {
  if (!GATES.includes(gate)) {
    throw new Error(`invalid gate: ${gate}`);
  }
  if (!DIRECTIONS.includes(direction)) {
    throw new Error(`invalid direction: ${direction}`);
  }
  if (trackId === undefined || trackId === null || trackId === '') {
    throw new Error('trackId is required');
  }

  // Default to receive-time when the AI omits ts.
  const when = ts ? new Date(ts) : new Date();
  if (Number.isNaN(when.getTime())) {
    throw new Error(`invalid ts: ${ts}`);
  }
  const day = businessDay(when);

  return withTransaction(async (client) => {
    // Dedup at the DB: the unique (gate, direction, track_id) index means a
    // retried webhook is a no-op. rowCount 0 => we've already counted this.
    const insert = await client.query(
      `INSERT INTO counting_events (gate, direction, ts, track_id, confidence, raw)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (gate, direction, track_id) DO NOTHING`,
      [gate, direction, when, String(trackId), confidence ?? null, raw ? JSON.stringify(raw) : null],
    );
    if (insert.rowCount === 0) {
      return { duplicate: true, gate, direction };
    }

    // Hourly rollup: one bucket per gate × direction × hour of the crossing.
    await client.query(
      `INSERT INTO counting_hourly (gate, direction, hour_bucket, count)
       VALUES ($1, $2, date_trunc('hour', $3::timestamptz), 1)
       ON CONFLICT (gate, direction, hour_bucket)
       DO UPDATE SET count = counting_hourly.count + 1`,
      [gate, direction, when],
    );

    // Occupancy: live per-gate snapshot. Reset first if this event opens a new
    // day — AI events can be dropped (people walking close/fast), so carrying
    // counts across days would let the error accumulate; a daily 0 avoids drift.
    // FOR UPDATE serializes concurrent events on the same gate row.
    const stateRes = await client.query(
      `SELECT in_count, out_count, day::text AS day FROM occupancy_state
       WHERE gate = $1 FOR UPDATE`,
      [gate],
    );

    let inCount = 0;
    let outCount = 0;
    if (stateRes.rowCount > 0 && stateRes.rows[0].day === day) {
      // Same day: build on existing counts.
      inCount = stateRes.rows[0].in_count;
      outCount = stateRes.rows[0].out_count;
    }
    // else: no row yet, or a new day → start from 0 (implicit reset).

    if (direction === 'in') inCount += 1;
    else outCount += 1;

    // Clamp so dropped 'in' events can't push occupancy negative.
    const occupancy = Math.max(0, inCount - outCount);

    await client.query(
      `INSERT INTO occupancy_state (gate, in_count, out_count, occupancy, day, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (gate) DO UPDATE
         SET in_count = $2, out_count = $3, occupancy = $4, day = $5, updated_at = now()`,
      [gate, inCount, outCount, occupancy, day],
    );

    return { duplicate: false, gate, direction, day };
  });
}

// Reset occupancy for one gate (or both). Used by the manual reset endpoint and
// by ops when counts drift mid-day. Sets counts to 0 for the current day.
export async function resetOccupancy(gate) {
  const targets = gate === 'all' ? GATES : [gate];
  if (targets.some((g) => !GATES.includes(g))) {
    throw new Error(`invalid gate: ${gate}`);
  }
  const day = businessDay(new Date());
  for (const g of targets) {
    await withTransaction((client) =>
      client.query(
        `INSERT INTO occupancy_state (gate, in_count, out_count, occupancy, day, updated_at)
         VALUES ($1, 0, 0, 0, $2, now())
         ON CONFLICT (gate) DO UPDATE
           SET in_count = 0, out_count = 0, occupancy = 0, day = $2, updated_at = now()`,
        [g, day],
      ),
    );
  }
  return { reset: targets };
}

export { businessDay };
