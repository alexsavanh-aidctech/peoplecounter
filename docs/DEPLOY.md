# Deploy runbook — People Counter

> Full stack in one `docker compose up`: **postgres + backend + frontend (nginx) + poller + mediamtx**.
> Browser hits **frontend :8080** (UI + `/api` proxied to backend) and **mediamtx :8888** (HLS).

## 0. Prereqs (บน server 10.0.100.46)
- Docker + Docker Compose (มีอยู่แล้ว — WebLog รันบน server นี้)
- **⚠️ ต้องเช็คก่อนสุด: server route ไปถึงกล้องได้ไหม** (คนละ subnet: server กับกล้องคนละวง)
  ```bash
  # ใส่ IP กล้องจริง (ดูจาก .env: CAM_LEFT_IP / CAM_RIGHT_IP)
  ping -c2 <CAM_LEFT_IP> && ping -c2 <CAM_RIGHT_IP>      # ต้องได้ทั้งคู่
  nc -zv <CAM_LEFT_IP> 80 && nc -zv <CAM_LEFT_IP> 554    # HTTP(RPC)+RTSP เปิด
  ```
  **ถ้า ping ไม่ได้ = poller จะใช้ไม่ได้บน server** → ต้องแก้ routing/VLAN ให้ server ถึง subnet กล้องก่อน
- **Ports บน 10.0.100.46:** 8080 ถูก WebLog ใช้แล้ว → peoplecounter ใช้ **`WEB_PORT=8090`** (ว่าง),
  HLS **8888** (ว่าง). เปิด firewall ขาเข้า **8090 + 8888**

## 1. โค้ด + `.env`
```bash
git clone https://gitlab.aidclaos.com/tech-lab/peoplecounter.git
cd peoplecounter
cp .env.example .env
```
แก้ `.env` (อย่า commit — gitignored อยู่แล้ว):
- **DB:** `POSTGRES_PASSWORD` (ตั้งใหม่), `DATABASE_URL` ให้ตรง (host = `postgres`)
- **กล้อง (จริง):** `CAM_LEFT_IP/USER/PASS`, `CAM_RIGHT_IP/USER/PASS`
- **ทิศ:** `CAM_LEFT_SWAP_INOUT` / `CAM_RIGHT_SWAP_INOUT` (ดูข้อ 4)
- **codec:** `CAM_*_TRANSCODE=1` ถ้ากล้องเป็น H.265 (ของเราเป็น H.265 ทั้งคู่)
- **HLS base (สำคัญ):**
  - เข้าผ่าน IP ตรง (LAN): `MEDIAMTX_HLS_BASE=http://10.0.100.46:8888`
  - **เข้าผ่าน domain HTTPS (production):** `MEDIAMTX_HLS_BASE=https://smartcamera.aidclaos.com/hls`
    ← บนหน้า HTTPS **ห้ามใช้ `http://IP:8888`** (browser บล็อกเป็น Mixed Content) →
    ต้องวิ่งผ่าน path `/hls` บน domain เดียวกัน (ดูข้อ 6)
  - ค่านี้ frontend รับตอน runtime ผ่าน `/api/live-config` → **เปลี่ยนแล้ว recreate backend พอ ไม่ต้อง rebuild frontend**
- **poll:** `POLL_INTERVAL_SECONDS=10` (หรือปรับ)
- **ports (server 10.0.100.46):** `WEB_PORT=8090` (8080 = WebLog), `PORT=4102`
  (ถ้าเปลี่ยน `PORT` ต้องแก้ `frontend/nginx.conf` `proxy_pass` ให้ตรงด้วย)

## 2. ขึ้นระบบ
```bash
docker compose up -d --build
docker compose ps          # ครบ 5: postgres(healthy) backend frontend poller mediamtx
```

## 3. Verify
```bash
# เว็บ
curl -s -o /dev/null -w '%{http_code}\n' http://10.0.100.46:8080/        # 200
# API ผ่าน nginx
curl -s http://10.0.100.46:8080/api/summary
# poller ดึงกล้องได้ไหม (ไม่ควรมี error auth/timeout)
docker compose logs --tail=20 poller
# HLS กล้อง — LAN ตรง (on-demand เริ่มตอน request แรก)
curl -s -o /dev/null -w '%{http_code}\n' http://10.0.100.46:8888/left/index.m3u8   # 200
# HLS ผ่าน domain HTTPS (ถ้าตั้ง /hls แล้ว — ดูข้อ 6)
curl -s -o /dev/null -w '%{http_code}\n' https://smartcamera.aidclaos.com/hls/left/index.m3u8  # 200
# crossing log
curl -s "http://10.0.100.46:8080/api/crossings?limit=5"
```
เปิด **http://10.0.100.46:8080** → ควรเห็นกล้องสด 2 จอ + KPI + กราฟ + ตารางเข้า-ออก

