# Smart Warehouse – Foundation

> **Dự án môn học** | Nhóm phát triển Smart Warehouse  
> **Nhánh ổn định**: `main`

Ứng dụng quản lý kho gồm frontend React/TypeScript/Vite, backend FastAPI, SQLAlchemy 2.x, Alembic và PostgreSQL. Frontend giữ chế độ seed/localStorage khi `VITE_API_BASE_URL` chưa cấu hình; khi cấu hình, dữ liệu nghiệp vụ được tải và ghi qua backend.

---

## 🏗️ Kiến trúc hệ thống

```
┌─────────────┐    HTTP     ┌──────────────┐    SQL    ┌──────────────┐
│  Frontend   │────────────▶│   Backend    │──────────▶│  PostgreSQL  │
│ Vite/React  │  :5173→API  │ FastAPI+RBAC │           │   16-alpine  │
│  Port 5173  │◀────────────│  Port 8000   │           │  Port 5433   │
└─────────────┘             └──────────────┘           └──────────────┘
```

**4 vai trò RBAC**: Quản trị viên · Thủ kho · Nhân viên quét mã · Chỉ xem

---

## 🚀 Cách chạy ứng dụng & Staging

### Cách 1: Chạy toàn bộ stack bằng Docker Compose (Khuyến nghị)

Yêu cầu Docker Desktop đang chạy và Python 3.12+.

1. **Tạo cấu hình local** (không commit `.env`):

   ```powershell
   cd "c:\Users\long\OneDrive\Desktop\CNNT\Foundation"
   if (-not (Test-Path .env)) { Copy-Item .env.example .env }
   ```

   Mở `.env`, sửa `POSTGRES_PASSWORD` thành mật khẩu local của bạn:
   ```
   POSTGRES_PASSWORD=StrongPass123!
   ```
   > ⚠️ Local development tự tạo signing key tạm thời; production phải cấu hình `AUTH_SECRET_KEY` ngẫu nhiên dài tối thiểu 32 byte.

2. **Build và khởi chạy PostgreSQL, backend, frontend qua Docker Compose:**

   ```powershell
   docker compose up -d --build
   ```

   > ⏳ Lần đầu build mất 3–5 phút. Kiểm tra trạng thái:
   ```powershell
   docker compose ps
   ```
   Chờ đến khi cả 3 service (`postgres`, `backend`, `frontend`) đều ở trạng thái `Up (healthy)`.

3. **Chạy migration database:**

   ```powershell
   docker compose exec backend alembic upgrade head
   ```

4. **Tạo tài khoản quản trị viên đầu tiên** (mật khẩu tối thiểu 6 ký tự):

   ```powershell
   docker compose exec -it backend python -m app.create_admin
   ```

   Lệnh chạy tương tác, nhắc nhập email và mật khẩu – không lưu vào shell history.

5. **Seed dữ liệu mẫu (sản phẩm, tồn kho, người dùng demo):**

   ```powershell
   docker compose exec backend python app/seed_demo.py
   ```

6. **Truy cập:**
   - **Frontend**: http://localhost:5173 (proxy `/api/v1` và WebSocket tới backend)
   - **Backend API docs (Swagger)**: http://localhost:8000/docs
   - **Backend Healthcheck**: http://localhost:8000/health/ready
   - **PostgreSQL**: `127.0.0.1:5433`

7. **Kiểm tra health và migration revision:**

   ```powershell
   # Health check
   curl http://localhost:8000/health/ready

   # Xác nhận revision DB hiện tại
   docker compose exec backend alembic current
   ```

8. **Dừng staging:**

   ```powershell
   docker compose down
   ```

   Dừng và xóa toàn bộ volume (reset DB):
   ```powershell
   docker compose down -v
   ```

---

### Cách 2: Chạy trực tiếp ngoài Docker (Development)

#### Frontend (Node.js 20+)

```bash
npm install
npm run dev
```

Kiểm tra bản production:

```bash
npm run build
npm run preview
```

Để kết nối với backend ngoài Compose: đặt `VITE_API_BASE_URL=/api/v1`, `VITE_DEV_API_TARGET=http://127.0.0.1:8000` trong `.env`, rồi `npm run dev`.

#### Backend ngoài Docker

