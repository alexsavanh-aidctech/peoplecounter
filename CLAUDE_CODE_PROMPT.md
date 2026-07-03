# Prompt สำหรับ Claude Code — เปิดงาน People Counter (Phase 1)

> วิธีใช้: สร้างโฟลเดอร์ project ใหม่ใน VS Code, วาง `CLAUDE.md` ลงใน root,
> เปิด Claude Code แล้ววาง prompt ด้านล่างนี้เป็นข้อความแรก

---

อ่าน `CLAUDE.md` ใน root ให้ครบก่อน แล้วช่วย scaffold โปรเจกต์ **People Counter** ใหม่ตั้งแต่ต้น

ผมใช้ VS Code บน Windows (dev machine), deploy จริงบน server `10.0.100.46` ด้วย Docker Compose
โปรเจกต์นี้ **แยกจาก WebLog** แต่ให้ reuse แนวทาง/สไตล์เดียวกันตามที่ระบุใน CLAUDE.md
**Database เป็น PostgreSQL** (ใช้ `pg` / node-postgres, เขียน SQL ตรง ไม่ใช้ ORM)

## ขอบเขต Phase 1 (ทำแค่นี้ก่อน — อย่าเพิ่งทำ frontend/live view)

ทำ **backend + data layer + ingest + ตัว mock ทดสอบ** ให้ครบและรันได้ ตามลำดับ:

1. **โครงโปรเจกต์ + config**
   - โครงโฟลเดอร์: `backend/src/`, `backend/migrations/`, `backend/scripts/`, `docs/`,
     root มี `docker-compose.yml`, `.env.example`, `.gitignore`
   - `package.json` ตั้ง `"type": "module"`, dependency: `express`, `pg` (ยังไม่ต้องใส่ frontend)
   - `backend/src/config.js` อ่านค่าจาก env ทั้งหมด: `DATABASE_URL`, `PORT`, `TZ`,
     `OCCUPANCY_RESET_HOUR` (default 0), camera config (RTSP/HLS URL ต่อ gate)
   - `.env.example` ใส่ตัวอย่างครบ (DB password + credential กล้องเป็น placeholder — ห้าม hardcode ค่าจริง)

