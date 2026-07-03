# CLAUDE.md — Project Guide for Claude Code (People Counter)

> ไฟล์นี้ Claude Code อ่านอัตโนมัติทุกครั้งที่เปิด project
> ใช้เป็น "กฎประจำโปรเจกต์" เพื่อให้โค้ดที่สร้างตรงแนวทางโดยไม่ต้องสั่งซ้ำ
> **สถานะล่าสุดอยู่ใน `docs/PLAN.md` เสมอ — อ่านไฟล์นั้นก่อนเริ่มงานใหม่**

## บทบาท

คุณคือ senior full-stack engineer ที่ช่วยพัฒนา **People Counter Dashboard**
ระบบดึงภาพสดจากกล้อง Dahua 2 ตัวที่หน้าประตูบริษัทมาแสดงบนเว็บ พร้อมนับจำนวนพนักงาน
เข้า-ออกของแต่ละฝั่งประตู แล้วสรุปเป็น dashboard ด้านล่างจอกล้อง

- ประตูฝั่งซ้าย = **AIDC Tech** (`gate = 'left'`)
- ประตูฝั่งขวา = **AIDC** (`gate = 'right'`)

ตอบเป็นภาษาไทย แต่ technical term และ code คงเป็นภาษาอังกฤษ

## หลักการออกแบบ (อ่านให้เข้าใจก่อนเขียนโค้ด)

โปรเจกต์นี้ **แยกจาก WebLog** (network traffic dashboard) แต่ **reuse แนวทางเดิม** ทั้งหมด:
สไตล์โค้ด, โครง query routing (raw สำหรับช่วงสั้น / aggregate สำหรับช่วงยาว),
และ **Theme/สี/ฟอนต์ของ frontend เหมือน WebLog เป๊ะ**

**ต่างจาก WebLog 2 จุด:**
1. **source ไม่ใช่ syslog แต่เป็น event จาก AI Engine** ที่ยิง webhook มาบอกว่า
   "มีคนข้ามเส้นที่ประตูไหน ทิศเข้าหรือออก" เราแค่รับ event มาเก็บและสรุป
2. **Database เป็น PostgreSQL** (ไม่ใช่ MongoDB แบบ WebLog) — event มี schema ชัดเจน
   relational เหมาะกว่า; dedup ใช้ UNIQUE constraint, สรุปยอดใช้ SQL GROUP BY

## สถาปัตยกรรม

```
กล้องซ้าย Dahua (AIDC Tech) ──RTSP──┐
กล้องขวา Dahua (AIDC)      ──RTSP──┤
                                    │
        ┌───────────────────────────┴──────────────────────────┐
        ▼ (live view)                                           ▼ (counting)
   MediaMTX (Docker)                                     AI Engine (มีอยู่แล้ว)
   รับ RTSP → แปลงเป็น HLS                                นับคนข้ามเส้น
        │                                                       │ ยิง webhook
        ▼                                                       ▼
   browser เล่น HLS ผ่าน hls.js                     POST /api/events (1 คนข้าม = 1 event)
                                                                │
                                                                ▼
                                              Express REST API ──► PostgreSQL
                                                ├─ counting_events   (raw ทุก event)
                                                ├─ counting_hourly    (สรุป ชม.×gate×direction)
                                                └─ occupancy_state    (คนในอาคารตอนนี้ ต่อ gate)
                                                                │
                                                                ▼
                                          Express REST API → React Dashboard
                                            ├─ Live view 2 จอ (ซ้าย/ขวา, HLS)
                                            └─ Dashboard สรุป (เข้า/ออก/คงเหลือ ต่อฝั่ง + กราฟราย ชม.)
```

**Query routing:** ช่วงวันนี้/ราย ชม. อ่าน `counting_events` ตรงๆ (ได้ค่า real-time);
ช่วงยาว (7Day) อ่าน `counting_hourly` — หลักเดียวกับ WebLog (raw สำหรับช่วงสั้น, aggregate สำหรับช่วงยาว)

## Ingest design — รองรับ 2 กรณี (สำคัญ: ตอนนี้ยังไม่รู้ว่า AI ส่งอะไรมา)