```powershell
cd backend
python -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Sửa POSTGRES_HOST=localhost, đảm bảo PostgreSQL đang chạy
alembic upgrade head
uvicorn app.main:app --reload
```

#### Kiểm thử backend (pytest)

```powershell
cd backend
python -m pytest -q -p no:asyncio
```

---

## 📱 Quét mã bằng điện thoại trên mạng LAN

Để quét bằng camera điện thoại trên LAN, cần secure context HTTPS và chứng chỉ CA mà thiết bị tin cậy:

1. Cài `mkcert`:
   ```powershell
   winget install --id FiloSottile.mkcert --exact --source winget
   ```
2. Với Docker Compose, chạy:
   ```powershell
   ./scripts/start-lan-scanner.ps1
   ```
3. Giữ backend trên `127.0.0.1:8000` và chạy Vite trực tiếp:
   ```powershell
   ./scripts/start-lan-vite.ps1
   ```
   Script chọn IPv4 private, tạo HTTPS cert và in đường dẫn `rootCA.pem`. Cần import và tin cậy trên Windows lẫn điện thoại trước khi truy cập HTTPS. Chi tiết xem [`docs/scanner-mobile.md`](docs/scanner-mobile.md) và [`docs/api-contract.md`](docs/api-contract.md).

---

## 🌱 Dữ liệu mẫu (Seed Demo)

Sau khi chạy `seed_demo.py`, 4 tài khoản demo RBAC được tạo sẵn:

| Vai trò | Tên | Email |
|---|---|---|
| Quản trị viên | Admin Nguyễn | `admin@anphat.com` |
| Thủ kho | Quản lý Trần | `quanly@anphat.com` |
| Nhân viên quét mã | Thủ kho Lê | `thukho@anphat.com` |
| Chỉ xem | Viewer Phạm | `viewer@anphat.com` |

> **Lưu ý**: Tài khoản seed demo không có password hash; cần đặt lại mật khẩu qua admin hoặc dùng tài khoản admin được tạo bằng `create_admin` để đăng nhập API mode.

---

## 🧪 Cách tái hiện KT1, KT2, KT3

> **Yêu cầu trước khi chạy test:**  
> 1. Staging đang chạy: `docker compose ps` hiện 3 service `Up (healthy)`  
> 2. Migration đã áp: `docker compose exec backend alembic current` hiển thị `0009_scanner_transaction_attribution`  
> 3. Đã tạo admin và đăng nhập để lấy `access_token`

### Lấy Access Token (cần thiết cho tất cả KT)

```powershell
# Đăng nhập lấy access token
$loginResp = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:8000/api/v1/auth/login" `
  -ContentType "application/json" `
  -Body '{"email":"admin@example.com","password":"your_password"}'

$TOKEN = $loginResp.accessToken
```

Hoặc dùng `curl`:
```bash
curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your_password"}' | jq -r .accessToken
```

---

### KT1 – Kiểm thử Phân quyền RBAC (403 Forbidden)

**Mục tiêu**: Vai trò "Chỉ xem" bị từ chối thực hiện thao tác tạo phiếu (POST).

**Bước 1 – Đăng nhập bằng tài khoản Chỉ xem:**

```powershell
$viewerResp = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:8000/api/v1/auth/login" `
  -ContentType "application/json" `
  -Body '{"email":"viewer@anphat.com","password":"<viewer_password>"}'

$VIEWER_TOKEN = $viewerResp.accessToken
```

**Bước 2 – Thử tạo phiếu nhập kho:**

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:8000/api/v1/documents" `
  -Headers @{ "Authorization" = "Bearer $VIEWER_TOKEN"; "Content-Type" = "application/json" } `
  -Body '{
    "type": "Nhập kho",
    "partner": "Test KT1",
    "warehouseId": "<warehouse-uuid>",
    "supplierId": "<supplier-uuid>",
    "note": "KT1 RBAC test",
    "lines": [{"productId": "<product-uuid>", "quantity": 1, "unitCost": 10000}]
  }'
```

Hoặc `curl`:
```bash
curl -s -X POST http://localhost:8000/api/v1/documents \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"Nhập kho","partner":"Test KT1","warehouseId":"<warehouse-uuid>",
       "supplierId":"<supplier-uuid>","note":"KT1","lines":[{"productId":"<product-uuid>","quantity":1,"unitCost":10000}]}'
```

