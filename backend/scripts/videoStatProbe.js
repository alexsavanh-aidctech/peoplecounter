// videoStatServer probe (Phase 4 evaluation) — standalone, NOT wired to backend.
//
// Purpose: prove whether our DIRECT (non-NVR) Dahua camera answers the RPC2
// `videoStatServer` People-Counting pull that RunCountApp uses on its NVR. If it
// does, we can switch Phase 4 from event-subscribe (NumberStat attach) to polling
// cumulative Enter/Exit. See docs/videostat_reference.md for the full RPC flow.
//
// This ONLY reads; it never touches the DB, backend, or camera config. Camera
// credentials come from .env (CAM_LEFT_* / CAM_RIGHT_*); the password is never
// printed or logged.
//
// ── HOW TO RUN (at the office, on the camera LAN — Monday) ──
//   node backend/scripts/videoStatProbe.js                 # gate=left, channel=0, AreaID=1
//   node backend/scripts/videoStatProbe.js --gate right
//   node backend/scripts/videoStatProbe.js --channel 1     # try other channels if 0 is empty
//   node backend/scripts/videoStatProbe.js --area 0        # try other AreaIDs if info[] is empty
//   node backend/scripts/videoStatProbe.js --from "2026-07-06 00:00:00" --to "2026-07-06 23:00:00"
//
// Reads .env automatically, so no env vars need to be exported first.
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── minimal .env loader (no dependency) ──────────────────────────────
// Split on the FIRST '=' so values with spaces (e.g. CAM_LEFT_NAME=AIDC Tech) are fine.
function loadEnv() {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
  const out = {};
  let text;
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    console.error(`[probe] cannot read ${envPath} — copy .env.example to .env and fill camera creds`);
    process.exit(1);
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// ── args ──
const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const gate = argVal('gate', 'left');
const channel = Number(argVal('channel', '0')); // direct camera is usually channel 0
const areaId = Number(argVal('area', '1')); // NumberStat rule AreaID (our rule = AreaID 1)

const env = loadEnv();
const PREFIX = gate === 'right' ? 'CAM_RIGHT' : 'CAM_LEFT';
const host = env[`${PREFIX}_IP`];
const user = env[`${PREFIX}_USER`];
const pass = env[`${PREFIX}_PASS`];
if (!host || !user || !pass) {
  console.error(`[probe] missing ${PREFIX}_IP/USER/PASS in .env`);
  process.exit(1);
}

// Default day window: today 00:00:00 .. 23:00:00 (device's "YYYY-MM-DD HH:mm:ss").
function fmt(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const now = new Date();
const startTime = argVal('from', fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)));
const endTime = argVal('to', fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 0, 0)));

// ── RPC2 transport (HTTP POST JSON) ──────────────────────────────────
const md5Upper = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex').toUpperCase();
let seq = 1000;
const nextId = () => (seq += 1);
let session = null;

