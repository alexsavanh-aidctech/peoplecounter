# People Counter — Plan & Status

> อ่านไฟล์นี้ก่อนเริ่มงานใหม่ทุกครั้ง (source of truth ของสถานะโปรเจกต์)
> คู่กับ `CLAUDE.md` (กฎ/สถาปัตยกรรม/spec)

## ภาพรวม

ระบบนับคนเข้า-ออก 2 ประตู (ซ้าย = AIDC Tech, ขวา = AIDC) จาก event line-crossing
ที่ AI Engine ยิง webhook เข้ามา + live view กล้อง Dahua (Phase 2)
สถาปัตยกรรม/สไตล์ reuse จาก WebLog แต่ **DB เป็น PostgreSQL** (pg, SQL ตรง ไม่ใช้ ORM)

```
AI Engine ──webhook──► POST /api/events ──► Express ──► PostgreSQL
                                                         ├─ counting_events  (raw, purge 30 วัน)
                                                         ├─ counting_hourly   (สรุป ชม.×gate×direction)
                                                         └─ occupancy_state   (คงเหลือต่อ gate, reset รายวัน)
กล้อง Dahua ──RTSP──► MediaMTX (Phase 2) ──HLS──► React live view (Phase 2)
```

## Phase 1 — เสร็จแล้ว (backend + data layer + ingest + mock/test)

- **โครงโปรเจกต์ + config** — `backend/src`, `backend/migrations`, `backend/scripts`, `docs`;
  root มี `docker-compose.yml`, `.env.example`, `.gitignore`; `package.json` `"type":"module"`,
  deps = `express` + `pg`. ทุกค่า env อ่านผ่าน `backend/src/config.js` ที่เดียว
- **PostgreSQL layer** — `migrations/001_init.sql` (idempotent, 3 tables + index/constraint ครบ);
  `db.js` มี pooled singleton, `query()`, `getPool()`, `runMigrations()` (รันไฟล์ใน migrations/
  เรียงชื่อ), `withTransaction()`; ตั้ง session `TIME ZONE` ต่อ connection ให้ `date_trunc`/`::date`
  ตรง TZ ของ server
- **Ingest** (`ingest.js`) — `recordEvent()` ทำงานใน transaction เดียว:
  1. `INSERT ... ON CONFLICT (gate,direction,track_id) DO NOTHING` → `rowCount===0` = ซ้ำ (return `{duplicate:true}`)
  2. upsert `counting_hourly` (`count = count + 1`, bucket = `date_trunc('hour', ts)`)
  3. update `occupancy_state` — เช็ค business day ก่อน ถ้าข้ามวัน reset 0, แล้ว inc, `occupancy = GREATEST(0, in-out)`
  - parameterized query ทุกจุด (`$1,$2,...`) ไม่ concat ค่าลง SQL
  - `resetOccupancy(gate|all)` สำหรับ reset manual
- **REST API** — `server.js` (migrate ตอน start + graceful shutdown) + `routes.js`:
  `POST /api/events` (200 เสมอ), `POST /api/events/crossing` (stub 200),
  `GET /api/summary`, `GET /api/timeseries`, `POST /api/occupancy/reset`,
  `GET /api/live-config`, `GET /api/health` (ping DB)
- **Scripts** — `mockEvents.js` (ยิง event สุ่ม, รับ count/interval), `purgeOld.js` (ลบ event > 30 วัน),
  `testEdgeCases.js` (ตรวจ dedup / clamp 0 / cross-day reset)
- **Docker** — `backend/Dockerfile` (node:24-alpine) + `docker-compose.yml`
  (postgres healthcheck → backend `depends_on: service_healthy`)

### ผลตรวจ (edge cases)

`npm run test:edge` — dedup, occupancy clamp ที่ 0, cross-day reset **ผ่านครบ**
(ดูผลรันล่าสุดตอน verify)

## Phase 2 — เสร็จแล้ว (frontend + live view)