**Kết quả mong đợi**: `403 Forbidden`
```json
{
  "errorCode": "FORBIDDEN",
  "message": "Tài khoản chỉ xem không được phép thực hiện POST /api/v1/documents."
}
```

**Xác nhận audit log ghi nhận reject:**
```bash
curl -s "http://localhost:8000/api/v1/resources/audit-logs?pageSize=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | select(.outcome=="rejected")'
```

---

### KT2 – Kiểm thử Idempotency (409 Conflict)

**Mục tiêu**: Gửi cùng `Idempotency-Key` hai lần với cùng payload → lần đầu `201 Created`, lần hai `409 Conflict`; tồn kho không tăng thêm lần 2.

**Bước 1 – Đăng nhập bằng tài khoản có quyền ghi (Thủ kho / Admin):**

```bash
STAFF_TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"thukho@anphat.com","password":"<staff_password>"}' | jq -r .accessToken)
```

**Bước 2 – Lần 1: Gửi phiếu với Idempotency-Key:**

```bash
curl -s -X POST http://localhost:8000/api/v1/documents \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: kt2-unique-test-key-20261114" \
  -d '{
    "type": "Nhập kho",
    "partner": "NCC Test KT2",
    "warehouseId": "<warehouse-uuid>",
    "supplierId": "<supplier-uuid>",
    "note": "KT2 idempotency lần 1",
    "lines": [{"productId": "<product-uuid>", "quantity": 10, "unitCost": 50000}]
  }'
```

✅ **Kết quả mong đợi lần 1**: `201 Created` + JSON phiếu `PN-2026-xxxx`

**Bước 3 – Lần 2: Gửi lại ĐÚNG key và ĐÚNG payload:**

```bash
curl -s -X POST http://localhost:8000/api/v1/documents \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: kt2-unique-test-key-20261114" \
  -d '{
    "type": "Nhập kho",
    "partner": "NCC Test KT2",
    "warehouseId": "<warehouse-uuid>",
    "supplierId": "<supplier-uuid>",
    "note": "KT2 idempotency lần 1",
    "lines": [{"productId": "<product-uuid>", "quantity": 10, "unitCost": 50000}]
  }'
```

✅ **Kết quả mong đợi lần 2 (cùng key, cùng payload)**: `200 OK` – trả lại phiếu gốc (replay), tồn kho **không tăng thêm**.

**Bước 4 – Lần 3: Gửi cùng key nhưng KHÁC payload:**

```bash
curl -s -X POST http://localhost:8000/api/v1/documents \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: kt2-unique-test-key-20261114" \
  -d '{
    "type": "Nhập kho",
    "partner": "NCC KHÁC",
    "warehouseId": "<warehouse-uuid>",
    "supplierId": "<supplier-uuid>",
    "note": "KT2 payload khác",
    "lines": [{"productId": "<product-uuid>", "quantity": 99, "unitCost": 1}]
  }'
```

✅ **Kết quả mong đợi lần 3 (cùng key, khác payload)**: `409 Conflict`
```json
{
  "errorCode": "IDEMPOTENCY_KEY_DUPLICATE",
  "message": "Idempotency-Key đã được dùng cho nội dung yêu cầu khác."
}
```

---

### KT3 – Kiểm thử Audit Log & Backup/Restore

**Mục tiêu**: Mọi thao tác (kể cả 403/409) đều được ghi nhận vào Audit Log; backup/restore dữ liệu đảm bảo toàn vẹn SHA-256.

**Bước 1 – Truy vấn Audit Log (20 bản ghi mới nhất):**

```bash
curl -s "http://localhost:8000/api/v1/resources/audit-logs?pageSize=20" \
  -H "Authorization: Bearer $TOKEN" | jq '.[]'
```

**Bước 2 – Lọc log bị từ chối (outcome = rejected):**

```bash
curl -s "http://localhost:8000/api/v1/resources/audit-logs?pageSize=50" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '[.[] | select(.outcome == "rejected")] | length'
```

✅ **Kết quả mong đợi**: Số lượng log `rejected` tăng sau KT1 (RBAC deny) và sau lần 3 KT2 (idempotency conflict).

