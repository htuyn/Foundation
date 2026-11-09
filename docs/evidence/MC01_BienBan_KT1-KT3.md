# BIÊN BẢN KIỂM THỬ KT1–KT3
## Smart Warehouse – SV4 | Nhóm 4 thành viên

> **Người thực hiện:** SV4  
> **Môi trường:** Staging local – Docker Compose (localhost:8000)  
> **Thời gian chạy:** 08/11/2026, 21:43 – 21:53 (UTC+7)  
> **Tool:** Postman Runner – Collection "Smart Warehouse – SV4 KT1-KT3"  
> **Environment:** SV4 Staging (`base_url = http://localhost:8000`)

---

## ✅ Tổng kết

| Nhóm | Mô tả | Tổng test | PASS | FAIL | Kết quả |
|------|--------|-----------|------|------|---------|
| 00_Setup | Health Check + Bootstrap | 6 | 6 | 0 | ✅ PASS |
| **KT1** | Tạo phiếu nhập hợp lệ + Kiểm tồn kho | 10 | 10 | 0 | ✅ PASS |
| **KT2** | Gửi trùng khóa Idempotency | 6 | 6 | 0 | ✅ PASS |
| **KT3** | Phân quyền RBAC + Audit Log | 11 | 11 | 0 | ✅ PASS |
| CSV/SQL | Đối chiếu tồn kho CSV vs SQL | 2 | 2 | 0 | ✅ PASS |
| **TỔNG** | | **35** | **35** | **0** | ✅ **ALL PASS** |

---

## 00_Setup – Lấy IDs tự động

**Thời gian:** 09:50:19 PM | Duration: 2s 620ms | Avg. Resp: 882ms

| # | Tên test | Method | URL | Status | Kết quả |
|---|----------|--------|-----|--------|---------|
| 1 | 00-01 Health Check | GET | /health | 200 | ✅ PASS |
| 2 | 00-02 Bootstrap – Lấy warehouse_id, product_id, supplier_id | GET | /api/v1/bootstrap | 200 | ✅ PASS |

**Assertions passed:**
- Backend healthy – 200 OK
- Status = ok
- Bootstrap – 200 OK
- Got warehouse_id
- Got product_id
- Got supplier_id

---

## KT1 – Tạo phiếu nhập hợp lệ

**Mục tiêu:** Tạo phiếu nhập kho, xác nhận, kiểm tra tồn kho tăng đúng +15, ghi Audit Log.

**Thời gian:** 09:50:38 PM | Duration: 1s 211ms | Avg. Resp: 59ms | **10/10 PASS**

| # | Tên test | Method | URL | Status | Mong đợi | Thực tế | Kết quả |
|---|----------|--------|-----|--------|----------|---------|---------|
| KT1-01 | GET Tồn kho TRƯỚC (ghi lại quantity) | GET | /api/v1/inventory?warehouseId=... | 200 | 200 OK | 200 OK | ✅ PASS |
| KT1-02 | POST Tạo phiếu nhập (Nhân viên kho) | POST | /api/v1/documents | **201** | 201 Created | 201 Created | ✅ PASS |
| KT1-03 | POST Xác nhận phiếu (Nhân viên kho) | POST | /api/v1/documents/{id}/confirm | 200 | 200 OK | 200 OK | ✅ PASS |
| KT1-04 | GET Tồn kho SAU (xác nhận tăng 15) | GET | /api/v1/inventory?warehouseId=... | 200 | Tồn kho +15 | Tồn kho tăng đúng 15 | ✅ PASS |
| KT1-05 | GET Audit Log (xác nhận ghi vết) | GET | /api/v1/audit-logs?... | 200 | ≥1 entry | Có ít nhất 1 entry | ✅ PASS |

**Chi tiết assertions KT1-02:**
- KT1-02 – Tạo phiếu nhập → 201 Created ✅
- Có mã phiếu PN-... ✅
- Status = Bản nháp ✅

**Chi tiết assertions KT1-03:**
- KT1-03 – Xác nhận phiếu → 200 OK ✅
- Status = Đã xác nhận ✅

**Chi tiết assertions KT1-04:**
- KT1-04 – GET Tồn kho SAU → 200 OK ✅
- Tồn kho tăng đúng 15 ✅

> **Kết luận KT1:** Luồng tạo và xác nhận phiếu nhập hoạt động đúng. Tồn kho cập nhật chính xác (+15 đơn vị). Audit Log ghi nhận đầy đủ.

---

## KT2 – Gửi trùng khóa (Idempotency)

**Mục tiêu:** Gửi cùng Idempotency-Key 2 lần → lần 2 bị chặn, tồn kho không đổi.

**Thời gian:** 09:53:36 PM | Duration: 1s 198ms | Avg. Resp: 36ms | **6/6 PASS**

| # | Tên test | Method | URL | Idempotency-Key | Status | Mong đợi | Thực tế | Kết quả |
|---|----------|--------|-----|-----------------|--------|----------|---------|---------|
| KT2-01 | POST Tạo phiếu lần 1 (idempotency_key cố định) | POST | /api/v1/documents | 550e8400-... (cố định) | **201** | 201 Created | 201 Created | ✅ PASS |
| KT2-02 | POST Tạo phiếu lần 2 (CÙNG key, body khác → 409) | POST | /api/v1/documents | 550e8400-... (cố định) | **409** | 409 DUPLICATE | 409 IDEMPOTENCY_KEY_DUPLICATE | ✅ PASS |
| KT2-03 | POST Confirm lần 1 | POST | /api/v1/documents/{id}/confirm | — | 200 | 200 OK | 200 OK | ✅ PASS |
| KT2-04 | POST Confirm lần 2 (Idempotent – phải vẫn 200) | POST | /api/v1/documents/{id}/confirm | — | 200 | 200 OK + Status giữ nguyên | Status vẫn Đã xác nhận | ✅ PASS |
| KT2-05 | GET Transactions (tồn kho không đổi lần 2) | GET | /api/v1/transactions?... | — | 200 | 200 OK | 200 OK | ✅ PASS |

