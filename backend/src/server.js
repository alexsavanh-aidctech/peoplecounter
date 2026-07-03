// HTTP entrypoint — run migrations, then serve the API.
import { pathToFileURL } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { runMigrations, closePool } from './db.js';
import { router } from './routes.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', router);
  return app;
}

async function start() {
  // Migrations are idempotent, so running on every boot is safe and keeps the
  // schema in lockstep with the code without a separate deploy step.
  await runMigrations();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[server] listening on :${config.port} (TZ=${config.tz})`);
  });

  // Graceful shutdown so the pool closes cleanly under docker stop.
  const shutdown = async (signal) => {
    console.log(`[server] ${signal} received, shutting down`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Entry guard: pathToFileURL(...).href handles Windows paths correctly (a plain
// template string comparison breaks on drive letters / backslashes).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((err) => {
    console.error('[server] fatal startup error:', err);
    process.exit(1);
  });
}
