# videoStatServer RPC2 — reference (from RunCountApp)

> เอกสารอ้างอิง (read-only) สรุปวิธีที่ **RunCountApp** (repo เพื่อนร่วมงาน, `D:\Dev\RunCountApp`)
> ดึงยอด People Counting ผ่าน **RPC2 `videoStatServer`** — เพื่อประเมินว่าจะยืมวิธีนี้มาใช้ใน
> peoplecounter (แทน/เสริมการ subscribe event `NumberStat` ใน Phase 4A) ได้ไหม
>
> **อ่าน RunCountApp เป็น reference เท่านั้น ไม่ได้ copy โค้ดมา** — `videoStatProbe.js` เขียนใหม่เอง
> อ้างอิงไฟล์ต้นทาง: `dahua.js` (RPC client), `server.js` (poll loop), `logger.js` (delta), `config.example.json`

---

## 1. ภาพรวมแนวคิด

RunCountApp **ไม่ subscribe event** — มัน **poll ยอดสะสมรายชั่วโมง** จากอุปกรณ์ทุก `refreshSeconds`
(ดีฟอลต์ 30s) ผ่าน object RPC2 ชื่อ `videoStatServer` แล้วรวมเป็นยอดวันนี้
(`total = entered + exited`). ส่วน "ต่อ 5 นาที" ได้จากการ **sample ยอดสะสมแล้วคิด delta** เอง
(ไม่ได้ถามอุปกรณ์ถี่ขึ้น — ดูหัวข้อ 6)

อุปกรณ์ที่ verify: **DHI-NVR5232-EI (NVR 32ch)**, กล้อง 3 ตัวอยู่ channel 0/1/2, rule People
Counting ชื่อ **`NumberStat`**, `AreaID 1`.

## 2. Transport / endpoint

| | ค่า |
|---|---|
| Protocol | **HTTP** (ไม่ใช่ HTTPS), `POST` body เป็น JSON |
| Login path | `POST http://<host>/RPC2_Login` |
| RPC path | `POST http://<host>/RPC2` |
| Header | `Content-Type: application/json` |
| Auth | **RPC2 session + MD5 challenge ใน body** (ไม่ใช่ HTTP Digest — digest ใช้เฉพาะ `snapshot.cgi`) |
| Timeout | ~8s ต่อ call (RunCountApp override ได้ด้วย env `RPC_TIMEOUT_MS`) |
| `id` | integer เพิ่มขึ้นเรื่อยๆ ต่อ call (RunCountApp เริ่ม ~1001) |

ทุก response เป็น JSON `{ id, result, params?, session?, error? }` — `result:false` + `error.code/message` เมื่อพลาด

## 3. ลำดับ RPC ทั้งหมด

### 3.1 Login (2 ขั้น — MD5 challenge)

**ขั้น A — ขอ challenge** (`POST /RPC2_Login`):
```json
{ "method": "global.login",
  "params": { "userName": "<user>", "password": "", "clientType": "Web3.0" },
  "id": 1001 }
```
ตอบกลับ (result มัก `false` ในขั้นนี้ แต่แนบ realm/random/session มา):
```json
{ "params": { "realm": "Login to ...", "random": "1234567890", "encryption": "Default" },
  "session": "abc123...", "id": 1001 }
```

**ขั้น B — ตอบ challenge** (`POST /RPC2_Login`, ใส่ `session` จากขั้น A):
```
hash1  = MD5_UPPERCASE( "<user>:<realm>:<pass>" )
answer = MD5_UPPERCASE( "<user>:<random>:<hash1>" )
```
```json
{ "method": "global.login",
  "params": { "userName": "<user>", "password": "<answer>",
              "clientType": "Web3.0", "authorityType": "Default", "passwordType": "Default" },
  "id": 1002, "session": "<session from A>" }
```
ตอบกลับสำเร็จ: `{ "result": true, "session": "<session>", "params": { "keepAliveInterval": 60 } }`
→ เก็บ `session` (ใช้ทุก call ต่อไป) + `keepAliveInterval` (วินาที)

> **หมายเหตุ hex case:** RPC2 login ใช้ MD5 แบบ **ตัวพิมพ์ใหญ่**; ต่างจาก HTTP Digest ของ
> `snapshot.cgi` ที่ใช้ **ตัวพิมพ์เล็ก** — อย่าสลับกัน

