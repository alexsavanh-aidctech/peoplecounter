// Retention — Postgres has no TTL, so delete counting_events older than 30 days.
// Wire to cron on the server (e.g. daily). counting_hourly is kept (it's small
// and powers long-range history); only raw events are purged.
import { pathToFileURL } from 'node:url';
import { query, closePool } from '../src/db.js';

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 30);

export async function purgeOld() {
  const res = await query(
    `DELETE FROM counting_events WHERE ts < now() - ($1 || ' days')::interval`,
    [String(RETENTION_DAYS)],
  );
  console.log(`[purge] deleted ${res.rowCount} events older than ${RETENTION_DAYS} days`);
  return res.rowCount;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  purgeOld()
    .catch((err) => {
      console.error('[purge] error:', err.message);
      process.exitCode = 1;
    })
    .finally(closePool);
}