- **React 18 + Vite 5 + recharts** (match WebLog เป๊ะ) — `frontend/` สร้างใหม่ทั้งหมด
- **Theme Tokens** ดึงค่าจริงจาก WebLog เติมใน `CLAUDE.md` แล้ว → `frontend/src/theme.css`
  (สี/ฟอนต์ Inter+Noto Sans Lao/spacing ตรง WebLog)
- **Live view** — `CameraView.jsx` + `LiveGrid.jsx`: 2 จอ (responsive → เรียงลง),
  hls.js + native HLS fallback (Safari), cleanup ตอน unmount, placeholder "ກ້ອງບໍ່ພ້ອມ"
  เมื่อ stream ไม่พร้อม (ไม่ให้ทั้งหน้าพัง)
- **Dashboard** — `KpiCards.jsx` (ต่อฝั่ง เข้า=success/ออก=danger + การ์ดรวม),
  `TrafficChart.jsx` (recharts เข้า vs ออก ราย ชม. + filter ฝั่ง ซ้าย/ขวา/รวม)
- **App shell** — header (ชื่อลาว + วันที่ + ปุ่ม refresh) + reset occupancy (confirm ก่อนยิง);
  state loading/error/data ครบ, refresh ด้วยปุ่มเท่านั้น (ไม่ auto-poll)
- **labels.js** — เก็บข้อความลาวที่เดียว (⚠️ ควรให้ native speaker review wording)

**Verify:** `npm run build` ผ่าน (837 modules, 0 error); wire กับ backend+mock ผ่าน Vite proxy —
summary/timeseries/live-config/reset ตอบจริง; screenshot ยืนยัน theme ตรง WebLog + KPI/กราฟ
ขึ้นเลขจริง (in/out รวมตรงกัน) + placeholder กล้องสวย

## Phase 3 — เสร็จแล้ว (MediaMTX + กล้องจริง, dev only)

> ทำบนเครื่อง dev เท่านั้น — **ยังไม่แตะ server 10.0.100.46**

**Codec ที่เจอจริง (สำคัญ):** กล้องซ้าย AIDC Tech (IP อยู่ใน `.env`) sub stream (subtype=1) เป็น
**H.265/HEVC** (`704x576 @ 25fps`) → browser เล่น HLS H.265 ไม่ได้ → **ต้อง transcode → H.264**
(เปิดด้วย `CAM_LEFT_TRANSCODE=1`). กล้องขวา AIDC ยังไม่ต่อ (placeholder ใน `.env.example`).

**สิ่งที่ทำ:**
- **MediaMTX** (`mediamtx/Dockerfile` + `entrypoint.sh`) — base `bluenviron/mediamtx:1.11.3`
  (pin ไว้) + ffmpeg บน alpine; **entrypoint generate `mediamtx.yml` ตอน start จาก env**
  (credential ไม่เคยอยู่ใน image/ไฟล์ commit) มี 2 path `left`/`right`:
  - `TRANSCODE=1` → `runOnDemand: ffmpeg ... -c:v libx264 ...` republish เป็น H.264 (on-demand)
  - `TRANSCODE=0` → `source: rtsp://... sourceOnDemand: yes` (pull ตรง, สำหรับกล้อง H.264)
- **config.js** — อ่าน `CAM_*_IP/USER/PASS`, `MEDIAMTX_HLS_BASE`, `CAM_*_TRANSCODE`;
  สร้าง `hlsUrl = <base>/<gate>/index.m3u8` (backend ไม่แตะรหัสกล้อง — MediaMTX สร้าง RTSP เอง)
- **`/api/live-config`** คืน HLS URL จริง; **frontend Phase 2 เล่นได้เลยไม่ต้องแก้**
- **docker-compose** — เพิ่ม service `mediamtx` (build `./mediamtx`, `env_file: .env`, port 8888 HLS + 8554 RTSP)

