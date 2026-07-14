import { L } from '../labels.js';

// Page-level filter bar for the analytics below it (chart + table). Controls the
// date range (chart only — /api/timeseries) and the gate (chart + table). It is
// purely presentational: App owns the state and computes the effective window.
//
// NOTE: the KPI cards above this bar are intentionally NOT driven by the range —
// they are today-only (backend /api/summary has no range). The KPI section makes
// that explicit so the range here reads as "analytics scope", not "whole page".

const RANGE_PRESETS = [
  { key: 'today', label: L.rangeToday },
  { key: '7d', label: L.range7d },
  { key: '30d', label: L.range30d },
  { key: 'custom', label: L.rangeCustom },
];
const GATES = [
  { key: 'all', label: L.gateAll },
  { key: 'left', label: L.gateLeft },
  { key: 'right', label: L.gateRight },
];

export default function FilterBar({
  rangePreset,
  onRangePreset,
  customFrom,
  customTo,
  onCustomFrom,
  onCustomTo,
  gate,
  onGate,
  rangeError,
}) {
  return (
    <div className="filter-bar">
      <div className="filter-group">
        <span className="filter-label">{L.filterRange}</span>
        <div className="segmented">
          {RANGE_PRESETS.map((r) => (
            <button
              key={r.key}
              className={rangePreset === r.key ? 'active' : ''}
              onClick={() => onRangePreset(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>

        {rangePreset === 'custom' && (
          <div className="custom-range">
            <label className="date-field">
              <span>{L.rangeFrom}</span>
              <input
                type="date"
                className="date-input"
                value={customFrom}
                onChange={(e) => onCustomFrom(e.target.value)}
              />
            </label>
            <label className="date-field">
              <span>{L.rangeTo}</span>
              <input
                type="date"
                className="date-input"
                value={customTo}
                onChange={(e) => onCustomTo(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      <div className="filter-group">
        <span className="filter-label">{L.filterGate}</span>
        <div className="segmented">
          {GATES.map((g) => (
            <button
              key={g.key}
              className={gate === g.key ? 'active' : ''}
              onClick={() => onGate(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Inline validation for a bad custom range (from > to, or too wide). */}
      {rangeError && <div className="filter-error">⚠ {rangeError}</div>}
    </div>
  );
}
