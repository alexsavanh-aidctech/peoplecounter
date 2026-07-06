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
import { api, todayRange } from '../api.js';
import { colors } from '../theme.js';
import { L } from '../labels.js';

const GATES = ['all', 'left', 'right'];

// Format an ISO hour bucket to local "HH:00" for the x-axis.
function hourTick(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:00`;
}

// Hourly in-vs-out line chart with a gate filter. Refetches on gate change and
// whenever the parent bumps `refreshKey` (the header refresh button).
export default function TrafficChart({ refreshKey }) {
  const [gate, setGate] = useState('all');
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const { from, to } = todayRange();
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
  }, [gate, refreshKey]);

  const data = series.map((p) => ({ hour: hourTick(p.t), in: p.in, out: p.out }));

  return (
    <div className="chart-card">
      <div className="chart-header">
        <span className="chart-title">{L.chartTitle}</span>
        <div className="segmented range">
          {GATES.map((g) => (
            <button
              key={g}
              className={gate === g ? 'active' : ''}
              onClick={() => setGate(g)}
            >
              {g === 'all' ? L.gateAll : g === 'left' ? L.gateLeft : L.gateRight}
            </button>
          ))}
        </div>
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
                dataKey="hour"
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