2. **PostgreSQL layer**
   - `backend/migrations/001_init.sql` — สร้าง table ทั้ง 3 ตัวตาม CLAUDE.md
     (`counting_events`, `counting_hourly`, `occupancy_state`) พร้อม index/constraint ครบ
     เขียนแบบ **idempotent** (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`)
   - `backend/src/db.js` — `pg` connection **pool** (singleton), export `query()` และ `getPool()`,
     function `runMigrations()` อ่านไฟล์ใน `migrations/` มารันตอน start (เรียงตามชื่อไฟล์)
   - helper `withTransaction(fn)` สำหรับห่อ multi-step write

3. **Ingest logic** (`backend/src/ingest.js`)
   - `recordEvent({ gate, direction, trackId, ts, confidence, raw })`:
     - validate `gate ∈ {left,right}`, `direction ∈ {in,out}`
     - ถ้าไม่ส่ง `ts` มาใช้เวลาปัจจุบัน
     - ทำใน **transaction เดียว**:
       - `INSERT INTO counting_events ... ON CONFLICT (gate, direction, track_id) DO NOTHING`
         ถ้า `rowCount === 0` = ซ้ำ → return `{ duplicate: true }` และไม่ inc อย่างอื่น
       - ถ้า insert สำเร็จ (event ใหม่): upsert `counting_hourly`
         (`ON CONFLICT (gate, direction, hour_bucket) DO UPDATE SET count = count + 1`)
         โดย bucket = `date_trunc('hour', ts)`
       - update `occupancy_state`: **เช็ค day ก่อน** ถ้า `day != วันนี้` reset in/out/occupancy=0
         ตั้ง day ใหม่ แล้วค่อย inc (`in_count` หรือ `out_count` ตาม direction)
         และ set `occupancy = GREATEST(0, in_count - out_count)`
   - เขียน comment อธิบาย "ทำไม" ตรง occupancy reset และ dedup
   - **ใช้ parameterized query (`$1,$2,...`) เสมอ** ห้าม concat ค่าลง SQL

4. **REST API** (`backend/src/server.js` + `backend/src/routes.js`)
   - `POST /api/events` → เรียก `recordEvent`; **ตอบ 200 เสมอแม้ error** (log ไว้ กัน AI retry ถล่ม)
   - `POST /api/events/crossing` → **stub**: รับ payload, log ไว้, ตอบ 200 พร้อม `{ todo: "line-crossing logic pending AI payload spec" }`
   - `GET /api/summary?date=today` → อ่าน `occupancy_state` ทั้ง 2 gate + รวม total (ตาม shape ใน CLAUDE.md)
   - `GET /api/timeseries?from&to&gate` → query จาก `counting_hourly` (ช่วงสั้นในวันนี้อ่าน events ตรงด้วย `date_trunc('hour', ts)` ได้) คืน series ราย ชม.
   - `POST /api/occupancy/reset?gate=left|right|all` → reset manual
   - `GET /api/live-config` → คืน camera config จาก config.js (ยังไม่ต้องต่อ MediaMTX จริง แค่คืน URL จาก env)
   - `GET /api/health` → `{ ok: true }` (เช็ค DB ping ด้วยยิ่งดี)
   - ทุก error ตอบ JSON `{ error: "..." }` + status ที่เหมาะสม

5. **Mock event generator** (`backend/scripts/mockEvents.js`)
   - script ยิง `POST /api/events` แบบสุ่ม gate/direction/trackId ทุก ~2 วิ
   - ใช้ทดสอบทั้งระบบโดยยังไม่มี AI จริง
   - รับ arg จำนวน event / interval ได้

6. **Retention job** (`backend/scripts/purgeOld.js`)
   - Postgres ไม่มี TTL ในตัว — เขียน script ลบ `counting_events` ที่ `ts < now() - interval '30 days'`
   - ไว้ผูก cron ภายหลัง (Phase deploy)

7. **docker-compose.yml**
   - service: `postgres` (persist volume, ตั้ง `POSTGRES_PASSWORD` จาก env), `backend`
   - backend รอ postgres พร้อม (healthcheck / depends_on) ก่อนรัน migration
   - **ยังไม่ต้องใส่ mediamtx** — คอมเมนต์ placeholder ไว้เฉยๆ ว่าจะเพิ่ม Phase 2
   - backend อ่าน env จาก `.env`

8. **docs/PLAN.md**
   - สร้างไฟล์สรุปสถานะแบบเดียวกับ MIGRATION_PLAN.md ของ WebLog:
     ภาพรวม, สิ่งที่เสร็จใน Phase 1, สิ่งที่รอ Phase 2 (frontend + MediaMTX live view),
     และ **จุดที่ต้องเช็คกับของจริง** (AI payload spec, camera↔gate mapping, ทิศ in/out)

## เกณฑ์ว่า Phase 1 เสร็จ

- รัน `docker compose up` แล้ว backend + postgres ขึ้น, migration รันสร้าง table + index ครบ
- รัน mock generator แล้ว `GET /api/summary` เห็นตัวเลข in/out/occupancy เพิ่มขึ้นจริง
- ยิง event ซ้ำ track_id เดิม แล้ว summary **ไม่เพิ่มซ้ำ** (dedup ผ่าน `ON CONFLICT` ทำงาน)
- occupancy reset ทำงานเมื่อข้ามวัน (เทสด้วยการ mock ts เป็นเมื่อวาน)
- occupancy ไม่ติดลบ (clamp ที่ 0 ด้วย `GREATEST`)
- มี script ตรวจ edge cases: dedup, occupancy clamp ที่ 0, reset ข้ามวัน

เริ่มจากข้อ 1 ก่อน ทำทีละส่วน commit เป็นระยะ และถ้าจุดไหนกระทบ schema/response shape
ที่ระบุใน CLAUDE.md ให้ยืนยันกับผมสั้นๆ ก่อน มิฉะนั้นทำตาม spec ได้เลย

---

## Phase ถัดไป (ยังไม่ต้องทำตอนนี้ — บันทึกไว้เฉยๆ)

- **Phase 2:** frontend React + Vite (reuse Theme WebLog), live view 2 จอด้วย hls.js, KPI card + กราฟ
- **Phase 3:** setup MediaMTX จริง (RTSP Dahua subtype=1 → HLS), ต่อกล้องจริงบน server
- **Phase 4:** เชื่อม AI Engine จริง — เขียน adapter map payload ของ AI → shape `/api/events`,
  verify ทิศ in/out กับหน้างาน, จูน dedup