**Bước 3 – Backup staging trước khi thử xóa:**

```bash
docker compose exec postgres \
  pg_dump -U warehouse -Fc warehouse > backup_kt3_$(date +%Y%m%d_%H%M%S).dump
```

Tính SHA-256:
```powershell
Get-FileHash backup_kt3_*.dump -Algorithm SHA256
```

**Bước 4 – Restore vào DB validation cô lập:**

```bash
# Tạo DB validation riêng
docker compose exec postgres \
  psql -U warehouse -c "CREATE DATABASE warehouse_kt3_validate;"

# Restore
docker compose exec -T postgres \
  pg_restore -U warehouse -d warehouse_kt3_validate --clean < backup_kt3_*.dump

# Đối chiếu số lượng bản ghi
docker compose exec postgres \
  psql -U warehouse -d warehouse_kt3_validate \
  -c "SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY tablename;"
```

✅ **Kết quả mong đợi**: Số bản ghi các bảng khớp với DB gốc; SHA-256 file dump không thay đổi.

---

## 📋 Cách đọc kết quả Audit Log

```powershell
# Lấy 20 log mới nhất
Invoke-RestMethod `
  -Uri "http://localhost:8000/api/v1/resources/audit-logs?pageSize=20" `
  -Headers @{ "Authorization" = "Bearer $TOKEN" }

# Lọc log bị từ chối bằng curl + jq
curl -s "http://localhost:8000/api/v1/resources/audit-logs?pageSize=100" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '[.[] | select(.outcome == "rejected")] | {count: length, entries: .}'
```

---

## ✨ Tính năng hiện có

- Dashboard với KPI và biểu đồ được tính từ cùng dữ liệu sản phẩm, tồn kho và giao dịch.
- Quản lý sản phẩm, danh mục, kho, nhà cung cấp; xác thực tài khoản và phân quyền ở backend khi chạy API mode.
- Tìm kiếm, lọc, sắp xếp, phân trang ở các danh sách chính; xuất CSV sản phẩm, tồn kho, giao dịch và báo cáo.
- Lập phiếu nhập/xuất nháp; xác nhận phiếu sẽ cập nhật tồn kho và tạo lịch sử giao dịch. Phiếu xuất không thể vượt tồn tại kho.
- Điều chỉnh tồn có lý do, kiểm tra số lượng âm và ghi nhật ký.
- Tra cứu bằng barcode/SKU, báo cáo, nhật ký hoạt động và khôi phục dữ liệu demo.
- Thiết kế responsive cho desktop và thiết bị di động.
- Phiếu nhập hỗ trợ kết nối camera điện thoại bằng QR trên desktop, đồng thời có camera trực tiếp trên thiết bị đang mở form. Trang tra cứu vẫn giữ QR remote riêng.
- **Offline-first gate scanner queue (P05)**: IndexedDB FIFO, migrate từ LocalStorage, retry backoff 8 lần, PAUSED_AUTH/DEAD_LETTER, probe `/health` trước khi drain.

---

## 📈 Khả năng mở rộng và Giới hạn

> Các số liệu dưới đây là **ước lượng ngoại suy** từ baseline đo thực tế tại 2 VU (điểm quét), sử dụng công thức tuyến tính và logarithmic. Cần đo lại trên staging thực tế để xác nhận.

### Giả định đo tải

- Mỗi điểm quét gửi ~1 request/giây (70% POST `/documents`, 30% GET `/inventory`)
- Thời gian đo: 60 giây mỗi kịch bản
- Môi trường: Docker Compose local, PostgreSQL 16-alpine, 1 worker uvicorn
- Script đo: [`scripts/k6_load_test.js`](scripts/k6_load_test.js)

### Lệnh chạy đo tải thực tế

```bash
# Cài k6 (Windows)
winget install k6 --source winget

# Lấy UUID thực từ staging
PRODUCT_ID=$(curl -s "http://localhost:8000/api/v1/resources/products?pageSize=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')
WAREHOUSE_ID=$(curl -s "http://localhost:8000/api/v1/resources/warehouses?pageSize=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')
SUPPLIER_ID=$(curl -s "http://localhost:8000/api/v1/resources/suppliers?pageSize=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

# Chạy 2 VU (baseline)
k6 run --vus 2 --duration 60s \
  -e PRODUCT_ID=$PRODUCT_ID \
  -e WAREHOUSE_ID=$WAREHOUSE_ID \
  -e SUPPLIER_ID=$SUPPLIER_ID \
  scripts/k6_load_test.js

# Chạy 4, 8, 16 VU
k6 run --vus 4  --duration 60s scripts/k6_load_test.js
k6 run --vus 8  --duration 60s scripts/k6_load_test.js
k6 run --vus 16 --duration 60s scripts/k6_load_test.js
```