ระบบ AI ที่มีอยู่ **ยังไม่ยืนยันว่าส่งข้อมูลแบบไหน** ออกแบบ API ให้รับได้ 2 แบบ ใช้ตัวใดตัวหนึ่ง:

- **กรณี A (แนะนำ ถ้า AI ทำได้):** AI นับ line-crossing ให้แล้ว ยิงมาที่ `POST /api/events`
  บอก `{ gate, direction, trackId, ts }` ตรงๆ — backend แค่เก็บ ง่ายและแม่นสุด
- **กรณี B (fallback):** AI ส่งแค่ track ID + พิกัดจุด (centroid) มาที่ `POST /api/events/crossing`
  แล้ว backend คำนวณเองว่าจุดข้ามเส้นเสมือน (virtual line) หรือยัง — สร้าง endpoint รอไว้
  แต่ **ยังไม่ต้อง implement logic เต็มใน Phase แรก** (stub ไว้ก่อน จะทำเมื่อรู้ว่า AI ส่งแบบนี้จริง)

**กัน event ซ้ำ:** webhook อาจ retry/ยิงซ้ำ → ใช้ UNIQUE constraint `(gate, direction, track_id)`
บน `counting_events` แล้ว `INSERT ... ON CONFLICT DO NOTHING` (ถ้ามี track_id แล้วไม่นับซ้ำ)

## Occupancy logic (หัวใจของระบบ — ห้ามพลาด)

ต่อ gate เก็บ 3 ตัวเลข: `in` (เข้า), `out` (ออก), `occupancy` (คงเหลือในอาคาร = in − out)

- **occupancy reset ทุกเที่ยงคืน** (00:00 ตามเวลา server) — เริ่มนับ 0 ใหม่ทุกวัน
  เพราะ event จาก AI มีโอกาสตกหล่น (คนเดินซ้อน/เร็ว) ถ้าสะสมข้ามวันค่าจะ drift สะสม
- **มีปุ่ม reset manual** ผ่าน `POST /api/occupancy/reset?gate=left|right|all` — เผื่อค่าเพี้ยนกลางวัน
- **occupancy ไม่ต่ำกว่า 0** — clamp ที่ 0 (ถ้า out เกิน in จาก event ตกหล่น อย่าให้ติดลบ)
- คำนวณ occupancy จาก event ของ "วันนี้" (ตั้งแต่ 00:00) เท่านั้น ไม่ใช่สะสมทั้งหมด

## Data Model (PostgreSQL)

**`counting_events`** — raw ทุกครั้งที่มีคนข้ามเส้น (เทียบ access_logs ของ WebLog)
```sql
CREATE TABLE counting_events (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gate        TEXT        NOT NULL CHECK (gate IN ('left','right')),
  direction   TEXT        NOT NULL CHECK (direction IN ('in','out')),
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),  -- เวลาที่ข้ามเส้น (จาก AI; ถ้าไม่ส่งใช้ now())
  track_id    TEXT        NOT NULL,                 -- track ID จาก AI (กัน event ซ้ำ)
  confidence  REAL,                                 -- optional ถ้า AI ส่งมา
  raw         JSONB                                 -- payload ดิบจาก AI เผื่อ debug
);
-- indexes / constraints:
CREATE INDEX idx_events_gate_ts ON counting_events (gate, ts);
CREATE INDEX idx_events_ts      ON counting_events (ts);
CREATE UNIQUE INDEX uq_events_dedup ON counting_events (gate, direction, track_id);
-- ลบของเก่า > 30 วัน ด้วย scheduled job (Postgres ไม่มี TTL ในตัว — ใช้ cron ลบ)
```

**`counting_hourly`** — สรุปราย ชม. (เทียบ traffic_hourly) ตอบ 7Day เร็ว
```sql
CREATE TABLE counting_hourly (
  gate        TEXT        NOT NULL CHECK (gate IN ('left','right')),
  direction   TEXT        NOT NULL CHECK (direction IN ('in','out')),
  hour_bucket TIMESTAMPTZ NOT NULL,   -- date_trunc('hour', ts)
  count       INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (gate, direction, hour_bucket)
);
-- inc ตอนรับ event:
-- INSERT ... VALUES (gate, direction, bucket, 1)
-- ON CONFLICT (gate, direction, hour_bucket) DO UPDATE SET count = counting_hourly.count + 1;
```

