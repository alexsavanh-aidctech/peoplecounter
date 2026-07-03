// Mock event generator — exercises the whole ingest path without a real AI.
// Fires POST /api/events with random gate/direction/trackId on an interval.
//
// Usage:
//   node backend/scripts/mockEvents.js [count] [intervalMs]
//   COUNT / INTERVAL_MS env vars also work.
//   API_URL overrides the target (default http://localhost:4100).
//
// Examples:
//   node backend/scripts/mockEvents.js            # stream ~every 2s forever
//   node backend/scripts/mockEvents.js 50 200     # 50 events, 200ms apart

const API_URL = process.env.API_URL || 'http://localhost:4100';
const count = Number(process.argv[2] ?? process.env.COUNT ?? 0); // 0 = infinite
const intervalMs = Number(process.argv[3] ?? process.env.INTERVAL_MS ?? 2000);

const GATES = ['left', 'right'];
const DIRECTIONS = ['in', 'out'];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

let sent = 0;
let seq = 0;

async function fire() {
  const gate = pick(GATES);
  const direction = pick(DIRECTIONS);
  // Unique-ish track id per emitted event so each is counted (dedup is tested
  // separately in testEdgeCases.js).
  const trackId = `mock-${Date.now()}-${seq++}`;

  try {
    const res = await fetch(`${API_URL}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gate, direction, trackId, confidence: 0.9 }),
    });
    const body = await res.json();
    console.log(`→ ${gate}/${direction} ${trackId}`, body);
  } catch (err) {
    console.error('mock fire failed:', err.message);
  }

  sent += 1;
  if (count > 0 && sent >= count) {
    console.log(`done: sent ${sent} events`);
    process.exit(0);
  }
}

console.log(`mocking events → ${API_URL}  (count=${count || 'infinite'}, interval=${intervalMs}ms)`);
fire();
setInterval(fire, intervalMs);
