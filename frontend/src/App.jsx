import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, setOnUnauthorized, presetRange, customRange } from './api.js';
import { L } from './labels.js';
import LiveGrid from './components/LiveGrid.jsx';
import KpiCards from './components/KpiCards.jsx';
import TrafficChart from './components/TrafficChart.jsx';
import CrossingTable from './components/CrossingTable.jsx';
import FilterBar from './components/FilterBar.jsx';
import LoginPage from './components/LoginPage.jsx';

// Auto-refresh cadence for the numbers (the poller updates the DB continuously;
// this is how often the browser re-reads it). ~5s feels near-real-time.
const AUTO_REFRESH_MS = 5000;

// Format today's date in the Lao locale for the header badge.
function todayLabel() {
  try {
    return new Intl.DateTimeFormat('lo-LA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function Dashboard({ onLogout }) {
  const [summary, setSummary] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [geometryByGate, setGeometryByGate] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Bumped on every refresh so the chart refetches too.
  const [refreshKey, setRefreshKey] = useState(0);
  const [resetting, setResetting] = useState(false);
  // Show/hide the detection overlay (line + zone). Persisted across reloads.
  const [showDetect, setShowDetect] = useState(() => localStorage.getItem('pc-show-detect') !== '0');
  // Live view on/off. Default OFF — HLS is on-demand, so not loading it on first
  // open saves camera bandwidth until the user actually wants to watch.
  const [showCameras, setShowCameras] = useState(() => localStorage.getItem('pc-show-cameras') === '1');

  // Page-level analytics filter (drives the chart + the table's gate). The KPI
  // cards are intentionally NOT driven by this — they stay today-only.
  const [rangePreset, setRangePreset] = useState('today'); // today | 7d | 30d | custom
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [gate, setGate] = useState('all'); // all | left | right

  // Resolve the preset/custom selection into an effective { from, to } window,
  // plus a validation error (custom only) and a short scope label for the chart.
  const { range, rangeError, rangeLabel } = useMemo(() => {
    if (rangePreset === 'custom') {
      const r = customRange(customFrom, customTo);
      if (!r) {
        // Distinguish: not-filled-in (no error) vs from>to vs too-wide (>90d).
        let err = null;
        if (customFrom && customTo) {
          const f = new Date(`${customFrom}T00:00:00`);
          const t = new Date(`${customTo}T00:00:00`);
          const valid = !Number.isNaN(f.getTime()) && !Number.isNaN(t.getTime());
          err = valid && f <= t ? L.rangeTooWide : L.rangeInvalid;
        }
        return { range: null, rangeError: err, rangeLabel: L.rangeCustom };
      }
      return { range: r, rangeError: null, rangeLabel: `${customFrom} → ${customTo}` };
    }
    const label = rangePreset === '7d' ? L.range7d : rangePreset === '30d' ? L.range30d : L.rangeToday;
    return { range: presetRange(rangePreset), rangeError: null, rangeLabel: label };
    // refreshKey re-derives `to: now` on manual refresh so the window tracks time.
  }, [rangePreset, customFrom, customTo, refreshKey]);

  // Full load: summary + camera list + detection geometry. Used on mount, the
  // manual refresh button, and after a reset. Toggles the loading state.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, liveRes] = await Promise.all([api.summary(), api.liveConfig()]);
      setSummary(summaryRes);
      setCameras(liveRes.cameras || []);
      // Detection geometry is best-effort (camera RPC) — never block on it.
      api
        .detectConfig()
        .then((res) => setGeometryByGate(Object.fromEntries((res.cameras || []).map((c) => [c.gate, c.geometry]))))
        .catch(() => setGeometryByGate({}));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Silent tick for auto-refresh: just re-read the numbers + nudge the chart.
  // No spinner, and a transient failure keeps the last-good values on screen.
  const tick = useCallback(async () => {
    try {
      const s = await api.summary();
      setSummary(s);
      setError(null);
      setRefreshKey((k) => k + 1);
    } catch {
      /* keep showing the last good numbers */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh loop — the "real-time" updates.
  useEffect(() => {
    const id = setInterval(tick, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [tick]);

  const refresh = () => {
    setRefreshKey((k) => k + 1);
    load();
  };

  const toggleDetect = (e) => {
    const on = e.target.checked;
    setShowDetect(on);
    localStorage.setItem('pc-show-detect', on ? '1' : '0');
  };

  const toggleCameras = () => {
    setShowCameras((on) => {
      const next = !on;
      localStorage.setItem('pc-show-cameras', next ? '1' : '0');
      return next;
    });
  };

  const onReset = async () => {
    if (!window.confirm(L.resetConfirm)) return;
    setResetting(true);
    try {
      await api.resetOccupancy('all');
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="AIDC" />
          <div>
            <h1>{L.appTitle}</h1>
            <div className="subtitle">{L.appSubtitle}</div>
          </div>
        </div>
        <div className="header-right">
          <span className="badge live">
            <span className="live-dot" />
            {L.liveLabel}
          </span>
          <span className="badge">{todayLabel()}</span>
          <button className="btn danger" onClick={onReset} disabled={resetting}>
            {L.reset}
          </button>
          <button className="btn primary" onClick={refresh} disabled={loading}>
            {L.refresh}
          </button>
          <button className="btn" onClick={onLogout} title={L.logout}>
            {L.logout}
          </button>
        </div>
      </header>
      <div className="header-divider" />

      {/* Live-view toolbar: turn the cameras on/off (bandwidth) + overlay toggle. */}
      <div className="live-toolbar">
        <button
          className={showCameras ? 'btn' : 'btn primary'}
          onClick={toggleCameras}
        >
          {showCameras ? `⏸ ${L.liveOff}` : `▶ ${L.liveOn}`}
        </button>
        <label className={showCameras ? 'chk' : 'chk disabled'}>
          <input
            type="checkbox"
            checked={showDetect}
            onChange={toggleDetect}
            disabled={!showCameras}
          />
          {L.showDetect}
        </label>
      </div>

      {/* Cameras load only when enabled (off by default to save bandwidth). */}
      <LiveGrid
        cameras={cameras}
        geometryByGate={geometryByGate}
        showDetect={showDetect}
        enabled={showCameras}
      />

      {error ? (
        <div className="state error">{L.error} — {error}</div>
      ) : loading && !summary ? (
        <div className="state">
          <span className="spinner" />
          {L.loading}
        </div>
      ) : (
        <>
          {/* KPI = today only (backend /api/summary has no range). Labeled so the
              date range below reads as "analytics scope", not a whole-page filter. */}
          <div className="kpi-section-title">
            {L.summaryTitle} · {L.rangeToday}
            <span className="kpi-note">{L.kpiTodayNote}</span>
          </div>
          <KpiCards summary={summary} />
        </>
      )}

      {/* Page-level filter — drives the chart (range + gate) and the table (gate). */}
      <FilterBar
        rangePreset={rangePreset}
        onRangePreset={setRangePreset}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFrom={setCustomFrom}
        onCustomTo={setCustomTo}
        gate={gate}
        onGate={setGate}
        rangeError={rangeError}
      />

      {/* Chart follows the selected range + gate. */}
      <TrafficChart
        from={range?.from}
        to={range?.to}
        gate={gate}
        rangeLabel={rangeLabel}
        refreshKey={refreshKey}
      />

      {/* Recent crossings — gate follows the page filter; always latest 50. */}
      <CrossingTable gate={gate} refreshKey={refreshKey} />
    </div>
  );
}

// ---- Auth gate: no token → login screen; token → dashboard ----
// Thin wrapper so the Dashboard's hooks stay stable across login/logout.
export default function App() {
  const [authToken, setAuthToken] = useState(() => getToken());

  useEffect(() => {
    // A 401 from any API call (expired/invalid token) bounces back to login.
    setOnUnauthorized(() => setAuthToken(null));
  }, []);

  const handleLogin = async (password) => {
    const { token } = await api.login(password);
    setToken(token);
    setAuthToken(token);
  };

  const handleLogout = async () => {
    await api.logout();
    setToken(null);
    setAuthToken(null);
  };

  if (!authToken) return <LoginPage onLogin={handleLogin} />;
  return <Dashboard onLogout={handleLogout} />;
}
