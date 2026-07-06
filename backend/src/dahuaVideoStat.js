// Dahua RPC2 videoStatServer client — pulls hourly People-Counting (NumberStat)
// stats over HTTP. Session-based MD5-challenge auth (not HTTP Digest). Verified
// against our direct cameras via videoStatProbe.js; this is the reusable version
// the poller drives, with keepAlive + one-shot re-login on a dropped session.
import http from 'node:http';
import crypto from 'node:crypto';

const LOGIN_PATH = '/RPC2_Login';
const RPC_PATH = '/RPC2';
const REQUEST_TIMEOUT_MS = 8000;

const md5Upper = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex').toUpperCase();
const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Dahua reports NumberStat per hour; a day is 00:00:00..23:00:00 in "YYYY-MM-DD HH:mm:ss".
function todayRange(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const y = now.getFullYear();
  const mo = now.getMonth();
  const d = now.getDate();
  return { start: fmt(new Date(y, mo, d, 0, 0, 0)), end: fmt(new Date(y, mo, d, 23, 0, 0)) };
}

// Thrown when the device says the session/object is gone (triggers one re-login).
class SessionError extends Error {}
function isSessionError(resp) {
  const msg = resp?.error?.message || '';
  const code = resp?.error?.code;
  return code === 287637505 || code === 268894209 || /session|login|object|keepalive/i.test(msg);
}

export class VideoStatClient {
  // cam = { ip, user, pass, channel, areaId } from config
  constructor(cam) {
    this.cam = cam;
    this.session = null;
    this.object = null;
    this.seq = 1000;
    this.keepAliveInterval = 60;
  }

  #rpc(path, body) {
    const payload = JSON.stringify({ ...body, id: (this.seq += 1), ...(this.session ? { session: this.session } : {}) });
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: this.cam.ip, port: 80, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: REQUEST_TIMEOUT_MS },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch { reject(new Error(`non-JSON reply (HTTP ${res.statusCode})`)); }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('RPC timeout')));
      req.on('error', reject);
      req.end(payload);
    });
  }

  async login() {
    this.session = null;
    this.object = null;
    const { user, pass } = this.cam;
    const challenge = await this.#rpc(LOGIN_PATH, { method: 'global.login', params: { userName: user, password: '', clientType: 'Web3.0' } });
    const realm = challenge?.params?.realm;
    const random = challenge?.params?.random;
    this.session = challenge?.session || null;
    if (!realm || !random) throw new Error(`login challenge failed: ${JSON.stringify(challenge?.error || challenge)}`);
    const hash1 = md5Upper(`${user}:${realm}:${pass}`);
    const answer = md5Upper(`${user}:${random}:${hash1}`);
    const res = await this.#rpc(LOGIN_PATH, { method: 'global.login', params: { userName: user, password: answer, clientType: 'Web3.0', authorityType: 'Default', passwordType: 'Default' } });
    if (!res.result) throw new Error(`login rejected: ${JSON.stringify(res.error || res)}`);
    this.session = res.session || this.session;
    const iv = Number(res?.params?.keepAliveInterval);
    if (Number.isFinite(iv) && iv > 0) this.keepAliveInterval = iv;
  }

  async #ensureObject() {
    if (this.object != null) return this.object;
    const inst = await this.#rpc(RPC_PATH, { method: 'videoStatServer.factory.instance', params: { channel: this.cam.channel } });
    if (inst?.result == null || inst.result === false || inst.error) {
      if (isSessionError(inst)) throw new SessionError('factory.instance: session lost');
      throw new Error(`factory.instance failed: ${JSON.stringify(inst?.error || inst)}`);
    }
    this.object = inst.result;
    return this.object;
  }

  // One find pass for today; returns [{ startTime: Date, entered, exited }].
  async #findTodayOnce(now) {
    const object = await this.#ensureObject();
    const range = todayRange(now);
    const start = await this.#rpc(RPC_PATH, {
      method: 'videoStatServer.startFind',
      params: { condition: { StartTime: range.start, EndTime: range.end, Granularity: 'Hour', MinStayTime: 0, IntelliType: 0, AreaID: [this.cam.areaId] } },
      object: this.object,
    });
    const token = start?.params?.token;
    const totalCount = toNum(start?.params?.totalCount);
    if (token == null) {
      if (isSessionError(start)) throw new SessionError('startFind: session lost');
      throw new Error(`startFind failed: ${JSON.stringify(start?.error || start)}`);
    }
    const rows = [];
    try {
      while (rows.length < totalCount) {
        const count = Math.max(1, Math.min(100, totalCount - rows.length));
        const page = await this.#rpc(RPC_PATH, { method: 'videoStatServer.doFind', params: { token, beginNumber: rows.length, count }, object });
        if (isSessionError(page)) throw new SessionError('doFind: session lost');
        const info = page?.params?.info || [];
        if (info.length === 0) break;
        for (const r of info) {
          rows.push({ startTime: parseDeviceTime(r.StartTime), entered: toNum(r.EnteredSubtotal), exited: toNum(r.ExitedSubtotal) });
        }
        if (info.length < count) break;
      }
    } finally {
      await this.#rpc(RPC_PATH, { method: 'videoStatServer.stopFind', params: { token }, object }).catch(() => {});
    }
    return rows;
  }

  // Public: fetch today's hourly rows, re-logging in once if the session died.
  async fetchTodayHourly(now = new Date()) {
    if (!this.session) await this.login();
    try {
      return await this.#findTodayOnce(now);
    } catch (err) {
      if (err instanceof SessionError) {
        await this.login();
        return this.#findTodayOnce(now);
      }
      throw err;
    }
  }

  async keepAlive() {
    if (!this.session) return false;
    const resp = await this.#rpc(RPC_PATH, { method: 'global.keepAlive', params: { timeout: this.keepAliveInterval, active: true } }).catch(() => null);
    if (resp?.result === true) return true;
    this.session = null;
    this.object = null;
    return false;
  }

  // Read the NumberStat rule's counting line + detection zone, normalized to
  // 0..1 (device space is 0..8191) so the frontend can draw them over any tile
  // size. Returns { line: [[x,y],[x,y]], region: [[x,y],...] } or null.
  async fetchGeometry() {
    if (!this.session) await this.login();
    const norm = (v) => Math.min(1, Math.max(0, v / 8191));
    const pt = (p) => (Array.isArray(p) && p.length >= 2 ? [norm(p[0]), norm(p[1])] : null);
    const run = async () => {
      const resp = await this.#rpc(RPC_PATH, { method: 'configManager.getConfig', params: { name: 'VideoAnalyseRule' } });
      if (isSessionError(resp)) throw new SessionError('getConfig: session lost');
      // table[channel] = array of rules; find the NumberStat one.
      const table = resp?.params?.table;
      const rules = Array.isArray(table) ? (table[this.cam.channel] || table[0] || []) : [];
      const rule = (Array.isArray(rules) ? rules : []).find((r) => r && r.Class === 'NumberStat');
      if (!rule?.Config) return null;
      const line = (rule.Config.DetectLine || []).map(pt).filter(Boolean);
      const region = (rule.Config.DetectRegion || []).map(pt).filter(Boolean);
      return { line: line.length >= 2 ? line : null, region: region.length >= 3 ? region : null };
    };
    try {
      return await run();
    } catch (err) {
      if (err instanceof SessionError) { await this.login(); return run(); }
      throw err;
    }
  }
}

// Device "YYYY-MM-DD HH:mm:ss" (local time) -> Date instant.
function parseDeviceTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), 0, 0);
}

export { todayRange, SessionError, parseDeviceTime };
