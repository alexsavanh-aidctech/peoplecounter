import { L, gateName } from '../labels.js';

// One card: gate name + big IN / OUT numbers side by side (occupancy hidden).
// "in" is --success, "out" is --danger.
function Card({ title, data, isTotal = false }) {
  return (
    <div className={`kpi-card${isTotal ? ' total' : ''}`}>
      <div className="card-gate-name">{title}</div>
      <div className="kpi-inout">
        <div className="kpi-io in">
          <div className="kpi-io-num">{data.in}</div>
          <div className="kpi-io-label">{L.in}</div>
        </div>
        <div className="kpi-io-divider" />
        <div className="kpi-io out">
          <div className="kpi-io-num">{data.out}</div>
          <div className="kpi-io-label">{L.out}</div>
        </div>
      </div>
    </div>
  );
}

export default function KpiCards({ summary }) {
  const gates = summary?.gates || {};
  const zero = { in: 0, out: 0, occupancy: 0 };

  return (
    <div className="kpi-row">
      <Card title={gateName('left')} data={gates.left || zero} />
      <Card title={gateName('right')} data={gates.right || zero} />
      <Card title={L.total} data={summary?.total || zero} isTotal />
    </div>
  );
}
