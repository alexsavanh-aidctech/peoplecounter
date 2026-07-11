// API client. Calls go to /api/* (same-origin; dev proxied to the backend by
// Vite). Every call throws on a non-2xx so the UI can render an error card.
//
// Auth: a shared-password login returns a JWT. It's attached as a Bearer token
// on every request and persisted in localStorage so a refresh doesn't re-login.
// A 401 (expired/invalid) clears the token and bounces the app back to login.

const TOKEN_KEY = 'pc_token';

let authToken = localStorage.getItem(TOKEN_KEY) || null;
let onUnauthorized = null;

export function getToken() {
  return authToken;
}
export function setToken(t) {
  authToken = t || null;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}
// App registers a callback so a 401 anywhere bounces back to the login screen.
export function setOnUnauthorized(fn) {
  onUnauthorized = fn;
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let res;
  try {
    res = await fetch(`/api${path}`, { ...options, headers });
  } catch (err) {
    // Network/connection failure (backend down, CORS, etc.)
    throw new Error(`ເชื่อมต่อ API บໍ່ໄດ້: ${err.message}`);
  }

  // Expired/invalid token → drop it and signal the app to show login.
  if (res.status === 401) {
    setToken(null);
    if (onUnauthorized) onUnauthorized();
    throw new Error('unauthorized');
  }

  if (!res.ok) {
    // Surface the backend's { error } message when present.
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) detail = body.error;
    } catch {
      /* non-JSON error body — keep statusText */
    }
    throw new Error(`API ${res.status}: ${detail}`);
  }
  return res.json();
}

export const api = {
  // login → { token }; throws 'wrong-password' on 401 so LoginPage can localize.
  async login(password) {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.status === 401) throw new Error('wrong-password');
    if (!res.ok) throw new Error(`login failed: ${res.status}`);
    return res.json();
  },

  // Clears the server-side stream cookie (best-effort; never blocks logout).
  async logout() {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch {
      /* ignore — local token is cleared regardless */
    }
  },

  // { gates: { left, right }, total, date }
  summary() {
    return request('/summary?date=today');
  },

  // { series: [ { t, in, out } ] }
  timeseries(from, to, gate = 'all') {
    const params = new URLSearchParams({ from, to, gate });
    return request(`/timeseries?${params.toString()}`);
  },

  // { cameras: [ { gate, name, hlsUrl } ] }
  liveConfig() {
    return request('/live-config');
  },

  // { cameras: [ { gate, geometry: { line, region } | null } ] }
  detectConfig() {
    return request('/detect-config');
  },

  // { crossings: [ { ts, gate, direction, count } ] } — newest first
  crossings(limit = 50, gate = 'all') {
    const params = new URLSearchParams({ limit: String(limit), gate });
    return request(`/crossings?${params.toString()}`);
  },

  // gate = 'left' | 'right' | 'all'
  resetOccupancy(gate = 'all') {
    const params = new URLSearchParams({ gate });
    return request(`/occupancy/reset?${params.toString()}`, { method: 'POST' });
  },
};

// Today's [from, to) ISO window (local midnight → now) for the hourly chart.
export function todayRange() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date();
  return { from: from.toISOString(), to: to.toISOString() };
}