### 3.2 สร้าง object (`factory.instance`) — 1 ครั้งต่อ session ต่อ channel

```json
{ "method": "videoStatServer.factory.instance",
  "params": { "channel": 0 },
  "id": 1003, "session": "<session>" }
```
ตอบกลับ: `{ "result": <objectId:number> }` → เก็บ `objectId` แนบเป็น field **`object`** ในทุก call ของ find

### 3.3 startFind → doFind (วนหน้า) → stopFind

**startFind:**
```json
{ "method": "videoStatServer.startFind",
  "params": { "condition": {
      "StartTime": "2026-07-06 00:00:00",
      "EndTime":   "2026-07-06 23:00:00",
      "Granularity": "Hour",
      "MinStayTime": 0,
      "IntelliType": 0,
      "AreaID": [1] } },
  "object": <objectId>, "id": 1004, "session": "<session>" }
```
ตอบกลับ: `{ "params": { "token": <n>, "totalCount": <n> } }`

**doFind** (วนจนครบ `totalCount`, หน้าละ ≤100):
```json
{ "method": "videoStatServer.doFind",
  "params": { "token": <token>, "beginNumber": 0, "count": 100 },
  "object": <objectId>, "id": 1005, "session": "<session>" }
```
ตอบกลับ — **นี่คือข้อมูลที่ต้องการ** (array ใน `params.info`):
```json
{ "params": { "found": 8, "info": [
    { "Channel": 0, "AreaID": 1,
      "EnteredSubtotal": 12, "ExitedSubtotal": 9, "PassbyTotal": 0,
      "StartTime": "2026-07-06 08:00:00", "EndTime": "2026-07-06 09:00:00" },
    ...
] } }
```

**stopFind** (ปิด token เสมอ แม้ error):
```json
{ "method": "videoStatServer.stopFind", "params": { "token": <token> },
  "object": <objectId>, "id": 1006, "session": "<session>" }
```

## 4. Response fields — ตัวไหนคืออะไร

| field | ความหมาย |
|---|---|
| `EnteredSubtotal` | คน **เข้า** ในช่วง bucket นั้น (ยอดของ bucket, รายชั่วโมง) |
| `ExitedSubtotal` | คน **ออก** ในช่วง bucket นั้น |
| `PassbyTotal` | คนเดินผ่าน (ไม่ข้ามเส้นเข้า/ออก) |
| `Channel` / `AreaID` | ช่อง + พื้นที่ของ rule (NumberStat AreaID 1) |
| `StartTime`/`EndTime` | ขอบเขตเวลาของ bucket |

**การรวมของ RunCountApp:** `entered = Σ EnteredSubtotal`, `exited = Σ ExitedSubtotal`,
`passby = Σ PassbyTotal`, **`total = entered + exited`** (คนผ่านรวม 2 ทาง — **ไม่ใช่ occupancy**)

> ⚠️ **ต่างกับ peoplecounter:** เราต้องการ **occupancy = entered − exited** (คนคงเหลือ) ไม่ใช่ throughput
> ถ้ายืมวิธี pull มา ก็แค่คิดเลขต่างกัน (in − out แทน in + out) — ข้อมูลดิบ `Entered/Exited` ให้ทั้งสองได้

## 5. Session / keepAlive / resilience (RunCountApp)

- **keepAlive:** `{ "method": "global.keepAlive", "params": { "timeout": <interval>, "active": true }, "session": ... }`
  → `result:true` = session ยังอยู่. RunCountApp ping เฉพาะตอน session idle > 80% ของ interval (`keepAliveIfIdle`)
- **re-login อัตโนมัติ:** ถ้า call ไหนเจอ session ตาย → ทิ้ง session+object แล้ว login ใหม่ (สูงสุด `maxRelogins=2`)
- **ตรวจ session error จาก:** `error.code === 287637505` หรือ `268894209` หรือ message เข้า `/session|login|object/i`
- **object ผูกกับ session:** login ใหม่ = ต้อง `factory.instance` ใหม่ (objectId เดิมใช้ไม่ได้)
- **freeze last-good:** poll fail ชั่วคราว → คงเลขล่าสุดไว้ 1 รอบ (ยอดสะสมอยู่แล้ว ไม่ทำให้ตกเป็น 0)
- **timeout 8s**, ปรับผ่าน env `RPC_TIMEOUT_MS` (สำคัญเมื่อยิงข้าม tunnel/relay ที่ latency สูง)

