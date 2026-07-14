import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { api } from '../api.js';
import { colors } from '../theme.js';
import { L } from '../labels.js';

// More than ~1.5 days in the window → label the x-axis by date, not hour.
const MULTIDAY_MS = 36 * 60 * 60 * 1000;

// Format an ISO hour bucket to local "HH:00" (single-day view).
function hourTick(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:00`;
}
// Format an ISO hour bucket to local "D/M" (multi-day view).
function dateTick(iso) {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// Hourly in-vs-out line chart. The date range + gate are page-level (owned by
// App via FilterBar) and arrive as props; the chart just fetches + renders and
// refetches whenever they (or refreshKey) change.
export default function TrafficChart({ from, to, gate = 'all', refreshKey, rangeLabel }) {
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // No valid window (e.g. an incomplete custom range) → clear + skip fetch.
    if (!from || !to) {
      setSeries([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .timeseries(from, to, gate)
      .then((res) => {
        if (!cancelled) setSeries(res.series || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, gate, refreshKey]);

  const multiDay = from && to && new Date(to) - new Date(from) > MULTIDAY_MS;
  const tickFmt = multiDay ? dateTick : hourTick;
  const data = series.map((p) => ({ t: p.t, in: p.in, out: p.out }));

  return (
    <div className="chart-card">
      <div className="chart-header">
        <span className="chart-title">{L.chartTitle}</span>
        {rangeLabel && <span className="scope-badge">{rangeLabel}</span>}
      </div>

      <div className="chart-body">
        {error && data.length === 0 ? (
          <div className="state error">{error}</div>
        ) : loading && data.length === 0 ? (
          <div className="state">
            <span className="spinner" />
            {L.loading}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={tickFmt}
                interval="preserveStartEnd"
                minTickGap={multiDay ? 24 : 16}
                stroke={colors.axis}
                tick={{ fontSize: 12 }}
                tickLine={false}
              />
              <YAxis
                stroke={colors.axis}
                tick={{ fontSize: 12 }}
                tickLine={false}
                allowDecimals={false}
                width={40}
              />
              <Tooltip
                labelFormatter={(t) => (multiDay ? `${dateTick(t)} ${hourTick(t)}` : hourTick(t))}
                contentStyle={{
                  background: colors.tooltipBg,
                  border: `1px solid ${colors.tooltipBorder}`,
                  borderRadius: 8,
                  color: colors.text,
                }}
                labelStyle={{ color: colors.text }}
              />
              <Legend wrapperStyle={{ fontSize: 13 }} />
              <Line
                type="monotone"
                dataKey="in"
                name={L.in}
                stroke={colors.in}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="out"
                name={L.out}
                stroke={colors.out}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