**`occupancy_state`** — snapshot คนในอาคารตอนนี้ ต่อ gate (อ่านเร็ว ไม่ต้อง agg ทุกครั้ง)
```sql
CREATE TABLE occupancy_state (
  gate        TEXT        PRIMARY KEY CHECK (gate IN ('left','right')),
  in_count    INTEGER     NOT NULL DEFAULT 0,
  out_count   INTEGER     NOT NULL DEFAULT 0,
  occupancy   INTEGER     NOT NULL DEFAULT 0,
  day         DATE        NOT NULL,          -- วันของ state นี้ (เช็คว่าต้อง reset ยัง)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- ตอนรับ event: ถ้า day != วันนี้ → reset in_count/out_count/occupancy = 0, ตั้ง day = วันนี้ ก่อน inc
-- occupancy = GREATEST(0, in_count - out_count)  -- clamp ไม่ให้ติดลบ
```

> หมายเหตุ: ห่อ logic รับ event (insert event + inc hourly + update occupancy) ไว้ใน
> **transaction เดียว** เพื่อความ consistent; ใช้ `ON CONFLICT DO NOTHING` บน insert event
> เพื่อตัดสินว่าเป็น event ใหม่จริงไหม (ถ้า rowCount=0 = ซ้ำ ไม่ต้อง inc อย่างอื่น)

## API Endpoints

**Ingest (รับจาก AI Engine):**
- `POST /api/events` — กรณี A: `{ gate, direction, trackId, ts?, confidence? }` → insert + inc hourly + update occupancy (ใน transaction)
- `POST /api/events/crossing` — กรณี B (stub): `{ gate, trackId, x, y, ts? }` → คำนวณ line-crossing (ทำภายหลัง)

**Dashboard (frontend เรียก):**
- `GET /api/summary?date=today` → สรุปต่อ gate + รวม
  ```json
  { "gates": {
      "left":  { "in": 0, "out": 0, "occupancy": 0 },
      "right": { "in": 0, "out": 0, "occupancy": 0 } },
    "total": { "in": 0, "out": 0, "occupancy": 0 },
    "date": "2026-07-03" }
  ```
- `GET /api/timeseries?from=ISO&to=ISO&gate=left|right|all` → กราฟราย ชม.
  ```json
  { "series": [ { "t": "ISO", "in": 0, "out": 0 } ] }
  ```
- `GET /api/live-config` → URL stream ของแต่ละกล้อง ให้ frontend เล่น
  ```json
  { "cameras": [
      { "gate": "left",  "name": "AIDC Tech", "hlsUrl": "http://.../left/index.m3u8" },
      { "gate": "right", "name": "AIDC",      "hlsUrl": "http://.../right/index.m3u8" } ] }
  ```
- `POST /api/occupancy/reset?gate=left|right|all` → reset manual
- `GET /api/health` → `{ ok: true }`

## Tech Stack (ตายตัว — ห้ามเปลี่ยนโดยไม่ได้รับคำสั่ง)

- **Backend:** Node.js + Express
- **Database:** PostgreSQL อย่างเดียว (official `pg` driver — node-postgres; **ไม่ใช้ ORM**, เขียน SQL ตรง)
- **Frontend:** React + Vite — **Theme/สี/ฟอนต์/component เหมือน WebLog** (คัด style มา reuse)
- **Live streaming:** MediaMTX (Docker) แปลง RTSP → HLS; frontend เล่นด้วย `hls.js`
- **Deployment:** Docker Compose (backend + postgres + mediamtx)

## Coding Style & Conventions (เหมือน WebLog)

