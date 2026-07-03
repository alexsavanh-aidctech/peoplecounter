// API client. Calls go to /api/* (same-origin; dev proxied to the backend by
// Vite). Every call throws on a non-2xx so the UI can render an error card.

async function request(path, options) {
  let res;
  try {
    res = await fetch(`/api${path}`, options);
  } catch (err) {
    // Network/connection failure (backend down, CORS, etc.)
    throw new Error(`ເชื่อมต่อ API บໍ່ໄດ້: ${err.message}`);
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
