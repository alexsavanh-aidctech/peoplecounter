import { L, gateName } from '../labels.js';

// One card: gate name, big occupancy number, and in/out splits below.
// "in" is tinted --success, "out" is tinted --danger (per spec).
function Card({ title, data, isTotal = false }) {
  return (
    <div className={`kpi-card${isTotal ? ' total' : ''}`}>
      <div className="card-gate-name">{title}</div>
      <div className="kpi-value">{data.occupancy}</div>
      <div className="kpi-label">{L.occupancy}</div>
      <div className="kpi-splits">
        <span className="kpi-split in">
          {L.in} <span className="n">{data.in}</span>
        </span>
        <span className="kpi-split out">
          {L.out} <span className="n">{data.out}</span>
        </span>
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
