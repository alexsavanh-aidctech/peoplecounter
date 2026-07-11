// HTTP entrypoint — run migrations, then serve the API.
import { pathToFileURL } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { runMigrations, closePool } from './db.js';
import { router } from './routes.js';
import { requireAuth } from './auth.js';

// Endpoints reachable without a token: login/logout themselves, the DB health
// probe (docker healthcheck must never need auth), and the HLS auth_request
// target (it authenticates via cookie, not Bearer). Everything else is gated.
const PUBLIC_PATHS = new Set(['/login', '/logout', '/health', '/verify-stream']);

export function createApp() {
  const app = express();
  // Trust the reverse proxy so req.secure / X-Forwarded-Proto reflect the
  // browser's real (HTTPS) scheme when setting the stream cookie.
  app.set('trust proxy', true);
  app.use(express.json({ limit: '256kb' }));
  // Auth gate in front of the router: allowlisted paths pass through, the rest
  // require a valid Bearer token. Keeps route handlers + response shapes intact.
  app.use('/api', (req, res, next) => {
    if (PUBLIC_PATHS.has(req.path)) return next();
    return requireAuth(req, res, next);
  });
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