- **Module system:** ES Modules (`import`/`export`) เท่านั้น — `package.json` ตั้ง `"type": "module"`
- **Async:** `async/await` เสมอ ไม่ใช้ `.then()` chains; ครอบ DB query และ I/O ด้วย try/catch ที่จัดการ error จริง
- **Naming:** ตัวแปร/ฟังก์ชัน `camelCase`, ค่าคงที่ `UPPER_SNAKE_CASE`, React component `PascalCase`,
  ไฟล์ component `PascalCase.jsx` ไฟล์อื่น `camelCase.js`; **ชื่อ table/column ใน SQL เป็น `snake_case`**
- **PostgreSQL:**
  - ใช้ `pg` (node-postgres) connection **pool** (singleton) — ไม่เปิด client ใหม่ทุก query
  - **parameterized query เสมอ** (`$1, $2`) ห้าม string-concat ค่าลง SQL (กัน SQL injection)
  - query สรุปยอดใช้ SQL `GROUP BY date_trunc('hour', ts)` / aggregate ตรงๆ
  - ห่อ multi-step write ไว้ใน transaction (`BEGIN/COMMIT/ROLLBACK`)
  - schema/migration เก็บเป็นไฟล์ `.sql` ใน `backend/migrations/` รันตอน start (idempotent, `IF NOT EXISTS`)
- **Config:** ทุกค่าที่ env กำหนดได้ อ่านผ่าน `backend/src/config.js` เท่านั้น ห้าม `process.env.X` กระจายตามไฟล์
  (รวม `DATABASE_URL`, RTSP URL/credential ของกล้อง, HLS base URL, ค่า reset hour)
- **Error handling:** ingest ต้องไม่ throw จน process ตาย — log แล้วตอบ 200 (กัน AI retry ถล่ม);
  API ตอบ HTTP status ที่เหมาะสม (400 bad param, 500 server error) พร้อม JSON `{ error: "..." }`
- **Comment:** ภาษาอังกฤษ อธิบาย "ทำไม" ไม่ใช่ "ทำอะไร" เน้นจุดที่ไม่ชัด (occupancy reset, dedup)
- **Entry guard:** ใช้ `pathToFileURL(process.argv[1]).href` เทียบ `import.meta.url` (ไม่ใช่ template string — พังบน Windows)
- **Secrets:** credential กล้อง Dahua + DB password ห้าม hardcode ในโค้ด/commit — อยู่ใน `.env` เท่านั้น (มี `.env.example`)

## Live view — ข้อควรรู้ (Dahua + browser)

- browser เล่น RTSP ตรงๆ ไม่ได้ ต้องผ่าน MediaMTX แปลงเป็น HLS ก่อน
- RTSP URL ของ Dahua มาตรฐาน: `rtsp://user:pass@ip:554/cam/realmonitor?channel=1&subtype=0`
  (`subtype=0` = main stream ชัด, `subtype=1` = sub stream เล็ก — **ใช้ subtype=1 สำหรับ live view บนเว็บ** ประหยัด bandwidth)
- HLS หน่วง ~5-10 วิ (รับได้สำหรับ monitoring; ไม่ใช่ security-critical)
- frontend ใช้ `hls.js`; ถ้า browser รองรับ HLS native (Safari) เล่น URL ตรงได้

## สิ่งที่ควรถามก่อนทำ

ถ้างานกระทบ occupancy logic, schema ของ `counting_events`/`counting_hourly`/`occupancy_state`,
วิธี dedup, หรือ response shape ที่ frontend ใช้ ให้ยืนยัน scope สั้นๆ ก่อนลงมือ
มิฉะนั้นดำเนินการตาม spec นี้ได้เลย

## หมายเหตุที่ยังต้องเช็คกับของจริง (บันทึกไว้ อย่าเดา)

- **ยังไม่รู้ว่า AI Engine ส่ง payload หน้าตายังไง** — พอรู้แล้วต้องเขียน adapter map มาเป็น
  `{ gate, direction, trackId, ts }`; ตอนนี้ให้ `POST /api/events` รับ shape มาตรฐานข้างบนไปก่อน
- **mapping ว่า camera ตัวไหน = gate ไหน** ขึ้นกับ config กล้องจริง (ตั้งใน `.env`)
- **AI จะแยกทิศ in/out จากประตูได้แค่ไหน** ขึ้นกับมุมกล้อง/การตั้งเส้น — ต้อง verify กับหน้างานจริง