**Verify (dev):** ping กล้อง + RTSP 554 เปิด; `docker run` MediaMTX → request `left/index.m3u8`
ได้ 200, master playlist `CODECS="avc1.42c01e"` (H.264 baseline = transcode ทำงาน);
ffprobe/snapshot จาก HLS เห็นภาพจริง (โซนต้อนรับ AIDC Tech, timestamp ตรง);
เปิด frontend → **จอซ้ายเล่นภาพสดจริง**, จอขวาโชว์ "ກ້ອງບໍ່ພ້ອມ" (placeholder ยังไม่ต่อ)

**วิธีรันบน dev:**
```
docker build -t pc-mediamtx:dev ./mediamtx
docker run -d --env-file .env -p 8888:8888 -p 8554:8554 pc-mediamtx:dev
# ทดสอบแยกชั้น: เปิด http://localhost:8888/left/index.m3u8 ตรงใน VLC/browser
#   เล่นได้ = ปัญหา (ถ้ามี) อยู่ที่ frontend↔MediaMTX;  เล่นไม่ได้ = MediaMTX↔กล้อง
```

**สิ่งที่ต้องเปลี่ยนตอนขึ้น server 10.0.100.46:**
- `.env` → `MEDIAMTX_HLS_BASE=http://10.0.100.46:8888` (ต้องเป็น URL ที่ **browser** เข้าถึงได้ ไม่ใช่ localhost)
- เปิด firewall port **8888** (HLS) บน server; 8554 ไม่ต้อง expose ออกนอกถ้าไม่จำเป็น
- ใส่ IP/user/pass กล้องจริงทั้ง 2 ตัวใน `.env` ของ server + เช็ค subtype/codec กล้องขวา
  (ถ้าเป็น H.265 ด้วย → `CAM_RIGHT_TRANSCODE=1`)
- ถ้า CPU server จำกัด: transcode 2 ตัวพร้อมกินแรง — พิจารณาใช้ main stream H.264 ของกล้อง
  (บางรุ่น subtype=0 เป็น H.264) หรือปรับ preset/resolution
- network: MediaMTX container ต้อง route ไปถึง subnet ของกล้องได้ (เช็ค `10.0.99.x` reachable จาก server)

## Phase 4 — เชื่อมสัญญาณนับคนจากกล้อง Dahua จริง

### Phase 4A — discovery (กล้องซ้าย AIDC Tech) — คืบหน้าแล้ว
- **event code = `NumberStat`** — พบ rule จริงบนกล้อง: `VideoAnalyseRule[0][5]` `Class=NumberStat`,
  `Enable=true`, `Name=NumberStat1`, `ObjectTypes=Human`, AreaID 1 (People Counting rule)
- firmware นี้ **ไม่รองรับ `codes=[All]`** (attach 200 แต่ไม่ push); ต้อง subscribe `codes=[NumberStat]` ตรงๆ
- **แก้ทิศ Enter/Exit ที่ web UI ของกล้องแล้ว** — เดินเทสทิศถูกต้อง
- `backend/scripts/dahuaEventProbe.js` — probe subscribe event stream (digest auth, multipart),
  connect + auth ผ่าน (HTTP 200); ดัมพ์ raw event ลง `docs/dahua_event_samples.log` (gitignored)

### เทียบกับ RunCountApp (repo เพื่อนร่วมงาน) — ตัดสินแล้ว
- RunCountApp = **throughput** (คนผ่าน = entered+exited) บน **NVR**, ดึงยอดด้วย **pull `videoStatServer` RPC2**,
  live view = ภาพนิ่ง JPEG, เก็บ JSONL ไฟล์ (ไม่มี DB), **ไม่มี occupancy** — **คนละโจทย์กับเรา**
- **ตัดสินใจ: เก็บ peoplecounter ไว้** (occupancy ต่อประตู + วิดีโอสด + Postgres + theme WebLog)
  แต่ **จะลองยืมวิธี pull `videoStatServer`** มาแทน/เสริม event subscribe (อาจเสถียรกว่า)
