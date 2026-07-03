import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { L } from './labels.js';
import LiveGrid from './components/LiveGrid.jsx';
import KpiCards from './components/KpiCards.jsx';
import TrafficChart from './components/TrafficChart.jsx';

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

export default function App() {
  const [summary, setSummary] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Bumped on every refresh so child charts refetch too.
  const [refreshKey, setRefreshKey] = useState(0);
  const [resetting, setResetting] = useState(false);

  // Load summary + live-config together. Manual only (mount + refresh button) —
  // no polling, matching WebLog.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, liveRes] = await Promise.all([
        api.summary(),
        api.liveConfig(),
      ]);
      setSummary(summaryRes);
      setCameras(liveRes.cameras || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => {
    setRefreshKey((k) => k + 1);
    load();
  };

  const onReset = async () => {
    // Confirm before a destructive reset (zeros the day's counts).
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
        <div>
          <h1>{L.appTitle}</h1>
          <div className="subtitle">{L.appSubtitle}</div>
        </div>
        <div className="header-right">
          <span className="badge">{todayLabel()}</span>
          <button className="btn danger" onClick={onReset} disabled={resetting}>
            {L.reset}
          </button>
          <button className="btn primary" onClick={refresh} disabled={loading}>
            {L.refresh}
          </button>
        </div>
      </header>
      <div className="header-divider" />

      {/* Live view is always shown (cameras self-handle offline state). */}
      <LiveGrid cameras={cameras} />

      {error ? (
        <div className="state error">{L.error} — {error}</div>
      ) : loading && !summary ? (
        <div className="state">
          <span className="spinner" />
          {L.loading}
        </div>
      ) : (
        <>
          <div className="kpi-section-title">{L.summaryTitle}</div>
          <KpiCards summary={summary} />
        </>
      )}

      {/* Chart fetches its own data; refreshKey re-triggers it. */}
      <TrafficChart refreshKey={refreshKey} />
    </div>
  );
}
