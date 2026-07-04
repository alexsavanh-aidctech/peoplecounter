// Dahua event probe (Phase 4A discovery) — NOT a service, NOT wired to the API.
// Subscribes to a camera's event stream and dumps RAW payloads so we can see
// what a real People Counting crossing looks like before writing a parser.
//
// Credentials come from .env ONLY (CAM_LEFT_* / CAM_RIGHT_*); the password is
// never printed or written to disk. Uses HTTP Digest auth (Dahua requires it)
// implemented with node crypto — no extra dependency.
//
// Usage:
//   node backend/scripts/dahuaEventProbe.js                 # gate=left, codes=All
//   node backend/scripts/dahuaEventProbe.js --gate right
//   node backend/scripts/dahuaEventProbe.js --codes NumberStat
//   node backend/scripts/dahuaEventProbe.js --codes CrossLineDetection
//
// Raw events are appended to docs/dahua_event_samples.log (gitignored via *.log).
import http from 'node:http';
import crypto from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── args ──
const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const gate = argVal('gate', 'left');
const codes = argVal('codes', 'All');

// ── env (creds never logged) ──
const PREFIX = gate === 'right' ? 'CAM_RIGHT' : 'CAM_LEFT';
const host = process.env[`${PREFIX}_IP`];
const user = process.env[`${PREFIX}_USER`];
const pass = process.env[`${PREFIX}_PASS`];
const port = Number(process.env[`${PREFIX}_HTTP_PORT`] || 80);

if (!host || !user || !pass) {
  console.error(`[probe] missing ${PREFIX}_IP/USER/PASS in .env — cannot continue`);
  process.exit(1);
}

const PATH = `/cgi-bin/eventManager.cgi?action=attach&codes=[${codes}]`;
const LOG_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'dahua_event_samples.log');

console.log(`[probe] gate=${gate} camera=${host}:${port} user=${user} codes=[${codes}]`);
console.log(`[probe] GET ${PATH}`);
console.log('[probe] walk across the line now (in a few times, out a few times)...\n');

// ── Digest auth helpers ──
function parseAuth(header) {
  const fields = {};
  // matches key=value or key="value"
  const re = /(\w+)=(?:"([^"]*)"|([^,]*))/g;
  let m;
  while ((m = re.exec(header)) !== null) {
    fields[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return fields;
}
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

function digestHeader(auth, method, uri) {
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const qop = auth.qop ? auth.qop.split(',')[0].trim() : undefined;
  const ha1 = md5(`${user}:${auth.realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${auth.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${auth.nonce}:${ha2}`);
  let h = `Digest username="${user}", realm="${auth.realm}", nonce="${auth.nonce}", uri="${uri}", response="${response}"`;
  if (auth.opaque) h += `, opaque="${auth.opaque}"`;
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (auth.algorithm) h += `, algorithm=${auth.algorithm}`;
  return h;
}

// ── output ──
let eventCount = 0;
function emit(raw) {
  const ts = new Date().toISOString();
  eventCount += 1;
  const line = `\n===== [${ts}] event #${eventCount} (gate=${gate}, codes=[${codes}]) =====\n${raw}\n`;
  process.stdout.write(line);
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, line);
  } catch (err) {
    console.error(`[probe] could not write log: ${err.message}`);
  }
}

function suggestOnError(status) {
  if (status === 401) {
    console.error('[probe] 401 Unauthorized — digest auth rejected.');
    console.error('        → check CAM_*_USER/PASS in .env, or that the user may access CGI events.');
  } else if (status === 404) {
    console.error('[probe] 404 Not Found — this event path/code is not served by this firmware.');
    console.error('        → try another code: --codes NumberStat | PeopleCounting | CrossLineDetection | CrossRegionDetection');
  } else {
    console.error(`[probe] unexpected HTTP ${status}.`);
  }
}

// ── request (with one digest retry) ──
function connect(authHeader) {
  const headers = { Accept: 'multipart/x-mixed-replace', Connection: 'keep-alive' };
  if (authHeader) headers.Authorization = authHeader;

  const req = http.request(
    { host, port, path: PATH, method: 'GET', headers, timeout: 0 },
    (res) => {
      if (res.statusCode === 401 && !authHeader && res.headers['www-authenticate']) {
        // First 401 → compute digest and retry once.
        const auth = parseAuth(res.headers['www-authenticate']);
        res.resume(); // drain
        connect(digestHeader(auth, 'GET', PATH));
        return;
      }
      if (res.statusCode !== 200) {
        suggestOnError(res.statusCode);
        res.resume();
        process.exitCode = 1;
        return;
      }

      console.log(`[probe] connected ✓ (HTTP 200). Content-Type: ${res.headers['content-type']}`);
      const ct = res.headers['content-type'] || '';
      const bMatch = ct.match(/boundary=(.+)$/);
      const boundary = bMatch ? `--${bMatch[1].trim()}` : null;

      let buf = '';
      res.setEncoding('binary');
      res.on('data', (chunk) => {
        buf += chunk;
        if (boundary) {
          let idx;
          // flush each complete boundary-delimited block
          while ((idx = buf.indexOf(boundary, boundary.length)) !== -1) {
            const block = buf.slice(0, idx).trim();
            buf = buf.slice(idx + boundary.length);
            if (block) emit(block);
          }
        } else {
          // no boundary advertised — emit raw chunks as they come
          if (buf.trim()) {
            emit(buf.trim());
            buf = '';
          }
        }
      });
      res.on('end', () => console.log('[probe] stream ended by camera.'));
    },
  );

  req.on('error', (err) => {
    console.error(`[probe] connection error: ${err.message}`);
    console.error(`        → is ${host}:${port} reachable? is HTTP (CGI) enabled on the camera?`);
    process.exitCode = 1;
  });
  req.end();
}

connect(null);

process.on('SIGINT', () => {
  console.log(`\n[probe] stopping. captured ${eventCount} event block(s) → ${LOG_FILE}`);
  process.exit(0);
});
