// Shared-password auth — the backend is the single source of truth: it checks
// the password, issues a JWT, and verifies it on every protected request.
//
// Two verification paths share the same token:
//   1. Dashboard API — token sent as `Authorization: Bearer <jwt>` (requireAuth).
//   2. HLS stream — token also dropped as a cookie at login so the browser's
//      <video>/hls.js requests (which can't set an Authorization header) carry
//      it automatically; nginx auth_request → /api/verify-stream checks it.
import jwt from 'jsonwebtoken';
import { config } from './config.js';

// Cookie that carries the token for HLS auth_request. HttpOnly — the dashboard
// never reads it from JS (it uses the token returned in the login JSON body).
export const STREAM_COOKIE = 'pc_token';

// Issue a token after a correct password. The role claim is just a marker —
// there is one shared identity, no per-user data.
export function signToken() {
  return jwt.sign({ role: 'dashboard' }, config.authSecret, {
    expiresIn: `${config.authTokenDays}d`,
  });
}

// Verify a raw token string; returns the decoded payload or null (never throws).
// A missing secret makes jwt.verify throw → null → everything stays locked.
export function verifyToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, config.authSecret);
  } catch {
    return null;
  }
}

// Express middleware: require a valid Bearer token or 401. Guards every endpoint
// except the public allowlist wired in server.js (/login, /logout, /health,
// /verify-stream).
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

// Password check for POST /login. If AUTH_PASSWORD is unset we treat auth as
// misconfigured and reject — safer to lock everyone out than open by accident.
export function checkPassword(password) {
  return Boolean(config.authPassword) && password === config.authPassword;
}

// Read one cookie value from the Cookie header (no cookie-parser dep — we only
// ever need this single token cookie, on the auth_request subrequest).
export function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}