function rpc(path, body) {
  const payload = JSON.stringify({ ...body, ...(session ? { session } : {}) });
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host, port: 80, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 8000 },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`non-JSON reply (HTTP ${res.statusCode}): ${data.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('RPC timeout (8s)')));
    req.on('error', reject);
    req.end(payload);
  });
}

// Print an RPC error clearly (code + message), and flag the "not supported" signals.
function describeError(where, resp) {
  const err = resp && resp.error;
  const code = err && err.code;
  const msg = (err && err.message) || JSON.stringify(resp);
  console.error(`[probe] ${where} FAILED — code=${code ?? '?'} msg=${msg}`);
  if (/not\s*found|invalid\s*request|unknown|unsupported|no\s*such/i.test(msg)) {
    console.error('        → looks like this camera does not expose videoStatServer (direct cameras may differ from an NVR).');
    console.error('          Try: --channel <n>, or conclude the pull approach is not available on this model.');
  }
}

// ── flow ──
async function login() {
  const challenge = await rpc('/RPC2_Login', {
    method: 'global.login',
    params: { userName: user, password: '', clientType: 'Web3.0' },
    id: nextId(),
  });
  const realm = challenge?.params?.realm;
  const random = challenge?.params?.random;
  session = challenge?.session || session;
  if (!realm || !random) throw new Error(`login challenge missing realm/random: ${JSON.stringify(challenge?.error || challenge)}`);

  const hash1 = md5Upper(`${user}:${realm}:${pass}`);
  const answer = md5Upper(`${user}:${random}:${hash1}`);
  const res = await rpc('/RPC2_Login', {
    method: 'global.login',
    params: { userName: user, password: answer, clientType: 'Web3.0', authorityType: 'Default', passwordType: 'Default' },
    id: nextId(),
  });
  if (!res.result) throw new Error(`login rejected: ${JSON.stringify(res.error || res)}`);
  session = res.session || session;
  console.log(`[probe] login ✓ (session established; keepAliveInterval=${res?.params?.keepAliveInterval ?? '?'}s)`);
}

async function run() {
  console.log(`[probe] gate=${gate} camera=${host} channel=${channel} AreaID=${areaId}`);
  console.log(`[probe] window: ${startTime} .. ${endTime}\n`);

  await login();

  // videoStatServer object (per channel, session-bound)
  const inst = await rpc('/RPC2', { method: 'videoStatServer.factory.instance', params: { channel }, id: nextId(), session });
  if (inst.result === undefined || inst.result === null || inst.result === false || inst.error) {
    describeError('videoStatServer.factory.instance', inst);
    return;
  }
  const object = inst.result;
  console.log(`[probe] factory.instance ✓ object=${object}`);

  // startFind
  const start = await rpc('/RPC2', {
    method: 'videoStatServer.startFind',
    params: { condition: { StartTime: startTime, EndTime: endTime, Granularity: 'Hour', MinStayTime: 0, IntelliType: 0, AreaID: [areaId] } },
    object,
    id: nextId(),
    session,
  });
  const token = start?.params?.token;
  const totalCount = Number(start?.params?.totalCount) || 0;
  if (token == null) {
    describeError('videoStatServer.startFind', start);
    return;
  }
  console.log(`[probe] startFind ✓ token=${token} totalCount=${totalCount}`);

  // doFind (page through)
  const records = [];
  try {
    while (records.length < totalCount) {
      const count = Math.max(1, Math.min(100, totalCount - records.length));
      const page = await rpc('/RPC2', { method: 'videoStatServer.doFind', params: { token, beginNumber: records.length, count }, object, id: nextId(), session });
      const batch = page?.params?.info || [];
      if (page.error) { describeError('videoStatServer.doFind', page); break; }
      if (batch.length === 0) break;
      records.push(...batch);
      if (batch.length < count) break;
    }
  } finally {
    await rpc('/RPC2', { method: 'videoStatServer.stopFind', params: { token }, object, id: nextId(), session }).catch(() => {});
  }

  // ── raw dump + aggregate ──
  const ts = new Date().toISOString();
  console.log(`\n===== [${ts}] videoStatServer result (${records.length} hourly rows) =====`);
  console.log(JSON.stringify(records, null, 2));

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const sum = records.reduce(
    (a, r) => ({ entered: a.entered + num(r.EnteredSubtotal), exited: a.exited + num(r.ExitedSubtotal), passby: a.passby + num(r.PassbyTotal) }),
    { entered: 0, exited: 0, passby: 0 },
  );
  console.log('\n----- day totals (summed) -----');
  console.log(`  Entered = ${sum.entered}`);
  console.log(`  Exited  = ${sum.exited}`);
  console.log(`  Passby  = ${sum.passby}`);
  console.log(`  occupancy (Entered - Exited) = ${sum.entered - sum.exited}   <-- what peoplecounter needs`);
  console.log(`  throughput (Entered + Exited) = ${sum.entered + sum.exited}   <-- what RunCountApp shows`);
  console.log('\n[probe] NEXT: compare Entered/Exited above with the Enter/Exit numbers on the camera Live OSD.');
  console.log('        Match → the pull approach works on our direct camera; consider switching Phase 4 to poll.');
}

run().catch((err) => {
  console.error(`\n[probe] error: ${err.message}`);
  console.error('        → if this is a connection/timeout error, are you on the camera LAN? is HTTP (port 80) open?');
  process.exitCode = 1;
});