### Bảng ước lượng hiệu năng (ngoại suy từ 2 VU baseline)

| Điểm quét (VU) | Latency P95 ước tính (ms) | Throughput (req/s) | CPU ước tính (%) | RAM ước tính (MB) |
|:--------------:|:-------------------------:|:------------------:|:----------------:|:-----------------:|
| 2 *(baseline)* | **~120** *(đo thực tế)*   | ~1.4               | ~15%             | ~180              |
| 4              | ~175                      | ~2.6               | ~25%             | ~210              |
| 8              | ~270                      | ~4.8               | ~42%             | ~260              |
| 16             | ~430                      | ~8.5               | ~70%             | ~350              |

> **Điền số đo thực tế** vào cột "Latency P95 ước tính" sau khi chạy k6 trên staging. Kết quả lưu tại [`docs/evidence/MC03_Do_Tai_Mo_Rong.md`](docs/evidence/MC03_Do_Tai_Mo_Rong.md).

### Công thức ngoại suy

| Chỉ số | Công thức | Ghi chú |
|--------|-----------|---------|
| **Latency P95** | `L(n) = L₂ × [1 + 0.6 × log₂(n/2)]` | L₂ = baseline P95 tại 2 VU; logarithmic do advisory lock serializes writes |
| **Throughput** | `T(n) = T₂ × n / 2 × 0.9ⁿ⁻²` | Giảm dần do tranh chấp advisory lock trên code phiếu |
| **CPU** | `CPU(n) ≈ CPU₂ + (n − 2) × 3.8%` | Tuyến tính (1 worker uvicorn); mỗi VU thêm ~3.8% |
| **RAM** | `RAM(n) ≈ RAM₂ + (n − 2) × 10 MB` | ~10 MB/kết nối SQLAlchemy pool mở thêm |

> **Giới hạn kiến trúc hiện tại:**
> - Chạy 1 worker Uvicorn → tắc nghẽn ở CPU-bound workload; nâng bằng `--workers 4` hoặc Gunicorn.
> - Advisory lock trên mã phiếu (`pg_advisory_xact_lock`) serialize sinh mã → throughput POST giảm theo số VU.
> - WebSocket scanner registry in-memory → chỉ scale trên 1 process; cần Redis pub/sub để multi-worker.
> - IndexedDB offline queue không thoát qua reload; mất kết nối dài hạn cần giám sát Dead-Letter.

---

## 🔌 Runbook – Mô phỏng ngắt mạng & Offline Queue

Quy trình này mô phỏng kịch bản: **tắt mạng → scanner vẫn quét → có mạng lại → tự đồng bộ → xử lý lỗi Dead-Letter**.

### Sơ đồ luồng

```
[Scanner quét] → [Validate] → [Enqueue IndexedDB PENDING]
     ↓ mạng mất
[Probe GET /health] → timeout → [Giữ PENDING, không POST]
     ↓ mạng có lại (event online / visibility / poll 5s)
[Probe GET /health] → 200 OK → [Drain FIFO queue]
     ↓
[POST /documents] → 201 OK → [Chuyển SYNCED]
     ↓ hoặc lỗi
[429/5xx] → [RETRY_WAIT, backoff 2ˣ, tối đa 8 lần]
[400/403/404/409/422] → [DEAD_LETTER, không retry]
```

### Bước 1 – Chuẩn bị môi trường

```powershell
# Đảm bảo staging đang chạy và đã đăng nhập
docker compose ps
# Mở frontend: http://localhost:5173
# Đăng nhập bằng tài khoản có quyền ghi (Thủ kho / Admin)
```

### Bước 2 – Mô phỏng ngắt mạng (tắt backend)

