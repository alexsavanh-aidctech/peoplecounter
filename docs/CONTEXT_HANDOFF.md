# People Counter — Context Handoff

> เอกสารสรุป context ทั้งหมดของโปรเจกต์ (เขียน 2026-07-06) — ใช้เปิดแชท Claude ใหม่ต่อได้เลย
> ถ้าเริ่มแชทใหม่: อ่าน `CLAUDE.md` + `docs/PLAN.md` + ไฟล์นี้ ก่อนเริ่มงาน

## โปรเจกต์คืออะไร
Dashboard นับคนเข้า-ออก 2 ประตูจากกล้อง Dahua + ดูภาพสด
- ประตูซ้าย = **AIDC Tech** (`gate: left`), ประตูขวา = **AIDC** (`gate: right`)
- ต้องการ: **เข้า / ออก / คงเหลือ (occupancy) ต่อประตู** + กราฟราย ชม. + live view 2 จอ
- UI ภาษาลาว, ธีมเหมือน WebLog (dark), refresh ด้วยปุ่ม (ไม่ auto-poll)

## Repo / GitHub / เครื่อง
- local: `D:\Dev\peoplecounter` (มี repo เพื่อนร่วมงาน `D:\Dev\RunCountApp` แยกต่างหากไว้อ้างอิง)
- GitHub: **`alexsavanh-aidctech/peoplecounter`** (HTTPS + Git Credential Manager), branch `main`
- dev: Windows + Docker; deploy จริงตั้งใจไว้ที่ server **`10.0.100.46`** (ยังไม่ deploy)

## Stack (ตายตัว)
- Backend: Node.js + Express (ES Modules, `"type":"module"`)
- DB: **PostgreSQL** (driver `pg`, SQL ตรง ไม่มี ORM) — *เดิม CLAUDE.md เป็น Mongo แล้วเปลี่ยนเป็น Postgres*
- Frontend: React 18 + Vite 5 + **recharts** (ธีม/สี/ฟอนต์ = WebLog เป๊ะ)
- Live view: **MediaMTX** (RTSP→HLS) + `hls.js`
- Deploy: Docker Compose (postgres + backend + mediamtx)

## Data model (Postgres) — `backend/migrations/001_init.sql`
- `counting_events` (per-event, unique `(gate,direction,track_id)` กัน dedup, index `ts` สำหรับ purge 30 วัน)
- `counting_hourly` (`gate,direction,hour_bucket,count` — สรุปราย ชม.)
- `occupancy_state` (`gate` PK, `in_count/out_count/occupancy`, `day` สำหรับ reset รายวัน)
- occupancy = `GREATEST(0, in-out)` (clamp ไม่ติดลบ), reset ที่ event แรกของวันใหม่

## API (response shape ล็อคแล้ว — frontend ผูกอยู่)
- `POST /api/events` `{gate,direction,trackId,ts?}` → 200 เสมอ (กัน retry ถล่ม)
- `POST /api/events/crossing` → stub รอ AI payload spec
- `GET /api/summary` → `{gates:{left,right},total,date}` (in/out/occupancy)
- `GET /api/timeseries?from&to&gate` → `{series:[{t,in,out}]}`
- `GET /api/live-config` → `{cameras:[{gate,name,hlsUrl}]}`
- `POST /api/occupancy/reset?gate=left|right|all`, `GET /api/health`

## สถานะแต่ละ Phase (commit ล่าสุด `b2e29a8`)
- **Phase 1** (`b6d0fae`) — backend + Postgres + ingest + edge tests 11/11 ✓
- **Phase 2** (`b69d307`) — frontend React/Vite/recharts, ธีม WebLog, verify ด้วย screenshot ✓
- **Phase 3** (`411c35d`) — MediaMTX live view (dev). กล้องซ้าย sub stream = **H.265/HEVC** →
  ต้อง **transcode H.264** (`CAM_LEFT_TRANSCODE=1`); เห็นภาพสดจริงบน frontend ✓
- **โลโก้** (`130a660`) — AIDC logo บน chip ขาวมุมซ้าย header
- **Phase 4A** (`bc32ccf`) — discovery: กล้องซ้าย rule = **`NumberStat`** (AreaID 1);
  firmware ไม่รองรับ `codes=[All]` (ต้อง `[NumberStat]`); `backend/scripts/dahuaEventProbe.js`
- **Phase 4 eval** (`b2e29a8`) — `docs/videostat_reference.md` + `backend/scripts/videoStatProbe.js`

