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

## Phase 2 — รอทำ (frontend + live view)

- React + Vite, **reuse Theme/สี/ฟอนต์ของ WebLog**
- Live view 2 จอ (ซ้าย/ขวา) ด้วย `hls.js` อ่าน URL จาก `GET /api/live-config`
- KPI card (เข้า/ออก/คงเหลือ ต่อฝั่ง + รวม) + กราฟราย ชม. จาก `/api/summary` + `/api/timeseries`
- setup MediaMTX (RTSP Dahua subtype=1 → HLS) ใน docker-compose (placeholder ไว้แล้ว)

## Phase 3 — ต่อกล้องจริงบน server 10.0.100.46

- ใส่ RTSP credential จริงใน `.env`, verify HLS ออกจาก MediaMTX
- ผูก cron รัน `purgeOld.js` รายวัน

## Phase 4 — เชื่อม AI Engine จริง

- เขียน adapter map payload ของ AI → shape `/api/events` (`{gate,direction,trackId,ts}`)
- ถ้า AI ส่งแค่ centroid → implement logic ใน `/api/events/crossing` (ตอนนี้ stub)

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
