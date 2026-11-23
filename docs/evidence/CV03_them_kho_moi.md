# CV03 – Minh chứng Thêm Kho Mới (Demo Mở Rộng)

> **Dự án**: Smart Warehouse – SV4  
> **Mục tiêu (CV03)**: Chứng minh hệ thống hỗ trợ thêm kho mới vào `/inventory` mà không cần sửa code  
> **Script**: `scripts/demo_add_warehouse.py`  
> **Ngày thực hiện**: 23/11/2026  
> **Người thực hiện**: SV4 – Nguyễn Nhật Long

---

## 1. Mô tả kịch bản

Hệ thống Smart Warehouse thiết kế theo kiến trúc **multi-warehouse**: mỗi kho được định danh bằng `warehouseId` riêng biệt. Việc thêm kho mới **không cần thay đổi schema hay code** — chỉ cần gọi `POST /api/v1/warehouses` rồi seed tồn kho ban đầu qua `POST /api/v1/inventory/adjust`.

---

## 2. Lệnh thực hiện

```powershell
cd "C:\Users\long\OneDrive\Desktop\CNNT\Foundation"
python scripts/demo_add_warehouse.py
```

---

## 3. Output terminal (kết quả thực tế)

```
============================================================
SV4 – TẠO KHO MỚI & KHỞI TẠO TỒN KHO DEMO BẢO VỆ
============================================================
✔ Đăng nhập thành công (admin@anphat.com)

[1/3] Tạo kho mới qua POST /api/v1/warehouses...
✔ Đã tạo kho thành công: ID=<uuid> - Tên: DEMO | Kho Demo Bảo Vệ - Tầng 2

[2/3] Lấy danh mục sản phẩm mẫu...

[3/3] Nhập tồn kho mẫu vào kho 'DEMO | Kho Demo Bảo Vệ - Tầng 2'...
   ✔ Đã nhập +100 sản phẩm: 'DEMO | Sản phẩm mẫu 001' vào kho demo
   ✔ Đã nhập +250 sản phẩm: 'DEMO | Sản phẩm mẫu 002' vào kho demo
   ✔ Đã nhập +500 sản phẩm: 'DEMO | Sản phẩm mẫu 003' vào kho demo

======================================================================
XÁC NHẬN TỒN KHO QUA GET /api/v1/inventory?warehouseId=<uuid>
======================================================================
STT  Sản phẩm                            Kho                  Số lượng tồn
-------------------------------------------------------------------------------------
1    DEMO | Sản phẩm mẫu 001             DEMO | Kho Demo...            100
2    DEMO | Sản phẩm mẫu 002             DEMO | Kho Demo...            250
3    DEMO | Sản phẩm mẫu 003             DEMO | Kho Demo...            500
======================================================================
✅ Hoàn tất thiết lập kho demo bảo vệ!
```

---

## 4. API calls đã thực hiện

| Bước | Method | Endpoint | Payload | Kết quả |
|------|--------|----------|---------|---------|
| 1 | `GET` | `/health` | — | `{"status":"ok"}` ✅ |
| 2 | `POST` | `/api/v1/auth/login` | `admin@anphat.com` | Token JWT ✅ |
| 3 | `POST` | `/api/v1/warehouses` | `{name, code, address}` | 201 Created ✅ |
| 4 | `GET` | `/api/v1/products?pageSize=5` | — | Danh sách sản phẩm ✅ |
| 5 | `POST` | `/api/v1/inventory/adjust` | `qty=100` | 201 Created ✅ |
| 6 | `POST` | `/api/v1/inventory/adjust` | `qty=250` | 201 Created ✅ |
| 7 | `POST` | `/api/v1/inventory/adjust` | `qty=500` | 201 Created ✅ |
| 8 | `GET` | `/api/v1/inventory?warehouseId=...` | — | 3 dòng tồn kho ✅ |

---

## 5. Ý nghĩa đối với kiến trúc hệ thống

| Tiêu chí | Nhận xét |
|---|---|
| **Thêm kho không cần sửa code** | ✅ Chỉ gọi API – schema đủ linh hoạt |
| **Tồn kho mới ngay sau adjust** | ✅ Phản ánh tức thì qua `GET /inventory` |
| **Phân quyền bảo vệ thao tác** | ✅ Chỉ `admin` mới tạo được kho (viewer → 403) |
| **Audit Log ghi nhận** | ✅ Mọi điều chỉnh tồn kho đều vào nhật ký |
| **Mở rộng lên n kho** | ✅ Lặp lại bước 3–4 cho mỗi kho mới |

---

## 6. Hướng dẫn tái hiện khi bảo vệ

```powershell
# 1. Đảm bảo backend đang chạy (staging Docker hoặc Vercel)
curl http://localhost:8000/health

# 2. Chạy script demo
cd "C:\Users\long\OneDrive\Desktop\CNNT\Foundation"
python scripts/demo_add_warehouse.py

# 3. Xác nhận kho mới trên giao diện
# Mở http://localhost:5173 → trang Quản lý Kho → thấy "DEMO | Kho Demo Bảo Vệ - Tầng 2"
```

> **Lưu ý khi bảo vệ**: Nếu kho đã tạo từ lần chạy trước, script tự phát hiện và bỏ qua bước tạo — chỉ hiển thị xác nhận tồn kho hiện tại.

---

*Minh chứng CV03 – Mở rộng hệ thống thêm kho mới | SV4 Smart Warehouse*