- สรุป RPC flow ของ RunCountApp ไว้ที่ **`docs/videostat_reference.md`** (login MD5 challenge →
  factory.instance → startFind/doFind/stopFind, response `EnteredSubtotal/ExitedSubtotal`, delta+resilience)

### ✅ videoStatProbe รันแล้ว (2026-07-06 ที่ออฟฟิศ) — **กล้องเดี่ยวตอบ RPC ได้!**
- `node backend/scripts/videoStatProbe.js --gate left --channel 0` → **สำเร็จ**
- login MD5 ✓ → `factory.instance` (object) ✓ → `startFind` ✓ → `doFind` คืน **23 แถวราย ชม.**
- response ยืนยัน: `RuleName:"NumberStat"`, `AreaID:1`, `Channel:0`, field
  **`EnteredSubtotal` / `ExitedSubtotal`** (ไม่มี PassbyTotal บนกล้องนี้ = 0)
- ข้อมูลจริงวันนี้: Entered=9, Exited=15 (activity ช่วง 06:00–08:00)
- **สรุป: วิธี pull ของ RunCountApp ใช้กับกล้อง Dahua เดี่ยวของเราได้** (ไม่จำกัดแค่ NVR)
  → **แนวทาง Phase 4 = เปลี่ยนไป poll `videoStatServer`** (เก็บ backend/occupancy/live view/theme เดิม
  เปลี่ยนแค่ที่มาตัวเลข: pull ราย ชม. → คิด delta → occupancy = Entered − Exited, clamp ≥ 0)

⚠️ **ต้องเช็คก่อนทำจริง: occupancy = Entered − Exited = −6 (ติดลบ)**
- เช้าออฟฟิศคนควร**เข้า > ออก** แต่ probe เห็น Exited(15) > Entered(9) → **ทิศน่าจะยังกลับด้าน**
  ที่กล้อง (หรือคนค้างข้ามคืนเดินออกเช้านี้) — **ต้องเทียบ Enter/Exit กับ OSD บนภาพ Live**
  แล้วสลับทิศที่ web UI กล้องถ้ากลับ (แก้ที่กล้อง ไม่ใช่ที่โค้ด)
- ยืนยัน invariant: ถ้ายอดถอยหลัง/ข้ามวัน ต้อง clamp (เรามี `GREATEST(0, in-out)` อยู่แล้ว);
  occupancy จากเส้นเดียว + reset เที่ยงคืน อาจ drift ถ้ามีคนค้างข้ามวัน — จดไว้เป็น known issue

### ✅ กล้องขวา (AIDC) probe ผ่านแล้ว (2026-07-06)
- `videoStatProbe --gate right --channel 0` → login ✓ → doFind 23 แถว, RuleName NumberStat
- ยอดจริงวันนี้: **Entered=45, Exited=40 → occupancy +5** (ฝั่งซ้าย occupancy −6)
- **สรุป: กล้อง Dahua เดี่ยวทั้ง 2 ตัว (ซ้าย/ขวา, IP อยู่ใน `.env`) ตอบ videoStatServer ได้** →
  แนวทาง pull ยืนยันครบทั้งระบบ
- 📌 gotcha ที่เจอ: กล้องแต่ละตัว user/pass คนละชุด (ต้องใส่แยกใน `.env`); ระวังพิมพ์ IP ซ้ำ
- 📌 **ทิศต่างกันต่อกล้อง** (ซ้าย occ ติดลบ, ขวาบวก) — พี่เขาตั้งทิศแบบนั้นตั้งใจ →
  **Phase 4B ต้อง map `Entered/Exited` → `in/out` แบบ config ต่อกล้อง** (อาจต้องสลับฝั่งซ้าย)
  ไม่ fix ที่กล้อง; ยืนยัน mapping กับ OSD ตอนทำจริง

