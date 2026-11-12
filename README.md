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

**4 vai trò RBAC**: Quản trị viên · Quản lý kho · Nhân viên kho · Chỉ xem

---

## 🚀 Cách chạy ứng dụng & Staging

### Cách 1: Chạy toàn bộ stack bằng Docker Compose (Khuyến nghị)

Yêu cầu Docker Desktop đang chạy và Python 3.12+.

1. **Tạo cấu hình local** (không commit `.env`):

   ```powershell
   if (-not (Test-Path .env)) { Copy-Item .env.example .env }
   ```

   Sửa `POSTGRES_PASSWORD` trong `.env` thành mật khẩu local của bạn. Local development tự tạo signing key tạm thời; production phải cấu hình `AUTH_SECRET_KEY` ngẫu nhiên dài tối thiểu 32 byte.

2. **Khởi chạy PostgreSQL, backend và Vite frontend qua Docker Compose:**

   ```powershell
   docker compose up -d --build
   # Hoặc nếu dùng Docker Compose v1:
   # docker-compose up -d --build
   ```

3. **Chạy migration:**

   ```powershell
   docker compose exec backend alembic upgrade head
   ```

4. **Tạo tài khoản quản trị viên đầu tiên** (lệnh tương tác, không lưu mật khẩu trong shell history):

   ```powershell
   docker compose exec backend python -m app.create_admin --email admin@example.com --name "Quản trị viên"
   ```

   Lệnh chỉ bootstrap quản trị viên đầu tiên; mật khẩu phải dài ít nhất 6 ký tự.

5. **Seed dữ liệu mẫu (sản phẩm, tồn kho, người dùng demo):**

   ```powershell
   docker compose exec backend python app/seed_demo.py
   ```

6. **Truy cập:**
   - **Frontend**: http://localhost:5173 (proxy `/api/v1` và WebSocket tới backend)
   - **Backend API docs (Swagger)**: http://localhost:8000/docs
   - **Backend Healthcheck**: http://localhost:8000/health
   - **PostgreSQL**: `127.0.0.1:5433`

7. **Dừng staging:**

   ```powershell
   docker compose down
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
python -m pytest -q
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

| Vai trò | UUID (`X-User-ID`) | Tên | Email |
|---|---|---|---|
| Quản trị viên | `29981161-8d43-5ddf-8ca8-021b2af4fa58` | Admin Nguyễn | `admin@anphat.com` |
| Quản lý kho | `ece3f300-dc24-53c3-a911-3c23919c4fb3` | Quản lý Trần | `quanly@anphat.com` |
| Nhân viên kho | `36a45099-c617-5970-9e62-356c301a16bb` | Thủ kho Lê | `thukho@anphat.com` |
| Chỉ xem | `a8fda5f4-2c3f-599f-8e26-f02973bbf2d6` | Viewer Phạm | `viewer@anphat.com` |

---

## 🧪 Cách tái hiện KT1, KT2, KT3 bằng Postman

### Chuẩn bị Postman

1. Import collection: `docs/postman/SV4_RBAC_Tests.json` (nếu có)
2. Cấu hình biến môi trường Postman:
   - `base_url`: `http://localhost:8000/api/v1`
   - `admin_id`: `29981161-8d43-5ddf-8ca8-021b2af4fa58`
   - `manager_id`: `ece3f300-dc24-53c3-a911-3c23919c4fb3`
   - `staff_id`: `36a45099-c617-5970-9e62-356c301a16bb`
   - `viewer_id`: `a8fda5f4-2c3f-599f-8e26-f02973bbf2d6`

---

### KT1 – Kiểm thử Phân quyền RBAC (403 Forbidden)

**Mục tiêu**: Vai trò "Chỉ xem" không được tạo phiếu.

```http
POST http://localhost:8000/api/v1/documents
X-User-ID: a8fda5f4-2c3f-599f-8e26-f02973bbf2d6
Content-Type: application/json

{
  "type": "PN",
  "partner": "Test",
  "warehouseId": "<warehouse-uuid>",
  "items": [{"productId": "<product-uuid>", "quantity": 1, "unitPrice": 1000}]
}
```

**Kết quả mong đợi**: `403 Forbidden` + `{"errorCode": "FORBIDDEN"}`

---

### KT2 – Kiểm thử Idempotency (409 Conflict)