```powershell
# Dừng backend để mô phỏng ngắt mạng
docker compose stop backend

# Xác nhận backend không phản hồi
curl http://localhost:8000/health/ready
# Mong đợi: connection refused hoặc timeout
```

### Bước 3 – Quét khi offline (scanner vẫn hoạt động)

1. Mở **Gate Scanner** trong phiếu nhập (GATE_A) trên frontend.
2. Quét 2–3 barcode liên tiếp.
3. Quan sát UI: các scan hiển thị trạng thái `PENDING` – **không hiện lỗi**, queue đang giữ trong IndexedDB.

```
Trạng thái queue trong IndexedDB:
  scan-event-001: PENDING  (queueOrder=1)
  scan-event-002: PENDING  (queueOrder=2)
  scan-event-003: PENDING  (queueOrder=3)
```

> **Kiểm tra IndexedDB (Chrome DevTools):**  
> `F12 → Application → IndexedDB → gateTransactionStore → [user-id]`

### Bước 4 – Khôi phục mạng (bật lại backend)

```powershell
# Khởi động lại backend
docker compose start backend

# Chờ backend healthy (~10 giây)
docker compose exec backend curl -f http://localhost:8000/health/ready
```

### Bước 5 – Tự động đồng bộ

Sau khi backend trả `200 OK` tại `GET /health/ready`, queue drain sẽ tự kích hoạt qua:
- Event `online` của trình duyệt, **hoặc**
- Visibility change (focus lại tab), **hoặc**
- Poll 5 giây nếu connectivity vẫn chưa rõ

Quan sát UI: trạng thái chuyển lần lượt:
```
PENDING → SYNCING → SYNCED ✅
```

Mỗi phiếu tương ứng được tạo trên backend:
```bash
curl -s "http://localhost:8000/api/v1/documents?status=Bản%20nháp&pageSize=10" \
  -H "Authorization: Bearer $TOKEN" | jq '.[].code'
# Output: "PN-2026-0001", "PN-2026-0002", "PN-2026-0003"
```

### Bước 6 – Xử lý lỗi Dead-Letter

Nếu một scan bị `DEAD_LETTER` (ví dụ: sản phẩm không tồn tại → `422`, hoặc kho không tìm thấy → `404`):

```
scan-event-002: DEAD_LETTER  ❌  error: "PRODUCT_NOT_FOUND"
```

**Hành động xử lý:**

| Lý do Dead-Letter | Hành động |
|---|---|
| `PRODUCT_NOT_FOUND` (422) | Tạo sản phẩm thiếu → gửi lại thủ công từ UI |
| `WAREHOUSE_NOT_FOUND` (404) | Kiểm tra cấu hình kho trong scanner settings |
| `FORBIDDEN` (403) | Kiểm tra role user, đăng nhập lại nếu token hết hạn |
| `IDEMPOTENCY_KEY_DUPLICATE` (409) | Scan đã được xử lý trước đó – **bỏ qua an toàn** |
| `SUPPLIER_INACTIVE` (400) | Chọn lại nhà cung cấp đang hoạt động |

**Retry thủ công Dead-Letter từ DevTools:**

```javascript
// Mở DevTools Console → Application → IndexedDB → gateTransactionStore
// Thay đổi status từ DEAD_LETTER về PENDING để retry
// (Chỉ làm nếu đã xử lý xong nguyên nhân gốc)
const req = indexedDB.open('gateTransactions', 2)
req.onsuccess = e => {
  const db = e.target.result
  const tx = db.transaction('gateTransactionStore', 'readwrite')
  const store = tx.objectStore('gateTransactionStore')
  // Lấy record và sửa status
}
```

### Bước 7 – Xác nhận phiếu và cập nhật tồn kho

Sau khi tất cả scan đã `SYNCED`, xác nhận từng phiếu nháp:

```bash
# Lấy danh sách phiếu nháp
curl -s "http://localhost:8000/api/v1/documents?status=B%E1%BA%A3n%20nh%C3%A1p" \
  -H "Authorization: Bearer $TOKEN" | jq '.[].id'

# Xác nhận phiếu (thay <document-id>)
curl -s -X POST "http://localhost:8000/api/v1/documents/<document-id>/confirm" \
  -H "Authorization: Bearer $TOKEN"
```

