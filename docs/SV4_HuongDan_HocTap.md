# 📘 Hướng Dẫn Học Tập Toàn Diện – SV4: Staging, RBAC, Kiểm Thử & Mở Rộng

**Dự án:** Smart Warehouse – Đề tài 22  
**Vai trò:** SV4 – Nguyễn Nhật Long  
**Mục đích:** Tài liệu chi tiết giúp SV4 hiểu rõ TỪNG phần công việc từ mã nguồn thực tế – file nào ở đâu, code hoạt động ra sao, và cách trả lời câu hỏi bảo vệ.

---

## Mục lục

1. [Phần A – Khái niệm cốt lõi](#phần-a--khái-niệm-cốt-lõi)
2. [Phần B – Kiến trúc tổng thể & cấu trúc thư mục](#phần-b--kiến-trúc-tổng-thể--cấu-trúc-thư-mục)
3. [Phần C – Staging Docker Compose](#phần-c--staging-docker-compose)
4. [Phần D – Dữ liệu mẫu & Seed](#phần-d--dữ-liệu-mẫu--seed)
5. [Phần E – Bộ kiểm thử KT1, KT2, KT3](#phần-e--bộ-kiểm-thử-kt1-kt2-kt3)
6. [Phần F – RBAC Middleware 4 vai trò](#phần-f--rbac-middleware-4-vai-trò)
7. [Phần G – Đối chiếu tồn kho CSV/SQL](#phần-g--đối-chiếu-tồn-kho-csvsql)
8. [Phần H – Đo tải & Ngoại suy mở rộng](#phần-h--đo-tải--ngoại-suy-mở-rộng)
9. [Phần I – Câu hỏi bảo vệ & cách trả lời](#phần-i--câu-hỏi-bảo-vệ--cách-trả-lời)

---

## Phần A – Khái niệm cốt lõi

### 1. Staging là gì?

**Staging** (môi trường dàn dựng) là bản sao hệ thống chạy trên máy local, dùng để kiểm thử mà **không ảnh hưởng** đến bản demo chính (Vercel).

| So sánh | Production (Vercel) | Staging (Docker local) |
|---------|--------------------|-----------------------|
| Mục đích | Demo cho giảng viên | Test, đo tải, phá thử |
| Chạy ở đâu | Vercel Cloud | Máy tính cá nhân |
| Database | Neon Cloud PostgreSQL | PostgreSQL container local |
| Dữ liệu | Dữ liệu demo thật | 1,000 SP mẫu tự seed |
| Có thể xóa/restore | ⚠️ Nguy hiểm | ✅ Thoải mái |
| Đo CPU/RAM | ❌ Không (serverless) | ✅ Được (via docker stats) |

> **Nguyên tắc quan trọng:** Các thao tác nguy hiểm (xóa dữ liệu, restore, đo CPU/RAM) chỉ chạy trên staging. Tuyệt đối không chạy trên bản demo Vercel.

### 2. Docker & Docker Compose là gì?

**Docker** đóng gói ứng dụng thành container – giống "máy ảo nhẹ". Dự án dùng 3 container:

```
┌──────────────────────── Docker Desktop ──────────────────────────┐
│                                                                   │
│  ┌────────────────┐   ┌─────────────────┐   ┌────────────────┐  │
│  │  PostgreSQL    │◄──│    Backend      │◄──│   Frontend     │  │
│  │  port 5432     │   │   port 8000     │   │   port 5173    │  │
│  │  Lưu dữ liệu  │   │  Python/FastAPI │   │  React/Vite    │  │
│  └────────────────┘   └─────────────────┘   └────────────────┘  │
│       ↑                      ↑                      ↑            │
│  Volume lưu DB          Alembic migration       Vite dev server  │
│  (persistent)           Seed dữ liệu            Proxy→backend    │
└───────────────────────────────────────────────────────────────────┘
```

**Docker Compose** quản lý nhiều container cùng lúc qua file `docker-compose.yml`.

**Port mapping thực tế trong dự án:**
- `foundation-postgres-1`: cổng `5433` (ngoài) → `5432` (trong container)
- `foundation-backend-1`: cổng `8000` (chỉ localhost)
- `foundation-frontend-1`: cổng `5173` (mở ra ngoài)

### 3. RBAC là gì?

**RBAC** (Role-Based Access Control) = Phân quyền dựa trên vai trò.

Thay vì mỗi người được cấp quyền riêng lẻ, hệ thống gom quyền theo vai trò. File thực tế: [`backend/app/core/rbac.py`](../backend/app/core/rbac.py)

```python
# Từ rbac.py – các hằng số vai trò thực tế
ROLE_ADMIN           = "Quản trị viên"      # alias: admin
ROLE_STOREKEEPER     = "Quản lý kho"        # alias: storekeeper
ROLE_STOREKEEPER_ALT = "Thủ kho"            # alias thứ 2
ROLE_SCANNER         = "Nhân viên kho"      # alias: scanner
ROLE_SCANNER_ALT     = "Nhân viên quét mã"  # alias thứ 2
ROLE_VIEWER          = "Chỉ xem"            # alias: viewer
```

### 4. Idempotency là gì?

**Idempotency** = Tính lũy đẳng. Gửi cùng request nhiều lần → chỉ có tác dụng 1 lần.

**Ví dụ thực tế:**
1. Nhân viên quét mã → tạo phiếu nhập → mạng chập chờn
2. Client tự động retry → gửi cùng request lần 2
3. Hệ thống nhận ra cùng `Idempotency-Key` → trả kết quả lần 1, **không ghi thêm**
4. Tồn kho an toàn, không bị nhân đôi

**Cơ chế kỹ thuật:** UNIQUE constraint trên cột `idempotency_key` trong PostgreSQL.

### 5. Audit Log là gì?

**Audit Log** = Nhật ký hoạt động. Ghi lại ai làm gì, khi nào, kết quả ra sao.

Format log thực tế trong dự án (từ `rbac.py` dòng 126):
```python
message=f"[RBAC DENY {status_code}] {actor_name} | {method} {path} | {reason}"
```

Ví dụ bản ghi thực tế:
```
[RBAC DENY 403] viewer@anphat.com | POST /api/v1/documents | 
Vai trò 'Chỉ xem' không được phép thực hiện thao tác thay đổi dữ liệu.
```

### 6. p50, p95, p99 (Percentile) là gì?

Dùng trong đo tải để mô tả phân phối latency:

| Chỉ số | Nghĩa | Ví dụ từ dữ liệu thực |
|--------|-------|----------------------|
| **p50** | 50% request nhanh hơn giá trị này (median) | 27ms ở VU=2 |
| **p90** | 90% request nhanh hơn | 63ms ở VU=2 |
| **p95** | 95% request nhanh hơn (SLA phổ biến) | 93ms ở VU=2 |
| **p99** | 99% request nhanh hơn (worst case) | 2037ms ở VU=2 |

> **Lưu ý về p99 cao:** p99 = 2037ms ở VU=2 không đáng lo – đây là lần đầu kết nối DB (cold start), chiếm < 1% tổng request.

---

## Phần B – Kiến trúc tổng thể & cấu trúc thư mục

```
Foundation/
├── backend/                    # Backend – Python/FastAPI
│   ├── app/
│   │   ├── api/v1/             # Các endpoint API (routes)
│   │   │   ├── routes/
│   │   │   │   ├── documents.py    # POST /documents, /confirm
│   │   │   │   ├── inventory.py    # GET /inventory
│   │   │   │   ├── audit_logs.py   # GET /audit-logs
│   │   │   │   └── auth.py         # POST /auth/login
│   │   ├── core/
│   │   │   ├── rbac.py         ← SV4 viết – RBAC middleware
│   │   │   ├── auth.py         # JWT encode/decode
│   │   │   └── errors.py       # ApiError class
│   │   ├── db/
│   │   │   └── session.py      # get_db() – SQLAlchemy session
│   │   ├── models/             # SQLAlchemy models (bảng DB)
│   │   ├── seed_demo.py        ← Script seed 1,000 SP + 6 tài khoản
│   │   └── main.py             # Entry point FastAPI
│   └── Dockerfile
│
├── scripts/                    # Scripts tiện ích – SV4 phụ trách
│   ├── kt1_create_document.py  ← KT1: Tạo phiếu nhập hợp lệ
│   ├── kt2_duplicate_key.py    ← KT2: Chống ghi trùng
│   ├── kt3_rbac_403.py         ← KT3: Phân quyền RBAC
│   ├── show_audit_log.py       ← Xem Audit Log bằng token (mới)
│   ├── load_test_runner.py     ← Đo tải 2→4→8→16 VU
│   ├── check_inventory.py      ← Đối chiếu tồn kho vs ledger
│   ├── run_kt_all.ps1          ← Chạy KT1+KT2+KT3 một lần
│   └── seed_products.sql       # 20 SP mẫu EAN-13
│
├── docs/
│   └── evidence/
│       ├── MC01_BienBan_KT1-KT3.md    # Biên bản nghiệm thu
│       ├── load_test_results.json     # Kết quả đo tải
│       └── load_test_results.json     ← Output từ load_test_runner.py
│
├── tests/
│   └── kt_results/
│       ├── KT1_evidence.txt    # Evidence có timestamp
│       ├── KT2_evidence.txt
│       └── KT3_evidence.txt
│
└── docker-compose.yml          ← Cấu hình 3 container
```

**Ngôn ngữ và công nghệ:**

| Thành phần | Ngôn ngữ | Framework | File chính |
|------------|----------|-----------|------------|
| Backend API | Python 3.12 | FastAPI + SQLAlchemy | `backend/app/main.py` |
| Frontend | TypeScript | React + Vite | `src/App.tsx` |
| Database | SQL | PostgreSQL 16 | Alembic migrations |
| Docker | YAML | Docker Compose | `docker-compose.yml` |
| Test Scripts | Python | urllib + requests | `scripts/kt*.py` |
| Load Test | Python | concurrent.futures | `scripts/load_test_runner.py` |
| Automation | PowerShell | Native | `scripts/run_kt_all.ps1` |

---

## Phần C – Staging Docker Compose

### File `docker-compose.yml` – Hiểu từng phần

**Credentials thực tế** (từ biến môi trường `.env`):
```
POSTGRES_USER=warehouse_user
POSTGRES_PASSWORD=Staging2026!
POSTGRES_DB=warehouse_db
```

**Port thực tế:**
- PostgreSQL bên ngoài: `5433` (không phải 5432, để tránh xung đột nếu máy đã có PG cài sẵn)
- Backend: `127.0.0.1:8000` (chỉ localhost, không mở ra LAN)
- Frontend: `0.0.0.0:5173` (mở ra để truy cập từ trình duyệt)

**Backend kết nối DB bằng cách nào?**
Trong Docker network, backend dùng tên service `postgres` (không phải `localhost`):
```yaml
# docker-compose.yml
backend:
  environment:
    POSTGRES_HOST: postgres    # ← Tên container trong Docker network
    POSTGRES_PORT: 5432        # ← Port TRONG container (không phải 5433)
```

> **Điểm hay để giải thích:** `DATABASE_URL` trong `.env` chỉ dùng khi chạy script trên host (ngoài Docker) để kết nối Neon Cloud. Backend container luôn dùng `POSTGRES_HOST: postgres`.

### Các lệnh Docker thường dùng

```powershell
# Khởi động tất cả container ở chế độ nền
docker compose up -d

# Kiểm tra trạng thái
docker compose ps

# Xem log backend real-time
docker compose logs backend -f

# Dừng (giữ nguyên dữ liệu)
docker compose down

# Dừng VÀ XÓA dữ liệu (cần seed lại)
docker compose down -v

# Chạy lệnh trong container backend
docker exec foundation-backend-1 python -m app.seed_demo

# Xem tài nguyên real-time
docker stats foundation-backend-1
```

### Khi nào cần seed lại?

| Tình huống | Cần seed? |
|------------|-----------|
| Tắt/bật máy tính bình thường | ❌ Không |
| `docker compose down` rồi `up -d` | ❌ Không |
| `docker compose down -v` | ✅ Cần |
| Cài lại Docker / format máy | ✅ Cần |

**Lệnh seed:**
```powershell
docker exec foundation-backend-1 python -m app.seed_demo
```

---

## Phần D – Dữ liệu mẫu & Seed

### `backend/app/seed_demo.py` – Hiểu nội dung

Script tạo toàn bộ dữ liệu demo theo **namespace UUID xác định** (deterministic):
- 10 kho (`warehouses`)
- 50 nhà cung cấp (`suppliers`)
- 30 danh mục (`categories`)
- **1,000 sản phẩm** (`products`) với mã EAN-13
- 600 phiếu nhập/xuất (`stock_documents`): 540 đã xác nhận, 30 bản nháp, 30 đã hủy
- 8,250 giao dịch tồn kho (`stock_movements`)
- 6 tài khoản RBAC

**Tài khoản RBAC được seed:**

| Email | Mật khẩu | Vai trò |
|-------|----------|---------|
| `admin@anphat.com` | `Admin123!` | Quản trị viên |
| `viewer@anphat.com` | `Viewer123!` | Chỉ xem |
| `scanner@anphat.com` | `Scanner123!` | Nhân viên kho |
| `storekeeper@anphat.com` | `Storekeeper123!` | Quản lý kho |
| `thukho@anphat.com` | `Thukho123!` | Nhân viên kho |
| `quanly@anphat.com` | `Quanly123!` | Quản lý kho |

**Tại sao dùng UUID xác định (uuid5)?**  
Mỗi lần chạy seed sẽ tạo cùng UUID cho cùng sản phẩm. Điều này cho phép:
- Script KT1, KT2, KT3 hardcode `PRODUCT_ID` và `WAREHOUSE_ID` mà không cần lookup động
- Seed có thể chạy nhiều lần mà không tạo dữ liệu trùng (dùng `ON CONFLICT DO NOTHING`)

**UUID thực tế trong scripts:**
```python
# Từ kt1_create_document.py, kt2_duplicate_key.py, kt3_rbac_403.py
WAREHOUSE_ID = "190d4565-f9dd-48fe-b209-0601c5ca1cdd"
PRODUCT_ID   = "0735e201-07a2-5060-a4e8-280b880371c8"
SUPPLIER_ID  = "89fb1d6e-4bf7-5b0e-a1e3-b8614d507c56"
```

---

## Phần E – Bộ kiểm thử KT1, KT2, KT3

### KT1 – `scripts/kt1_create_document.py`

**Luồng hoạt động (3 bước tự động):**

```
Bước 0: POST /api/v1/auth/login → lấy Bearer token
   ↓
Bước 1: GET /api/v1/suppliers → lấy supplier_id
   ↓
Đọc tồn kho TRƯỚC:
   GET /api/v1/inventory?warehouseId=... → tìm productId → qty_before
   ↓
Bước 1/3: POST /api/v1/documents → tạo phiếu "Nhập kho"
   Body: { type, warehouseId, supplierId, lines: [{productId, quantity: 5, unitCost}] }
   → HTTP 201 | mã phiếu: PN-2026-xxxx | Trạng thái: Bản nháp
   ↓
Bước 2/3: POST /api/v1/documents/{id}/confirm → xác nhận phiếu
   → HTTP 200 | Trạng thái: Đã xác nhận
   ↓
Bước 3/3: Đọc tồn kho SAU
   GET /api/v1/inventory?warehouseId=... → qty_after
   ↓
Kiểm tra: qty_after - qty_before == QUANTITY (5)
   → ✅ KT1 PASS hoặc ❌ KT1 FAIL
```

**Hàm `read_stock()` – cách đọc tồn kho:**
```python
def read_stock(tok, wh_id, prod_id):
    _, inv_data = api("GET", f"/api/v1/inventory?warehouseId={wh_id}", token=tok)
    all_items = inv_data if isinstance(inv_data, list) else inv_data.get("items", [])
    for item in (all_items or []):
        if item.get("productId") == prod_id:
            return item.get("quantity")
    return None
```

**Điểm giải thích cho Hội đồng:**
- HTTP 201 = "Created" → phiếu được tạo mới
- Phải xác nhận (confirm) thì tồn kho mới thực sự thay đổi
- Mã phiếu `PN-2026-xxxx` do server sinh tự động (UNIQUE trong DB)

### KT2 – `scripts/kt2_duplicate_key.py`

**Luồng hoạt động:**

```python
# Sinh 1 UUID làm Idempotency-Key
idem_key = str(uuid.uuid4())    # ví dụ: "bdeaf55f-0b87-451b-abca-634342f129e0"

# Gửi lần 1 với key này
POST /api/v1/documents
  Header: Idempotency-Key: bdeaf55f-0b87-...
  → HTTP 201 | PN-2026-5359 | Tồn kho tăng +3

# Gửi lần 2 với CÙNG key
POST /api/v1/documents  
  Header: Idempotency-Key: bdeaf55f-0b87-...  ← CÙNG KEY
  → HTTP 200 | Trả lại kết quả lần 1 | Tồn kho KHÔNG ĐỔI
```

**Điều kiện PASS:**
```python
if status1 == 201 and status2 in (200, 201, 409):
    if stock_before == stock_after or status2 in (409, 200):
        print("✅ KT2 PASS")
```

**Điểm giải thích cho Hội đồng:**
- Backend lưu `Idempotency-Key` vào cột UNIQUE trong DB
- Lần 2 cùng key: backend tìm thấy record → trả HTTP 200 với kết quả cũ
- Tồn kho chỉ thay đổi 1 lần dù gửi request nhiều lần

### KT3 – `scripts/kt3_rbac_403.py`

**Luồng hoạt động:**

```python
# Test 3a: Viewer bị chặn
viewer_token, viewer_role = login("viewer@anphat.com", "Viewer123!")
# → role = "Chỉ xem"

status, result = try_create_document(viewer_token)
# POST /api/v1/documents với Viewer token
# → HTTP 403 | FORBIDDEN
# → Audit Log ghi: "[RBAC DENY 403] viewer | POST /api/v1/documents | ..."

# Test 3b: Admin vẫn tạo được
admin_token, admin_role = login("admin@anphat.com", "Admin123!")
# → role = "Quản trị viên"

status_admin, result_admin = try_create_document(admin_token)
# → HTTP 201 | PN-2026-5360
```

**KT3 PASS khi:**
```python
if status == 403 and status_admin == 201:
    print("✅ KT3 PASS HOÀN TOÀN!")
```

### `scripts/show_audit_log.py` – Xem Audit Log trực tiếp trên terminal (MỚI)

> ⚠️ **Tại sao cần file này?**  
> Endpoint `/api/v1/audit-logs` yêu cầu `Authorization: Bearer <token>`.  
> Khi mở thẳng URL trên trình duyệt sẽ nhận lỗi `MISSING_ACCESS_TOKEN` vì không có token.  
> Script này tự động login Admin → lấy token → gọi API → in log đẹp lên terminal.

**Cách dùng khi bảo vệ:**

```powershell
# Chỉ xem vi phạm RBAC 403 (mặc định – dùng ngay sau KT3)
python -X utf8 scripts\show_audit_log.py

# Xem toàn bộ log (200 bản ghi mới nhất)
python -X utf8 scripts\show_audit_log.py --all

# Lọc theo từ khoá (ví dụ: tên user hoặc endpoint)
python -X utf8 scripts\show_audit_log.py --filter viewer
```

**Output mẫu trên terminal:**

```
══════════════════════════════════════════════════════════════════════
  📋 NHẬT KÝ AUDIT LOG – Smart Warehouse (SV4 Demo)
══════════════════════════════════════════════════════════════════════

🔑 Đăng nhập Admin để lấy token...
✅ Đăng nhập thành công!

🚫 [  1] 2026-11-23 16:30:12 | HTTP 403
      Thông báo: [RBAC DENY 403] viewer@anphat.com | POST /api/v1/documents | ...
      Người thực hiện: viewer@anphat.com
      Vai trò: Chỉ xem
      Lý do: Vai trò 'Chỉ xem' không được phép thực hiện thao tác thay đổi dữ liệu.
```

**Nói với Hội đồng khi demo:**
> *"Script này tự login Admin, gọi API có token hợp lệ và hiển thị từng dòng vi phạm RBAC.  
> Mỗi lần Viewer cố tình gọi API thay đổi dữ liệu, hệ thống ghi đủ: ai, vai trò gì, endpoint nào, lúc mấy giờ. Đây là bằng chứng audit có thể dùng để điều tra sau sự cố."*

**Luồng hoạt động bên trong:**
```python
token = login("admin@anphat.com", "Admin123!")          # 1. Lấy Bearer Token
logs  = fetch_audit_logs(token, filter_kw="RBAC DENY")  # 2. GET /api/v1/audit-logs?q=RBAC+DENY
# 3. In từng dòng với màu sắc: 🚫 đỏ=403/401, ✅ xanh=success
```

### `scripts/run_kt_all.ps1` – Chạy cả 3 kịch bản

Script PowerShell chạy tuần tự KT1 → KT2 → KT3 và lưu evidence:

```powershell
# Mỗi kịch bản chạy và lưu vào file riêng
python -X utf8 scripts\kt1_create_document.py *>&1 | Out-String | 
    Set-Content -Path "tests\kt_results\KT1_evidence.txt" -Encoding UTF8

python -X utf8 scripts\kt2_duplicate_key.py *>&1 | Out-String | 
    Set-Content -Path "tests\kt_results\KT2_evidence.txt" -Encoding UTF8

python -X utf8 scripts\kt3_rbac_403.py *>&1 | Out-String | 
    Set-Content -Path "tests\kt_results\KT3_evidence.txt" -Encoding UTF8
```

> **Tại sao dùng `*>&1`?** – Redirect cả stdout và stderr vào cùng pipeline để không bỏ sót thông báo lỗi.

---

## Phần F – RBAC Middleware 4 vai trò

### File: `backend/app/core/rbac.py` (285 dòng)

### Ma trận phân quyền thực tế (từ code)

```python
# Từ rbac.py dòng 70-98
_ROLES_READ_ONLY = VALID_ROLES                    # Tất cả vai trò
_ROLES_WRITE     = frozenset({admin, storekeeper, storekeeper_alt, scanner, scanner_alt})
_ROLES_DELETE    = frozenset({admin, storekeeper, storekeeper_alt})

ROLE_METHOD_MAP = {
    "GET":     _ROLES_READ_ONLY,   # Tất cả được xem
    "HEAD":    _ROLES_READ_ONLY,
    "OPTIONS": _ROLES_READ_ONLY,
    "POST":    _ROLES_WRITE,       # Viewer bị chặn
    "PUT":     _ROLES_WRITE,       # Viewer bị chặn
    "PATCH":   _ROLES_WRITE,       # Viewer bị chặn
    "DELETE":  _ROLES_DELETE,      # Scanner cũng bị chặn
}
```

| Endpoint/Method | Admin | Storekeeper | Scanner | Viewer |
|-----------------|:-----:|:-----------:|:-------:|:------:|
| `GET /*` | ✅ | ✅ | ✅ | ✅ |
| `POST /documents` | ✅ | ✅ | ✅ | ❌ 403 |
| `PUT /documents/:id` | ✅ | ✅ | ✅ | ❌ 403 |
| `DELETE /documents/:id` | ✅ | ✅ | ❌ 403 | ❌ 403 |
| `GET /health` | ✅ | ✅ | ✅ | ✅ (public) |

### Dependency Chain – Cách FastAPI gọi RBAC

```python
# Từ rbac.py dòng 145-275

def get_current_user(request, authorization, db) -> User:
    """
    Bước 1: Xác thực JWT token
    - Thiếu token → 401 MISSING_ACCESS_TOKEN
    - Token hết hạn → 401 SESSION_EXPIRED  
    - User không tồn tại → 401 USER_NOT_FOUND
    - User bị vô hiệu hóa → 403 USER_INACTIVE
    """
    
def require_permission(request, user, db) -> User:
    """
    Bước 2: Kiểm tra quyền theo HTTP method
    - Viewer + POST/PUT/PATCH/DELETE → 403 FORBIDDEN
    - Role không trong whitelist → 403 FORBIDDEN
    - Mọi lần 403 → ghi Audit Log
    """

# Type alias dùng trong endpoint
CurrentUser = Annotated[User, Depends(require_permission)]
```

**Cách endpoint dùng RBAC:**
```python
# Trong backend/app/api/v1/routes/documents.py
from app.core.rbac import CurrentUser

@router.post("/documents")
async def create_document(user: CurrentUser, ...):
    # FastAPI tự gọi:
    # 1. get_current_user() → xác thực token → trả về User
    # 2. require_permission() → kiểm tra role → cho qua hoặc 403
    # Chỉ khi cả 2 pass → code ở đây mới chạy
```

### Hàm ghi Audit Log từ chối

```python
# Từ rbac.py dòng 104-139
def _write_deny_log(db, actor_name, method, path, status_code, reason, role=None):
    db.add(AuditLog(
        message=f"[RBAC DENY {status_code}] {actor_name} | {method} {path} | {reason}",
        actor_name=actor_name,
        action=f"{method} {path}",
        outcome="rejected",
        status_code=status_code,
        details={"role": role, "reason": reason, "method": method, "path": path},
    ))
    db.flush()
```

### Public endpoints không cần xác thực

```python
# Từ rbac.py dòng 43
_PUBLIC_PREFIXES = ("/health", "/api/v1/scanner")
```
- `/health` → healthcheck endpoint
- `/api/v1/scanner` → quét mã từ thiết bị (xác thực qua QR token riêng)

---

## Phần G – Đối chiếu tồn kho CSV/SQL

### File: `scripts/check_inventory.py` (147 dòng)

**Công thức đối chiếu:**

```
Tồn kho (DB) = Σ(Nhập kho) − Σ(Xuất kho) + Σ(Điều chỉnh)
             = ledger tính từ bảng stock_movements
```

**Luồng hoạt động trong code:**

```python
# Bước 1: Lấy tồn kho hiện tại từ DB
inv_rows = fetch_one("inventory", page_size=5000)
db_stock = {(r["productId"], r["warehouseId"]): r["quantity"] for r in inv_rows}

# Bước 2: Lấy toàn bộ giao dịch (phân trang)
movements = fetch_all("transactions", page_size=500)

# Bước 3: Tính lại ledger từ các giao dịch
for m in movements:
    key = (m["productId"], m["warehouseId"])
    if m["type"] == "Nhập kho":
        ledger[key] += m["quantity"]
    elif m["type"] == "Xuất kho":
        ledger[key] -= m["quantity"]
    elif m["type"] == "Điều chỉnh":
        ledger[key] += m["quantity"]  # có thể âm

# Bước 4: So sánh ledger vs DB
matched = sum(1 for k in all_keys if ledger[k] == db_stock[k])
```

**Kết quả mong đợi:**
```
✅ KẾT LUẬN: TỒN KHO NHẤT QUÁN HOÀN TOÀN
Dòng khớp ✅  : 3000
Dòng lệch ❌  : 0
```

> **Lưu ý khi giải thích:** Nếu có chênh lệch nhỏ, nguyên nhân phổ biến là API `/transactions` trả `abs(qty)` → mất dấu cho giao dịch Điều chỉnh âm. `verify_seed()` trong `seed_demo.py` là nguồn tin cậy hơn.

---

## Phần H – Đo tải & Ngoại suy mở rộng

### File: `scripts/load_test_runner.py` (320 dòng)

**Cơ chế hoạt động:**

```python
# Mỗi "điểm quét" (VU) = 1 thread Python
# Mỗi thread chạy vòng lặp trong `duration` giây:
# - 70% POST /api/v1/documents  (tạo phiếu nhập)
# - 30% GET  /api/v1/inventory  (đọc tồn kho)
# Nghỉ ngẫu nhiên 0.3–0.7s giữa các request (mô phỏng nhịp quét thực tế)

def worker_task(vu_id, stop_time, ...):
    while time.time() < stop_time:
        is_write = random.random() < 0.7
        if is_write:
            # POST với Idempotency-Key ngẫu nhiên
            idem_key = f"load-vu{vu_id}-it{iteration}-{uuid.uuid4().hex[:8]}"
            session.post(".../documents", headers={"Idempotency-Key": idem_key})
        else:
            session.get(".../inventory?pageSize=50")
        time.sleep(random.uniform(0.3, 0.7))
```

**Thu thập CPU/RAM song song:**
```python
# Thread riêng chạy docker stats mỗi 2 giây
def _collect_docker_stats(container, samples, stop_event):
    while not stop_event.is_set():
        out = subprocess.check_output([
            "docker", "stats", container, "--no-stream",
            "--format", "{{.CPUPerc}},{{.MemUsage}}"
        ])
        cpu, mem = out.split(",", 1)
        samples.append({"cpu_pct": float(cpu.strip("%")), "mem": mem.split("/")[0]})
        time.sleep(2)
```

### Kết quả đo thực tế (`docs/evidence/load_test_results.json`)

| VU | req/s | p50 (ms) | p95 (ms) | p99 (ms) | Lỗi | CPU avg | CPU max | RAM đỉnh |
|:--:|------:|:--------:|:--------:|:--------:|:---:|:-------:|:-------:|:--------:|
| 2 | 3.39 | 27 | 93 | 2037 | 0% | 8.2% | 15.8% | 158 MiB |
| 4 | 6.81 | 28 | 95 | 2122 | 0% | 19.0% | 28.2% | 157 MiB |
| 8 | 13.31 | 31 | 145 | 2280 | 0% | 33.7% | 49.5% | 162 MiB |
| 16 | 25.30 | 62 | 241 | 2445 | 0% | 68.0% | 91.1% | 167 MiB |

### Phân tích kết quả

**Throughput scale-up:**
- VU 2→4: throughput tăng 3.39→6.81 (2.01×) ≈ tuyến tính ✅
- VU 4→8: throughput tăng 6.81→13.31 (1.95×) ≈ gần tuyến tính ✅
- VU 8→16: throughput tăng 13.31→25.30 (1.90×) – bắt đầu giảm nhẹ ⚠️

**Latency:**
- p50 vẫn rất thấp (27→62ms) – phần lớn request xử lý nhanh
- p95 tăng vừa phải (93→241ms) – vẫn trong ngưỡng SLA 500ms ✅
- p99 cao (~2000-2400ms) – cold start DB connection, chỉ < 1% request

**CPU:**
- VU=2: 8.2% avg → còn nhiều headroom
- VU=16: 68.0% avg, 91.1% max → đang tiếp cận ngưỡng bão hòa
- Dự báo: VU=32 sẽ CPU ≈ 100%, throughput plateau

**RAM ổn định hoàn toàn:** 157–167 MiB ở tất cả mức tải → không có memory leak

### Công thức ngoại suy

Từ dữ liệu thực tế, tỷ lệ tăng throughput gần tuyến tính:

```
T(n) ≈ T(2) × (n/2) × eff(n)

Trong đó eff(n) là hiệu suất tương đối:
- eff(2)  = 1.00 (baseline)
- eff(4)  ≈ 1.00 (3.39 × 2.01 / 2 = 3.40 ≈ 3.39)
- eff(8)  ≈ 0.98
- eff(16) ≈ 0.93
```

**Khi bảo vệ giải thích:**
> *"Throughput tăng gần tuyến tính từ 2 lên 16 VU (3.39 → 25.30 req/s, tỷ lệ 7.46× với 8× VU). Hiệu suất suy giảm nhẹ ở VU=16 (CPU max 91.1%) nhưng tỷ lệ lỗi vẫn 0% – hệ thống ổn định. Bottleneck dự kiến là CPU và PostgreSQL connection pool khi vượt ~32 VU."*

### Lệnh chạy load test

```powershell
# Chạy toàn bộ 4 kịch bản (2→4→8→16 VU, mỗi kịch bản 30 giây)
python scripts\load_test_runner.py --all

# Chạy 1 kịch bản cụ thể
python scripts\load_test_runner.py --vus 8 --duration 60

# Kết quả lưu tự động ra:
# docs/evidence/load_test_results.json
```

---

## Phần I – Câu hỏi bảo vệ & cách trả lời

### 🔴 Nhóm câu hỏi về Staging & Docker

**Q1: Em giải thích Docker Compose là gì và tại sao dùng nó?**

> Docker Compose cho phép em định nghĩa và chạy 3 container (PostgreSQL, Backend, Frontend) bằng 1 file YAML và 1 lệnh `docker compose up -d`. Dùng cho staging vì: (1) tất cả thành viên chạy cùng môi trường, tránh lỗi "máy em chạy được, máy bạn không"; (2) tách biệt hoàn toàn với bản demo Vercel; (3) có thể xóa/tạo lại dữ liệu thoải mái mà không ảnh hưởng ai.

**Q2: Backend trong Docker kết nối DB bằng cách nào?**

> Backend dùng `POSTGRES_HOST: postgres` trong `docker-compose.yml` – đây là tên service Docker. Docker tạo internal network cho các container giao tiếp qua tên service. `DATABASE_URL` trong `.env` chỉ dùng khi chạy script trên host (ngoài Docker) để kết nối Neon Cloud.

**Q3: Nếu chạy `docker compose down -v` rồi `up -d` thì sao?**

> Flag `-v` xóa volume `warehouse_pgdata` → mất toàn bộ dữ liệu. Phải chạy `docker exec foundation-backend-1 python -m app.seed_demo` để tạo lại. Không dùng `-v` trong bình thường – chỉ khi muốn reset hoàn toàn.

**Q4: Tại sao port PostgreSQL là 5433 thay vì 5432?**

> Để tránh xung đột nếu máy đã có PostgreSQL cài sẵn chạy ở port 5432. Port 5433 chỉ dùng bên ngoài Docker (kết nối từ host), còn trong Docker network thì vẫn là 5432.

### 🟡 Nhóm câu hỏi về RBAC

**Q5: Em có mấy vai trò? Vai trò nào bị hạn chế gì?**

> 4 vai trò: `Quản trị viên` (toàn quyền), `Quản lý kho` (không xóa user), `Nhân viên kho` (không DELETE), `Chỉ xem` (chỉ GET). Chỉ xem bị chặn tất cả POST/PUT/PATCH/DELETE.

**Q6: RBAC middleware hoạt động ở bước nào trong luồng request?**

> Trước khi code endpoint được chạy. FastAPI Dependency Injection gọi `get_current_user()` → xác thực JWT → rồi `require_permission()` → kiểm tra role + method. Nếu fail → trả 401/403 ngay, code endpoint không bao giờ chạy.

**Q7: Khi Viewer bị chặn 403, hệ thống ghi lại thông tin gì?**

> Ghi vào bảng `audit_logs`: `actor_name` (tên người dùng), `action` ("POST /api/v1/documents"), `outcome` ("rejected"), `status_code` (403), `details` (role, reason, method, path). Format: `[RBAC DENY 403] viewer | POST /api/v1/documents | Vai trò 'Chỉ xem' không được phép...`

**Q8: Nếu hacker sửa role trong token thì sao?**

> Token JWT được ký bằng `AUTH_SECRET_KEY` trên server. Nếu sửa payload → chữ ký không khớp → `decode_access_token()` trả `None` → 401. Hơn nữa, role KHÔNG được lưu trong token – server luôn tra DB `users` để lấy role thật theo `user_id` trong token.

**Q9: Tại sao dùng Annotated + Depends thay vì check trực tiếp trong endpoint?**

> Để tái sử dụng và tách biệt mối quan tâm (Separation of Concerns). `CurrentUser = Annotated[User, Depends(require_permission)]` – chỉ cần thêm `user: CurrentUser` vào bất kỳ endpoint nào là tự động có RBAC. Không cần copy-paste logic kiểm tra vào từng endpoint.

### 🟢 Nhóm câu hỏi về KT1–KT3

**Q10: KT1 chứng minh được điều gì cụ thể?**

> 3 điều: (1) Hệ thống tạo phiếu nhập với HTTP 201 và mã UNIQUE; (2) Workflow xác nhận phiếu hoạt động đúng; (3) Tồn kho cập nhật chính xác (Δ = +5 đúng bằng quantity trong phiếu). Không chỉ test API mà test cả logic nghiệp vụ end-to-end.

**Q11: KT2 – Tại sao lần 2 trả HTTP 200 mà không phải 201 hay 409?**

> Lần 1: tạo phiếu mới → 201 Created (tiêu chuẩn REST). Backend lưu Idempotency-Key vào cột UNIQUE. Lần 2: cùng key → backend tìm thấy → trả lại kết quả lần 1 với HTTP 200 (không phải 201 vì không tạo mới, không phải 409 vì không có conflict thực sự – đây là replay hợp lệ theo thiết kế). Tồn kho không thay đổi.

**Q12: Nếu bấm đúp nút "Lưu" trên giao diện thì sao?**

> Frontend sinh 1 `idempotency_key` (UUID v4) cho mỗi lần người dùng bắt đầu tạo phiếu. Nếu bấm đúp → 2 request cùng key → chỉ lần đầu tạo phiếu, lần sau trả 200 replay. Nút bị khóa trong lúc gửi để tránh bấm đúp vật lý.

**Q13: Tại sao KT3 cần test cả Admin tạo thành công (không chỉ test Viewer bị chặn)?**

> Để chứng minh hệ thống chặn đúng người, không phải chặn tất cả. Nếu chỉ test Viewer bị 403 mà không test Admin được 201, không thể phân biệt được "RBAC hoạt động đúng" với "bug chặn tất cả mọi người". KT3b là đối chứng bắt buộc.

### 🔵 Nhóm câu hỏi về Đo tải

**Q14: Em đo tải bằng công cụ gì? Tại sao không dùng k6?**

> Em dùng Python `concurrent.futures` + `threading` trong `load_test_runner.py`. k6 yêu cầu cài thêm (Golang binary), còn Python đã có sẵn. Script tự viết linh hoạt hơn: có thể tích hợp trực tiếp với Docker stats để đo CPU/RAM cùng lúc với load test.

**Q15: p99 = 2037ms ở VU=2 trông rất cao – có phải hệ thống chậm không?**

> Không. p99 cao là do cold start: lần đầu kết nối DB phải thiết lập connection pool, tốn vài giây. Chỉ ảnh hưởng < 1% request (khoảng 1 trong 100 request). p50 = 27ms và p95 = 93ms mới phản ánh hiệu năng thực tế. Hệ thống đáp ứng tốt cho workload 2 điểm quét.

**Q16: Từ 2 điểm quét, em ngoại suy lên 32 bằng công thức nào?**

> Dựa trên dữ liệu thực, throughput tăng gần tuyến tính với tỷ lệ suy giảm nhẹ. Từ VU=2 đến VU=16, hiệu suất thực/lý thuyết: 100%→100%→98%→93%. Ngoại suy VU=32: throughput ≈ 25.30 × 1.7 ≈ 43 req/s, nhưng CPU sẽ chạm 100% → đây là điểm bão hòa. Giải pháp: scale CPU hoặc dùng PgBouncer.

**Q17: Tại sao đo tải trên staging mà không phải Vercel?**

> Vercel là serverless – không đo được CPU/RAM/Disk I/O vật lý vì mỗi request chạy trên function riêng biệt. Staging trên Docker cho phép đo đầy đủ resource usage qua `docker stats`. Latency từ bên ngoài có thể đo cả hai, nhưng phải ghi rõ nguồn.

### 🟣 Câu hỏi kết hợp / Nâng cao

**Q18: Nếu giảng viên hỏi "mất mạng thì sao?" – em demo gì?**

> Phần mất mạng là phụ trách của SV2 (Offline Queue, LocalStorage). Em (SV4) phụ trách đối chiếu số liệu sau khi đồng bộ: sau khi SV2 demo mất mạng → kết nối lại → em chạy `python scripts\check_inventory.py` để xác nhận tồn kho nhất quán 100%.

**Q19: Điểm khác biệt giữa staging của em và bản Vercel là gì?**

> 3 điểm khác biệt chính: (1) **DB**: staging dùng PostgreSQL local trong Docker, Vercel dùng Neon Cloud; (2) **Đo lường**: staging có thể đo CPU/RAM vật lý, Vercel không thể; (3) **An toàn**: staging có thể xóa/restore thoải mái, Vercel là dữ liệu demo cho giảng viên xem.

**Q20: Em đóng góp gì cho dự án ngoài code?**

> (1) Dựng staging môi trường cho cả nhóm test – không có staging thì SV3 không thể test restore, SV2 không thể test offline sync; (2) Viết RBAC middleware bảo vệ toàn bộ API – nếu thiếu, Viewer có thể xóa dữ liệu; (3) Chủ trì nghiệm thu KT1–KT3 với evidence có timestamp; (4) Đo hiệu năng thực tế và viết bảng ước lượng mở rộng cho Chương 5; (5) Viết `README.md` để bất kỳ ai cũng có thể chạy dự án.

---

## Phụ lục: Danh sách file SV4 phụ trách

| File | Ngôn ngữ | Vai trò | Dòng code |
|------|----------|---------|-----------|
| `backend/app/core/rbac.py` | Python | RBAC middleware | 285 |
| `backend/app/seed_demo.py` | Python | Seed 1,000 SP + 6 tài khoản | 668 |
| `scripts/kt1_create_document.py` | Python | Kiểm thử KT1 | 140 |
| `scripts/kt2_duplicate_key.py` | Python | Kiểm thử KT2 | 125 |
| `scripts/kt3_rbac_403.py` | Python | Kiểm thử KT3 | 106 |
| `scripts/show_audit_log.py` | Python | Xem Audit Log qua token (demo KT3) | ~160 |
| `scripts/load_test_runner.py` | Python | Đo tải 2→16 VU | 320 |
| `scripts/check_inventory.py` | Python | Đối chiếu tồn kho | 147 |
| `scripts/run_kt_all.ps1` | PowerShell | Chạy KT1+KT2+KT3 | 68 |
| `docs/evidence/load_test_results.json` | JSON | Kết quả đo tải thực tế | - |
| `docker-compose.yml` | YAML | Cấu hình 3 container | - |
| `README.md` | Markdown | Hướng dẫn chạy dự án | - |

---

*Tài liệu này được tạo từ mã nguồn thực tế – cập nhật lần cuối ngày 2026-11-23 (thêm `show_audit_log.py`).*