## Phase 4B — poll service (เสร็จแล้ว 2026-07-06) ✅

**สถาปัตยกรรม:** device เป็น source of truth → poll แล้ว **SET** (ไม่ inc/ไม่ผ่าน event/dedup)
- `backend/src/dahuaVideoStat.js` — RPC2 client (login MD5 challenge → factory.instance →
  startFind/doFind/stopFind, keepAlive + re-login เมื่อ session หลุด)
- `backend/src/poller.js` — ทุก `POLL_INTERVAL_SECONDS` (30s) ต่อกล้อง: ดึงยอดราย ชม. วันนี้ →
  map `Entered/Exited → in/out` (สลับด้วย `CAM_*_SWAP_INOUT`) → **SET** `counting_hourly` (per hour)
  + **SET** `occupancy_state` (Σวันนี้, occupancy = GREATEST(0, in−out), day = วันนี้)
- `config.js` — เพิ่ม `pollIntervalSeconds` + ต่อกล้อง `ip/user/pass/channel/areaId/swapInOut`
- `docker-compose.yml` — service `poller` (build backend image, `command: node backend/src/poller.js`, `env_file: .env`)
- **frontend/API response shape ไม่แตะเลย** — summary/timeseries อ่านตารางเดิม

**mapping ทิศ (ตั้งใน `.env`):** `CAM_LEFT_SWAP_INOUT=1` (ซ้าย probe เจอ occ ติดลบ → สลับ),
`CAM_RIGHT_SWAP_INOUT=0` — **ยังต้องยืนยันกับ OSD หน้างานให้ชัวร์**

**Verify end-to-end (กล้องจริง + Postgres):** poller → DB → API → dashboard เห็นข้อมูลจริง:
ซ้าย in=71/out=53/occ=18, ขวา in=48/out=45/occ=3, รวม occ=21; กราฟราย ชม. เข้า/ออกขึ้นจริง
(คนเข้าพุ่งเช้า 06:00–09:00) + กล้องสด 2 จอ — **ครบทั้งระบบ**

### Design decision — โซน & occupancy (ยืนยัน 2026-07-06)
- **ซ้าย/ขวา = คนละโซนแยกกัน** (AIDC Tech ≠ AIDC) → occupancy per-gate ถูกต้องแล้ว
  (คนในแต่ละโซน = เข้า−ออก, clamp ≥0); `total` = ผลรวม 2 โซน = คนรวมทั้ง 2 บริษัท
  → **ไม่ต้องแก้ backend** (ที่ทำไว้ถูกต้องกับ use case นี้)
- ถ้าเป็น "อาคารเดียว 2 ประตู" ค่อยเปลี่ยน total เป็น clamp(Σin−Σout) — แต่ตอนนี้ **ไม่ใช่**
- **ทิศ:** พี่หัวหน้าตั้งกล้อง **กลับด้านทั้ง 2 ตัวเหมือนกัน** → `CAM_LEFT_SWAP_INOUT=1`,
  `CAM_RIGHT_SWAP_INOUT=1`. ⚠️ ขวาหลัง swap ได้ occ 0 (ไม่ swap ได้ +3) — **ต้องเทียบ OSD หน้างาน**
  ถ้าโซน AIDC มีคนจริง → ขวากลับเป็น `swap=0`

### Detection overlay (เสร็จแล้ว 2026-07-06) ✅
- กล้อง**ไม่ได้ burn กรอบ IVS ลงสตรีม** (เช็คแล้ว main+sub ไม่มี; ไม่มี toggle ผ่าน RPC) —
  กล้องวาดกรอบเฉพาะใน web player ตัวเอง (client-side)