**Mục tiêu**: Gửi cùng `Idempotency-Key` hai lần → lần 2 trả 409.

```http
POST http://localhost:8000/api/v1/documents
X-User-ID: 36a45099-c617-5970-9e62-356c301a16bb
Content-Type: application/json
Idempotency-Key: test-key-unique-001

{
  "type": "PN",
  "partner": "Nhà cung cấp A",
  "warehouseId": "<warehouse-uuid>",
  "items": [{"productId": "<product-uuid>", "quantity": 10, "unitPrice": 50000}]
}
```

- **Lần 1**: `201 Created`
- **Lần 2** (cùng key): `409 Conflict` + `{"errorCode": "IDEMPOTENCY_KEY_DUPLICATE"}`

---

### KT3 – Kiểm thử Audit Log

**Mục tiêu**: Mọi hành động (kể cả 403) đều được ghi nhận vào Audit Log.

```http
GET http://localhost:8000/api/v1/audit-logs?pageSize=20
X-User-ID: 29981161-8d43-5ddf-8ca8-021b2af4fa58
```

---

## 📋 Cách đọc kết quả Audit Log

```powershell
# Lấy 20 log mới nhất
curl "http://localhost:8000/api/v1/audit-logs?pageSize=20" `
  -H "X-User-ID: 29981161-8d43-5ddf-8ca8-021b2af4fa58"

# Lọc log RBAC_DENIED
curl "http://localhost:8000/api/v1/audit-logs?q=RBAC_DENIED" `
  -H "X-User-ID: 29981161-8d43-5ddf-8ca8-021b2af4fa58"
```

---

## ✨ Tính năng hiện có

- Dashboard với KPI và biểu đồ được tính từ cùng dữ liệu sản phẩm, tồn kho và giao dịch.
- Quản lý sản phẩm, danh mục, kho, nhà cung cấp; xác thực tài khoản và phân quyền ở backend khi chạy API mode.
- Tìm kiếm, lọc, sắp xếp, phân trang ở các danh sách chính; xuất CSV sản phẩm, tồn kho, giao dịch và báo cáo.
- Lập phiếu nhập/xuất nháp; xác nhận phiếu sẽ cập nhật tồn kho và tạo lịch sử giao dịch. Phiếu xuất không thể vượt tồn tại kho.
- Điều chỉnh tồn có lý do, kiểm tra số lượng âm và ghi nhật ký.
- Tra cứu bằng barcode/SKU, báo cáo, nhật ký hoạt động, giao diện sáng/tối và khôi phục dữ liệu demo.
- Thiết kế responsive cho desktop và thiết bị di động.
- Phiếu nhập hỗ trợ kết nối camera điện thoại bằng QR trên desktop, đồng thời có camera trực tiếp trên thiết bị đang mở form. Trang tra cứu vẫn giữ QR remote riêng.

---

## 📊 Minh chứng kiểm thử & Báo cáo SV4

| File | Nội dung | Trạng thái |
|---|---|---|
| [`MC01_BienBan_KT1-KT3.md`](docs/evidence/MC01_BienBan_KT1-KT3.md) | Biên bản KT1–KT3 đầy đủ, 35/35 PASS | ✅ Done |
| [`MC02_DoiChieu_CSV_SQL.md`](docs/evidence/MC02_DoiChieu_CSV_SQL.md) | Đối chiếu tồn kho vs Ledger StockMovement: 3.000/3.000 khớp | ✅ Done |
| [`MC03_Do_Tai_Mo_Rong.md`](docs/evidence/MC03_Do_Tai_Mo_Rong.md) | Kế hoạch đo tải k6 + bảng ngoại suy năng lực | ⏳ Template sẵn |
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
│   └── alembic/versions/       # Database migrations
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
| Backend không phản hồi | `docker compose logs backend` | Xem log lỗi, restart |
| DB kết nối thất bại | `docker compose logs postgres` | Kiểm tra `.env` (`POSTGRES_PASSWORD`) |
| Port 8000 bị chiếm | `netstat -ano \| findstr :8000` | Kill tiến trình đang giữ cổng |
| Migration lỗi | `docker compose exec backend alembic upgrade head` | Chạy lại migration |

Xem chi tiết trong [`docs/evidence/runbook-mat-mang.md`](docs/evidence/runbook-mat-mang.md).
