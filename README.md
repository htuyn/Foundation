# Smart Warehouse – Foundation

> **Dự án môn học** | Nhóm phát triển Smart Warehouse  
> **Nhánh ổn định**: `main` | **Nhánh SV4**: `feature/sv4-staging-rbac-testing`

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

## 🚀 Cách chạy Backend + PostgreSQL + Frontend

### Yêu cầu

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) đã cài và đang chạy
- File `.env` đã cấu hình (xem mẫu bên dưới)

### Tạo file `.env`

```env
POSTGRES_PASSWORD=changeme123
POSTGRES_DB=warehouse_db
POSTGRES_USER=warehouse_user
POSTGRES_PORT=5433
BACKEND_PORT=8000
APP_ENV=development
```

### Khởi động

```powershell
# Vào thư mục dự án
cd C:\Users\long\OneDrive\Desktop\CNNT\Foundation

# Khởi động toàn bộ stack (Backend + DB + Frontend)
docker-compose up -d

# Chờ khoảng 15 giây rồi kiểm tra
Start-Sleep -Seconds 15
docker-compose ps

# Kiểm tra sức khỏe backend
curl http://localhost:8000/health
```

**Kết quả mong đợi:**
```json
{"status": "ok"}
```

**Truy cập:**
- Frontend: http://localhost:5173
- Backend API docs: http://localhost:8000/docs
- Backend health: http://localhost:8000/health

### Dừng staging

```powershell
docker-compose down
```

---

## 🌱 Cách seed dữ liệu mẫu

```powershell
# Chạy script seed (cần backend đang chạy)
docker-compose exec backend python app/seed_demo.py
```

**Dữ liệu được tạo:**

| Vai trò | UUID | Tên |
|---|---|---|
| Quản trị viên | `29981161-8d43-5ddf-8ca8-021b2af4fa58` | Admin |
| Quản lý kho | `ece3f300-dc24-53c3-a911-3c23919c4fb3` | Nguyễn Quản Lý |
| Nhân viên kho | `36a45099-c617-5970-9e62-356c301a16bb` | Trần Nhân Viên |
| Chỉ xem | `a8fda5f4-2c3f-599f-8e26-f02973bbf2d6` | Lê Chỉ Xem |

---

## 🧪 Cách tái hiện KT1, KT2, KT3 bằng Postman

### Chuẩn bị Postman

1. Import collection: `docs/postman/SV4_RBAC_Tests.json` (nếu có)
2. Tạo biến môi trường Postman:
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

**Mục tiêu**: Mọi hành động (kể cả 403) đều được ghi vào Audit Log.

```http
# Lấy Audit Log (cần quyền xem)
GET http://localhost:8000/api/v1/audit-logs?pageSize=20
X-User-ID: 29981161-8d43-5ddf-8ca8-021b2af4fa58
```

**Kết quả mong đợi**: Danh sách log có entry ghi nhận thao tác vừa thực hiện.

---

## 📋 Cách đọc kết quả Audit Log

```powershell
# Lấy 20 log mới nhất
curl "http://localhost:8000/api/v1/audit-logs?pageSize=20" `
  -H "X-User-ID: 29981161-8d43-5ddf-8ca8-021b2af4fa58"
```

**Cấu trúc một entry:**

```json
{
  "id": "uuid",
  "message": "RBAC_DENIED: role=viewer action=POST /api/v1/documents",
  "actorName": "Lê Chỉ Xem",
  "createdAt": "2026-11-11T14:30:00.000Z"
}
```

**Lọc theo từ khóa:**

```powershell
# Lọc log RBAC_DENIED
curl "http://localhost:8000/api/v1/audit-logs?q=RBAC_DENIED" `
  -H "X-User-ID: 29981161-8d43-5ddf-8ca8-021b2af4fa58"

# Lọc log tạo phiếu
curl "http://localhost:8000/api/v1/audit-logs?q=PN" `
  -H "X-User-ID: 29981161-8d43-5ddf-8ca8-021b2af4fa58"
```

---

## 📁 Cấu trúc thư mục

```
Foundation/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/
│   │   │   ├── documents.py    # POST /documents (idempotency)
│   │   │   ├── resources.py    # inventory, users, warehouses...
│   │   │   └── scanner.py      # Scanner session endpoints
│   │   ├── core/
│   │   │   └── rbac.py         # RBAC middleware 4 vai trò
│   │   └── seed_demo.py        # Seed dữ liệu mẫu
│   └── alembic/versions/       # Database migrations
├── docs/
│   └── evidence/
│       ├── MC01_BienBan_KT1-KT3.md    ✅ Done
│       ├── MC02_DoiChieu_CSV_SQL.md   ✅ Done
│       ├── MC03_Do_Tai_Mo_Rong.md     ✅ Done
│       └── runbook-mat-mang.md        ✅ Done
├── scripts/
│   ├── k6_load_test.js         # Script đo tải k6
│   ├── check_inventory.py      # Script đối chiếu tồn kho
│   ├── backup_postgres.sh      # Backup DB
│   └── restore_postgres.sh     # Restore DB
└── docker-compose.yml
```

---

## 🔧 Troubleshooting

| Vấn đề | Lệnh kiểm tra | Giải pháp |
|---|---|---|
| Backend không phản hồi | `docker-compose logs backend` | Xem log lỗi, restart |
| DB kết nối thất bại | `docker-compose logs postgres` | Kiểm tra `.env` |
| Port 8000 bị chiếm | `netstat -ano \| findstr :8000` | Kill tiến trình |
| Migration lỗi | `docker-compose exec backend alembic upgrade head` | Chạy lại migration |

Xem chi tiết: [`docs/evidence/runbook-mat-mang.md`](docs/evidence/runbook-mat-mang.md)

---

## 📊 Minh chứng kiểm thử

| File | Nội dung | Trạng thái |
|---|---|---|
| [`MC01_BienBan_KT1-KT3.md`](docs/evidence/MC01_BienBan_KT1-KT3.md) | Biên bản KT1–KT3 đầy đủ, 35/35 PASS | ✅ Done |
| [`MC02_DoiChieu_CSV_SQL.md`](docs/evidence/MC02_DoiChieu_CSV_SQL.md) | Bảng đối chiếu tồn kho | ✅ Ready |
| [`MC03_Do_Tai_Mo_Rong.md`](docs/evidence/MC03_Do_Tai_Mo_Rong.md) | Số liệu k6 + bảng ngoại suy | ✅ Ready |
| [`runbook-mat-mang.md`](docs/evidence/runbook-mat-mang.md) | Hướng dẫn khôi phục khi mạng đứt | ✅ Done |