## 4. ยืนยันทิศ (เทียบ OSD หน้างาน) — ทำวันลองจริง
occupancy = เข้า − ออก (clamp ≥ 0). ถ้าฝั่งไหนขึ้น 0 ตลอดทั้งที่มีคน = ทิศกลับ →
สลับ flag ฝั่งนั้นใน `.env` แล้ว `docker compose up -d poller`
- วิธีเช็ค: เดิน**เข้า** จริง 1 ครั้ง → ดูว่า KPI ฝั่งนั้น "เข้า" +1 (ไม่ใช่ "ออก")
- ปัจจุบันตั้งจากข้อมูล: `CAM_LEFT_SWAP_INOUT=1`, `CAM_RIGHT_SWAP_INOUT=0` (2 กล้องหันคนละทาง)

## 5. Checklist วันลองจริง (พรุ่งนี้)
- [ ] กล้อง 2 จอขึ้นภาพสด (ถ้าไม่ขึ้น: เช็ค `MEDIAMTX_HLS_BASE` = IP server, firewall 8888, poller log)
- [ ] KPI ขยับเองทุก ~10 วิ (auto-refresh) เมื่อมีคนเดิน
- [ ] **เดินเทสทิศ** ทั้ง 2 ประตู → ปรับ `CAM_*_SWAP_INOUT` ให้ "เข้า/ออก" ตรงจริง
- [ ] ตารางล่าง (บันทึกเข้า-ออกตามเวลา) เพิ่ม row ตอนมีคนข้าม
- [ ] occupancy ต่อโซนสมเหตุผล (ไม่ค้าง 0 / ไม่พุ่งเวอร์)
- [ ] เข้าเว็บจากเครื่องอื่นในวง LAN ได้ (`http://10.0.100.46:8080`)

## 6. Live view ผ่าน domain HTTPS (แก้ Mixed Content / ERR_CONNECTION_TIMED_OUT)

เมื่อเข้าเว็บผ่าน `https://smartcamera.aidclaos.com` แต่ live view ขึ้นผ่าน `http://10.0.100.46:8888`
ตรงๆ browser จะบล็อก 2 ชั้น: (1) **Mixed Content** (HTTP บนหน้า HTTPS) (2) **ERR_CONNECTION_TIMED_OUT**
(client นอกวงต่อ IP:8888 ไม่ได้). แก้โดยให้ HLS วิ่งผ่าน domain เดียวกันที่ path `/hls`.

**สถาปัตยกรรมที่ถูก:** `browser → (HTTPS) reverse proxy :443 → frontend nginx :8090 → mediamtx:8888`
— HLS เป็น same-origin ทั้งเส้น, **ไม่ต้องเปิด firewall 8888 ออกนอกเลย**

1. **`.env` บน server:**
   ```
   MEDIAMTX_HLS_BASE=https://smartcamera.aidclaos.com/hls
   ```
   แล้ว recreate backend (frontend รับ URL นี้ตอน runtime ผ่าน `/api/live-config`):
   ```bash
   docker compose up -d --force-recreate backend
   ```

2. **frontend nginx** — `location /hls/` มีใน `frontend/nginx.conf` แล้ว (proxy → `mediamtx:8888`,
   `proxy_buffering off` + `Cache-Control no-cache`). เนื่องจาก nginx.conf ถูก COPY เข้า image
   ตอน build ต้อง **rebuild + recreate** frontend:
   ```bash
   docker compose up -d --build frontend
   ```

3. **reverse proxy ตัวนอก** (ตัวที่ terminate HTTPS + route ทั้ง WebLog และ peoplecounter):
   - ถ้าเป็น catch-all `location / { proxy_pass http://10.0.100.46:8090; }` → **`/hls` วิ่งผ่านได้เองแล้ว ไม่ต้องแก้อะไร**
   - ถ้าเป็นแบบ per-path (แยก `location /` และ `location /api`) → เพิ่ม block นี้ใน server ของ
     `smartcamera.aidclaos.com` เท่านั้น (⚠️ **อย่าไปแตะ server block ของ `internetlog.aidclaos.com` / WebLog**):
     ```nginx
     location /hls/ {
       proxy_pass http://10.0.100.46:8090;   # → frontend nginx → mediamtx:8888
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_buffering off;
       add_header Cache-Control "no-cache" always;
     }
     ```
     reload: `nginx -t && systemctl reload nginx` (หรือ recreate container reverse proxy ตามที่ตั้งไว้)

4. **ยืนยัน:** เปิด DevTools → Network → ต้องเห็น `https://smartcamera.aidclaos.com/hls/left/index.m3u8`
   ตอบ **200** (ไม่ใช่ `http://...:8888`, ไม่มี Mixed Content warning), live view 2 จอขึ้นภาพ