- **กรอบต่อคน (bounding box) แบบ real-time = ไม่คุ้ม** (HLS หน่วง 5-10 วิ ไม่ sync กับ metadata)
- **ทำแทน:** วาด **counting line + detection zone** ทับภาพสด (static overlay) จากพิกัด rule จริง
  ในกล้อง — backend `GET /api/detect-config` อ่าน `VideoAnalyseRule` (NumberStat) ผ่าน RPC
  (`configManager.getConfig`) → normalize 0..1 → frontend วาด SVG (เส้นส้ม + โซนชมพู) บน tile
  - `dahuaVideoStat.js#fetchGeometry()`, route cache 5 นาที, fail = ไม่วาด (ไม่ทำหน้าพัง)
  - verify: ทั้ง 2 กล้องเห็นเส้น+โซนตรงตำแหน่งจริง

### Full stack via docker compose (เสร็จแล้ว 2026-07-06) ✅
- `docker compose up -d --build` → postgres + backend + **poller (ต่อเนื่องทุก 30 วิ)** + mediamtx
- backend เพิ่ม `env_file: .env` (ต้องใช้ cred กล้องสำหรับ detect-config)
- verify: poller เติม DB จริง, summary/detect-config/live view ทำงานครบผ่าน compose
- (frontend เป็น vite dev แยก ชี้ backend :4100 — deploy จริงค่อยเพิ่ม frontend service/บิลด์ static)

### รอทำต่อ (เหลือที่ต้องพี่ช่วย)
- **เทียบ Enter/Exit กับ OSD หน้างาน** → ล็อก `CAM_*_SWAP_INOUT` ให้ตรงจริง (ขวายัง occ 0)
- deploy ขึ้น server 10.0.100.46 (เมื่อพร้อม) — ตาม checklist ด้านบน
- **deploy ขึ้น server 10.0.100.46** (compose เต็ม stack: postgres+backend+mediamtx+poller;
  `MEDIAMTX_HLS_BASE=http://10.0.100.46:8888`, เปิด firewall 8888, ใส่ `.env` จริงบน server)
- retention: ผูก cron รัน `purgeOld.js` (counting_events เก่า >30 วัน) — แม้ pull ไม่เขียน events
  แต่เก็บ job ไว้เผื่อ event path
- ทางเลือก event `NumberStat` (Phase 4A) / AI adapter → `/api/events` ยังเปิดไว้เป็น plan B

> ทางเลือกสำรอง (ยังเปิดไว้): ถ้า AI Engine แยกต่างหากส่ง payload เอง → adapter map → `/api/events`
> (`/api/events/crossing` ยัง stub รอ spec)

## จุดที่ต้องเช็คกับของจริง (อย่าเดา)

- **AI payload spec** — ยังไม่รู้หน้าตา payload จริง; `/api/events` รับ shape มาตรฐานไปก่อน,
  `/api/events/crossing` เป็น stub รอ spec
- **camera ↔ gate mapping** — ตัวไหน left/right ตั้งใน `.env` (`CAM_LEFT_*` / `CAM_RIGHT_*`)
- **ทิศ in/out** — ขึ้นกับมุมกล้อง/การตั้งเส้นของ AI ต้อง verify หน้างาน
- **occupancy reset hour** — default เที่ยงคืน (`OCCUPANCY_RESET_HOUR=0`); ปรับได้ถ้าวัน
  เริ่มที่กะงาน ไม่ใช่ 00:00

## Design decisions ที่ตัดสินไปแล้ว

- **DB = PostgreSQL** (แก้จาก MongoDB เดิมใน CLAUDE.md — sync แล้ว) — SQL ตรง, `pg` pool, ไม่มี ORM
- **dedup ที่ DB** ด้วย unique `(gate,direction,track_id)` + `ON CONFLICT DO NOTHING` (ไม่ทำใน app)
- **occupancy reset รายวัน** ที่ event แรกของวันใหม่ (กัน error สะสมข้ามวันจาก event ตกหล่น)
- **timeseries อ่าน `counting_hourly`** (ingest keep ให้ real-time อยู่แล้วใน txn เดียว)
- **retention ด้วย script** (Postgres ไม่มี TTL) แทน index TTL ของ Mongo