## ⭐ ผลล่าสุด (2026-07-06 ที่ออฟฟิศ) — จุดตัดสินใจสำคัญ
รัน `node backend/scripts/videoStatProbe.js --gate left --channel 0` → **สำเร็จ**:
- **กล้อง Dahua เดี่ยว (ไม่ใช่ NVR) ตอบ `videoStatServer` RPC ได้** — factory.instance → startFind →
  doFind คืน 23 แถวราย ชม. จริง, field `EnteredSubtotal/ExitedSubtotal`, `RuleName:"NumberStat"`
- ข้อมูลจริงวันนี้: Entered=9, Exited=15
- **แนวทางที่เลือก: Phase 4 = poll `videoStatServer`** (ยืมวิธี RunCountApp) แทน event subscribe
  เพราะไม่ต้อง dedup/walk-capture; เก็บ backend/occupancy/live view/theme เดิมทั้งหมด

### ⚠️ ต้องเช็คก่อนทำ Phase 4B
- **occupancy = Entered − Exited = −6 (ติดลบ)** → เช้าออฟฟิศควรเข้า>ออก แต่กลับกัน →
  **ทิศน่าจะยังกลับด้านที่กล้อง** ต้องเทียบ Enter/Exit กับ **OSD บนภาพ Live** แล้วสลับทิศที่ web UI กล้อง
- ต่อ **กล้องขวา (AIDC)** — ยังเป็น placeholder ใน `.env`, ต้องใส่ IP/user/pass จริง

## เทียบกับ RunCountApp (เพื่อนร่วมงาน) — ตัดสินแล้ว
- RunCountApp = **throughput** (คนผ่าน=in+out) บน **NVR**, live view = ภาพนิ่ง JPEG, เก็บ JSONL (ไม่มี DB),
  **ไม่มี occupancy** — คนละโจทย์ → **เก็บ peoplecounter ไว้**, ยืมแค่วิธี pull videoStatServer
- RPC flow ของมันสรุปไว้ที่ `docs/videostat_reference.md` (login MD5 challenge → factory.instance →
  startFind/doFind/stopFind; delta clamp-on-backwards; re-login/keepAlive)

## วิธีรันของบน dev
```bash
# stack เต็ม (ต้องมี .env จริง)
docker compose up --build
# frontend dev (proxy /api → backend)
cd frontend && npm run dev            # http://localhost:5174
# edge tests
node backend/scripts/testEdgeCases.js
# probe videoStatServer (ต้องอยู่บน LAN กล้อง)
node backend/scripts/videoStatProbe.js --gate left --channel 0
```

## 🔐 Security (สำคัญ — เคยเกือบรั่ว)
- **credential กล้องอยู่ใน `.env` เท่านั้น** (gitignored); `.env.example` เป็น placeholder ล้วน
- เคยพลาดใส่รหัสจริงใน `.env.example` (ไฟล์ commit) — แก้แล้ว, **git history สะอาด ไม่มีรหัสจริง**
- ก่อน commit/push ทุกครั้ง: scan `git grep --cached` หา IP/pass จริง; อย่าใส่ IP กล้องจริงลง docs
- กล้องซ้ายจริง: IP/user/pass อยู่ใน `.env` (อย่า echo รหัสออก log)

## Environment quirks (กันสะดุด)
- Windows + PowerShell/Git Bash; **`source .env` พังเพราะ `CAM_LEFT_NAME=AIDC Tech` มีช่องว่าง** →
  โหลดเฉพาะ key ที่ต้องใช้ หรือใช้ .env loader ในตัว script (videoStatProbe ทำแล้ว)
- **Entry guard** ใช้ `pathToFileURL(process.argv[1]).href` (template string พังบน Windows)
- MediaMTX image pin `bluenviron/mediamtx:1.11.3` (custom Dockerfile + ffmpeg + entrypoint gen config จาก env)
- Edge headless (`--screenshot`) เคยแฮงก์เป็นช่วงๆ — ใช้ verify ได้แต่ไม่เสถียร
- ตอนขึ้น server: `MEDIAMTX_HLS_BASE=http://10.0.100.46:8888` (ต้องเป็น URL ที่ browser เข้าถึง), เปิด firewall 8888

## Next steps (ลำดับ)
1. เทียบ Enter/Exit กับ OSD → แก้ทิศที่กล้องถ้ากลับ
2. ต่อกล้องขวา + รัน `videoStatProbe --gate right`
3. เขียน Phase 4B: poll service (compose) → delta → `traffic_hourly` + occupancy ต่อ gate
4. deploy ขึ้น server 10.0.100.46