> **กฎเปลี่ยน `.env` แล้วต้องทำ:** ค่าที่ backend/mediamtx อ่าน → `docker compose up -d --force-recreate <service>`
> (`up` เฉยๆ container จำค่าเก่า). เปลี่ยน `frontend/nginx.conf` → `up -d --build frontend`.

## 7. Login (shared-password JWT — กันคนนอกครบ 3 ชั้น)

เว็บกันด้วยรหัสเดียวทั้งทีม (ไม่มี multi-user). ล็อกครบ **3 ชั้น**: (1) frontend เด้ง login ถ้าไม่มี token,
(2) backend API ทุก endpoint (ยกเว้น login/logout/health/verify-stream) ต้องมี `Authorization: Bearer`,
(3) **HLS stream** — login เซ็ต JWT เป็น cookie `pc_token` → nginx `/hls/` ใช้ `auth_request` เรียก
backend `/api/verify-stream` เช็ค cookie ก่อนทุก playlist/segment → ไม่ล็อกอิน = ดูกล้องไม่ได้เลย

1. **`.env` บน server** — ตั้ง 2 ค่า (อย่า commit):
   ```
   AUTH_PASSWORD=<รหัสที่จะใช้เข้าเว็บ>
   JWT_SECRET=<openssl rand -hex 32>       # สุ่มยาว ห้ามตั้งเอง
   # AUTH_TOKEN_DAYS=7                      # (optional) อายุ token
   ```
   ถ้า `AUTH_PASSWORD`/`JWT_SECRET` ว่าง → login ปฏิเสธทุกคน (fail closed)

2. **apply:**
   ```bash
   docker compose up -d --force-recreate backend poller   # โหลดค่า auth ใหม่
   docker compose up -d --build frontend                  # nginx auth_request /hls/ + หน้า login
   ```

3. **Verify:**
   ```bash
   # login ผิด → 401
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://smartcamera.aidclaos.com/api/login \
     -H 'Content-Type: application/json' -d '{"password":"wrong"}'          # 401
   # login ถูก → 200 + token (เก็บ cookie ไว้ด้วย -c)
   curl -s -c /tmp/pc.cookie -X POST https://smartcamera.aidclaos.com/api/login \
     -H 'Content-Type: application/json' -d '{"password":"<AUTH_PASSWORD>"}' # {"token":"..."}
   # API ไม่มี token → 401
   curl -s -o /dev/null -w '%{http_code}\n' https://smartcamera.aidclaos.com/api/summary   # 401
   # HLS ไม่มี cookie → 401 (กล้องปิดสำหรับคนนอก)
   curl -s -o /dev/null -w '%{http_code}\n' https://smartcamera.aidclaos.com/hls/left/index.m3u8   # 401
   # HLS มี cookie ที่ login แล้ว → 200
   curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/pc.cookie https://smartcamera.aidclaos.com/hls/left/index.m3u8  # 200
   # health ต้องไม่ติด auth (docker healthcheck) → 200
   curl -s -o /dev/null -w '%{http_code}\n' https://smartcamera.aidclaos.com/api/health     # 200
   ```
   เปิดเว็บ → เจอหน้า login (ลาว) → ใส่รหัส → เข้า dashboard + กล้องสดขึ้น; ปุ่ม "ອອກຈາກລະບົบ" ที่ header

- **health check ไม่ติด auth** — `/api/health` เป็น public เสมอ (docker healthcheck/monitoring ไม่พัง)
- **ingest `/api/events*` ถูกล็อกด้วย JWT ด้วย** — ปัจจุบัน dormant (poller เขียน DB ตรง ไม่ผ่าน path นี้).
  ถ้าอนาคต AI Engine จะยิง `/api/events` ตรง ต้องออก service token / ingest key แยก (poller **ไม่ต้อง** token — มันต่อ DB ตรง)
- **poller ไม่กระทบ** — เป็น internal service ต่อ Postgres ตรง ไม่ผ่าน browser/JWT

## หมายเหตุ
- **ข้อมูลไม่หาย:** postgres volume `pgdata` (persist ข้าม restart). `counting_hourly` +
  `crossing_log` สะสมข้ามวัน; `occupancy_state` = วันปัจจุบัน
- **retention:** `crossing_log` โตเรื่อยๆ — ผูก cron ลบเก่า >30–90 วันภายหลังได้ (ยังไม่ทำ)
- **restart:** ทุก service `restart: unless-stopped` (ขึ้นเองหลัง reboot)
- **dev vs prod:** dev ใช้ `npm run dev` (vite, port 5174); prod ใช้ frontend service (nginx, 8080)
- **port ชนบนเครื่อง dev:** oiltruck จับ 4100 → peoplecounter ใช้ `PORT=4102` (บน server clean ปรับได้)
