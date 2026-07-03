// PostgreSQL access layer — a single pooled connection shared process-wide.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

// Singleton pool: created lazily on first getPool() so importing this module
// never opens a socket (keeps scripts/tests that stub the DB cheap).
let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      // Pin every connection to the app TZ at startup so date_trunc('hour', ts)
      // and ::date land on local-day/local-hour boundaries, not UTC. Sent in the
      // startup packet (not a follow-up query) so it can't race the first query.
      options: `-c timezone=${config.tz}`,
    });
    // A pool 'error' on an idle client would otherwise crash the process.
    pool.on('error', (err) => {
      console.error('[db] idle client error:', err.message);
    });
  }
  return pool;
}

// Thin query helper so callers don't reach into the pool directly.
export function query(text, params) {
  return getPool().query(text, params);
}

// Run fn inside a transaction on a dedicated client; rollback on any throw.
// Used by ingest so the events insert + hourly + occupancy updates are atomic.
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[db] rollback failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

// Apply every *.sql file in migrations/ in filename order. Migrations are
// idempotent (CREATE ... IF NOT EXISTS), so re-running on each start is safe.
export async function runMigrations() {
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    await query(sql);
    console.log(`[db] migration applied: ${file}`);
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