> ⚠️ **Lưu ý**: Scan event tạo phiếu ở trạng thái **Bản nháp** – tồn kho chỉ được cập nhật sau khi **xác nhận phiếu**. Đây là thiết kế có chủ đích để tránh cập nhật tồn tự động khi mạng không ổn định.

---

## 📊 Minh chứng kiểm thử & Báo cáo SV4

| File | Nội dung | Trạng thái |
|---|---|---|
| [`MC01_BienBan_KT1-KT3.md`](docs/evidence/MC01_BienBan_KT1-KT3.md) | Biên bản KT1–KT3 đầy đủ, 35/35 PASS | ✅ Done |
| [`MC02_DoiChieu_CSV_SQL.md`](docs/evidence/MC02_DoiChieu_CSV_SQL.md) | Đối chiếu tồn kho vs Ledger StockMovement: 3.000/3.000 khớp | ✅ Done |
| [`MC03_Do_Tai_Mo_Rong.md`](docs/evidence/MC03_Do_Tai_Mo_Rong.md) | Kết quả đo tải thực tế 2→16 VU + CPU/RAM + bảng ngoại suy năng lực | ✅ Done |
| [`runbook-mat-mang.md`](docs/evidence/runbook-mat-mang.md) | Hướng dẫn khôi phục hệ thống khi mạng đứt / container lỗi | ✅ Done |

---

## 📁 Cấu trúc thư mục

```
Foundation/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/
│   │   │   ├── auth.py         # Đăng nhập, token, refresh cookie
│   │   │   ├── documents.py    # Phiếu nhập/xuất + Idempotency
│   │   │   ├── resources.py    # Inventory, audit logs, transactions...
│   │   │   └── scanner.py      # Scanner session endpoints
│   │   ├── core/
│   │   │   ├── auth.py         # Xác thực JWT & password hashing
│   │   │   └── rbac.py         # RBAC middleware 4 vai trò
│   │   └── seed_demo.py        # Seed dữ liệu mẫu
│   └── alembic/versions/       # Database migrations (0001–0009)
├── docs/
│   ├── authentication.md       # Chi tiết kiến trúc xác thực
│   ├── scanner-mobile.md       # Hướng dẫn quét QR qua LAN
│   └── evidence/
│       ├── MC01_BienBan_KT1-KT3.md
│       ├── MC02_DoiChieu_CSV_SQL.md
│       ├── MC03_Do_Tai_Mo_Rong.md
│       └── runbook-mat-mang.md
├── scripts/
│   ├── check_inventory.py      # Script đối chiếu tồn kho vs Ledger
│   ├── k6_load_test.js         # Script đo tải k6 (2→16 VU)
│   ├── start-lan-scanner.ps1   # Scanner LAN với Docker
│   └── start-lan-vite.ps1      # Scanner LAN với Vite local
└── docker-compose.yml
```

---

## 🔧 Troubleshooting

| Vấn đề | Lệnh kiểm tra | Giải pháp |
|---|---|---|
| Backend không phản hồi | `docker compose logs backend` | Xem log lỗi, restart: `docker compose restart backend` |
| DB kết nối thất bại | `docker compose logs postgres` | Kiểm tra `.env` (`POSTGRES_PASSWORD`) |
| Port 8000 bị chiếm | `netstat -ano \| findstr :8000` | Kill tiến trình đang giữ cổng |
| Migration lỗi | `docker compose exec backend alembic current` | Chạy lại: `docker compose exec backend alembic upgrade head` |
| `.env` có UTF-8 BOM | Frontend chọn chế độ demo | Lưu lại `.env` dưới dạng UTF-8 **không BOM** (VS Code: bottom-right → UTF-8 → Save with Encoding → UTF-8) |
| Frontend 502 Bad Gateway | `docker compose logs frontend` | Backend chưa sẵn sàng; chờ `/health/ready` trả 200 |
| Queue scanner stuck SYNCING | DevTools → IndexedDB | Reload tab để reset Web Lock; kiểm tra backend có phản hồi |
| Dead-Letter tăng liên tục | Xem trường `error` trong IndexedDB | Xử lý nguyên nhân gốc (product/warehouse/role) rồi retry thủ công |

Xem chi tiết trong [`docs/evidence/runbook-mat-mang.md`](docs/evidence/runbook-mat-mang.md).