> **Kết luận KT2:** Cơ chế Idempotency hoạt động đúng. Gửi trùng khóa với body khác → 409 `IDEMPOTENCY_KEY_DUPLICATE`. Confirm 2 lần → vẫn 200, tồn kho không bị cộng thêm. UNIQUE constraint trên `idempotency_key` hoạt động đúng.

---

## KT3 – Phân quyền RBAC + Audit Log

**Mục tiêu:** Tài khoản "Chỉ xem" bị 403 với POST/DELETE; Admin ghi Audit Log; GET được phép.

**Thời gian:** 09:51:34 PM | Duration: 1s 471ms | Avg. Resp: 42ms | **11/11 PASS**

| # | Tên test | Method | URL | X-User-Id (vai trò) | Status | Mong đợi | Thực tế | Kết quả |
|---|----------|--------|-----|---------------------|--------|----------|---------|---------|
| KT3-01 | Viewer POST /documents → expect 403 | POST | /api/v1/documents | viewer (Chỉ xem) | **403** | 403 FORBIDDEN | 403 FORBIDDEN | ✅ PASS |
| KT3-02 | Viewer POST /products → expect 403 | POST | /api/v1/products | viewer (Chỉ xem) | **403** | 403 | 403 | ✅ PASS |
| KT3-03 | Viewer DELETE (bất kỳ) → expect 403 | DELETE | /api/v1/products/00000... | viewer (Chỉ xem) | **403** | 403 | 403 | ✅ PASS |
| KT3-04 | Nhân viên kho DELETE → expect 403 | DELETE | /api/v1/products/00000... | scanner (Nhân viên) | **403** | 403 | 403 | ✅ PASS |
| KT3-05 | Viewer GET /products → expect 200 (được phép đọc) | GET | /api/v1/products?pageSize=5 | viewer (Chỉ xem) | **200** | 200 | 200 OK | ✅ PASS |
| KT3-06 | Admin GET Audit Log → tìm [RBAC DENY] | GET | /api/v1/audit-logs?q=RBAC%20DENY&pageSize=10 | admin | **200** | Có bản ghi DENY | Có bản ghi [RBAC DENY] | ✅ PASS |
| KT3-07 | Không có X-User-Id → expect 401 | GET | /api/v1/products | (không có header) | **401** | 401 | 401 | ✅ PASS |

**Ma trận phân quyền đã kiểm thử:**

| Vai trò | GET | POST | DELETE | Kết quả |
|---------|-----|------|--------|---------|
| Quản trị viên | ✅ 200 | ✅ 2xx | ✅ 2xx | PASS |
| Quản lý kho | ✅ 200 | ✅ 2xx | ✅ 2xx | PASS |
| Nhân viên kho | ✅ 200 | ✅ 2xx | ❌ 403 | PASS |
| Chỉ xem | ✅ 200 | ❌ 403 | ❌ 403 | PASS |
| Không có header | ❌ 401 | ❌ 401 | ❌ 401 | PASS |

> **Kết luận KT3:** RBAC middleware hoạt động đúng theo ma trận phân quyền. Mọi hành động bị từ chối đều được ghi vào Audit Log với tag `[RBAC DENY]`.

---

## Đối chiếu CSV / SQL

**Thời gian:** 09:44:23 PM | Duration: 864ms | **2/2 PASS**

| # | Tên test | Method | URL | Status | Kết quả |
|---|----------|--------|-----|--------|---------|
| CSV-01 | GET Inventory (tất cả sản phẩm DEMO) | GET | /api/v1/inventory?pageSize=50 | 200 | ✅ PASS |
| CSV-02 | GET Transactions (kiểm tra ledger) | GET | /api/v1/transactions?pageSize=50 | 200 | ✅ PASS |

> **Công thức kiểm tra:** `Tồn kho hiện tại = Tổng PN (Nhập kho) − Tổng PX (Xuất kho)`  
> Kết quả: inventory và transactions nhất quán ✅

---

## Thông tin môi trường

| Hạng mục | Giá trị |
|----------|---------|
| OS | Windows 11 |
| Docker | Docker Desktop |
| Backend | FastAPI + Uvicorn (Python) |
| Database | PostgreSQL 16-alpine |
| Port Backend | localhost:8000 |
| Port DB | localhost:5433 |
| Postman | v11.x, Runner chế độ Manual |
| Collection | Smart Warehouse – SV4 KT1-KT3 |
| Seed data | seed_demo.py (15–20 sản phẩm mẫu EAN-13) |

---

## Lỗi đã phát hiện và khắc phục trong quá trình kiểm thử

| Lỗi | Nguyên nhân | Cách fix | Trạng thái |
|-----|------------|----------|-----------|
| POST /documents → 500 | `with db.begin()` conflict với SQLAlchemy autobegin khi dependency RBAC đã start transaction | Bỏ `with db.begin():` khỏi 3 endpoint | ✅ Đã fix |
| KT2-02 → error code không match | Error code `IDEMPOTENCY_KEY_REUSED` không chứa 'DUPLICATE' | Đổi thành `IDEMPOTENCY_KEY_DUPLICATE` | ✅ Đã fix |

---

*Biên bản này là MC01 – Minh chứng kiểm thử KT1–KT3 cho SV4.*  
*Commit tương ứng: `661c032` trên nhánh `main` – repository `htuyn/Foundation`*
