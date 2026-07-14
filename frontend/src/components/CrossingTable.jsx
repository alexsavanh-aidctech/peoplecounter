import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { L, gateName } from '../labels.js';

// Local time "DD/MM HH:MM:SS" for a crossing timestamp.
function fmtTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Bottom table: timestamped in/out crossings (one row per poll-tick per
// direction). Gate comes from the page-level FilterBar (prop). This table is
// ALWAYS the most-recent 50 rows — the backend /api/crossings has no date range,
// only limit+gate, so the page date range does NOT apply here (labeled clearly).
export default function CrossingTable({ gate = 'all', refreshKey }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api
      .crossings(50, gate)
      .then((res) => {
        if (!cancelled) setRows(res.crossings || []);
      })
      .catch(() => {
        /* keep last-good */
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, gate]);

  return (
    <div className="table-panel">
      <div className="chart-header">
        <span className="chart-title">{L.logTitle}</span>
        <span className="scope-badge">{L.tableRecent}</span>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{L.colTime}</th>
              <th>{L.colGate}</th>
              <th>{L.colDir}</th>
              <th className="num">{L.colCount}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan="4" className="empty">{L.noData}</td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={`${r.ts}-${r.gate}-${r.direction}-${i}`}>
                  <td className="mono">{fmtTime(r.ts)}</td>
                  <td>{gateName(r.gate)}</td>
                  <td>
                    <span className={`dir ${r.direction}`}>
                      {r.direction === 'in' ? `↗ ${L.in}` : `↘ ${L.out}`}
                    </span>
                  </td>
                  <td className="num">{r.count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
