import CameraView from './CameraView.jsx';
import { gateName } from '../labels.js';

// Two-up camera grid (collapses to one column on narrow screens via CSS).
// Renders whatever cameras liveConfig() returned; keeps gate order left→right.
const GATE_ORDER = { left: 0, right: 1 };

export default function LiveGrid({ cameras = [], geometryByGate = {} }) {
  const ordered = [...cameras].sort(
    (a, b) => (GATE_ORDER[a.gate] ?? 9) - (GATE_ORDER[b.gate] ?? 9),
  );

  return (
    <div className="live-grid">
      {ordered.map((cam) => (
        <CameraView
          key={cam.gate}
          name={cam.name || gateName(cam.gate)}
          hlsUrl={cam.hlsUrl}
          geometry={geometryByGate[cam.gate]}
        />
      ))}
    </div>
  );
}