## 6. Delta logic (RunCountApp `logger.js`) — ถ้าจะยืมมาคิด occupancy

อุปกรณ์ให้แค่ยอดสะสม/รายชั่วโมง → RunCountApp **sample ยอดสะสมทุก 5 นาที** แล้วเก็บ delta ลง JSONL:
- `computeDelta(prev, cur)` = `cur − prev` ต่อ metric
- **ถ้าติดลบ** (คน้อยลง = midnight reset หรือกล้อง offline/กลับมา) → **clamp เป็น 0** แล้ว re-baseline
  (log ไม่มีเลขติดลบ / ไม่มี spike ปลอม)
- เก็บทั้ง `delta` และ `cumulative` ในแต่ละบรรทัด (คำนวณย้อนหลังใน Excel ได้)
- `seedFromDisk()` โหลด baseline จากบรรทัดสุดท้ายตอน restart กลางวัน (logging ต่อเนื่อง)

> peoplecounter มี pattern คล้ายกันอยู่แล้ว (inc `traffic_hourly` ด้วย delta ข้าม batch) — แนวคิด clamp
> ตอนยอดถอยหลัง เอามาปรับใช้กับ occupancy/hourly ได้

## 7. ความต่าง NVR → กล้องเดี่ยว (จุดที่ต้องปรับ/ต้องพิสูจน์)

RunCountApp ต่อ **NVR** (1 host, หลาย channel); peoplecounter ต่อ **กล้อง Dahua เดี่ยวรายตัว**
→ ต้องพิสูจน์ว่ากล้องเดี่ยวตอบ `videoStatServer` ด้วย (บาง object มีเฉพาะบน NVR)

| param / จุด | NVR (RunCountApp) | กล้องเดี่ยว (peoplecounter — เดา, ต้องเทส) |
|---|---|---|
| `host` | 1 host ต่อ NVR | IP ของกล้องแต่ละตัว (`CAM_LEFT_IP`) |
| `channel` (factory.instance) | 0/1/2 ต่อกล้อง | น่าจะ **`0`** (กล้องเดี่ยวมักช่องเดียว) |
| `AreaID` | `[1]` | ลอง `[1]` ก่อน; ถ้า `info` ว่าง ลอง `[0]` / ไม่ใส่ / ค่าอื่น |
| object `videoStatServer` | มีแน่ (verify แล้ว) | **ไม่รู้ — ต้องเทส**; ถ้า `factory.instance` ตอบ method/object not found = กล้องเดี่ยวไม่รองรับวิธีนี้ |
| Granularity | `Hour` | เหมือนกัน (รายชั่วโมง) — รวมเป็นยอดวัน |
| snapshot channel | 0-based+1 | ไม่เกี่ยว (เราใช้ MediaMTX/HLS ทำ live view แล้ว) |

**เกณฑ์ตัดสินหลังรัน probe (จันทร์):**
- ✅ **ตอบยอด Enter/Exit ได้** + ตรงกับ OSD บนภาพ Live → วิธี pull ใช้กับกล้องเราได้
  → พิจารณาเปลี่ยน Phase 4 เป็น **poll videoStatServer** (เก็บ backend/occupancy/live view/theme เดิม
  เปลี่ยนแค่ที่มาของตัวเลข: pull → คิด delta → occupancy = in − out)
- ❌ **method/object not found หรือ info ว่างเสมอ** → กล้องเดี่ยวไม่รองรับ → อยู่กับแนว event `NumberStat` (Phase 4A) ต่อ

## 8. อ้างอิงไฟล์ต้นทาง (RunCountApp)

- `dahua.js` — `DahuaCamera` class: `login()`, `ensureObject()`, `_findOnce()`, `aggregate()`, `keepAlive()`
- `server.js` — poll loop (`refresh()`), `/api/counts`, freeze-last-good
- `logger.js` — `computeDelta()`, `RunLogger` (JSONL, clamp, seedFromDisk)
- `config.example.json` — `stat` block (method/useFactory/recordsKey/conditionExtra/fields) + cameras
