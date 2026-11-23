# 🎓 Kịch bản bảo vệ đồ án – SV4 (Nguyễn Nhật Long)

**Smart Warehouse | Staging + RBAC + Kiểm thử + Đo tải**

---

## 🟡 TRƯỚC KHI BẢO VỆ – Chuẩn bị (~15 phút)

### Bước 0: Khởi động staging

Mở Terminal PowerShell, chạy từng lệnh:

```powershell
cd "C:\Users\long\OneDrive\Desktop\CNNT\Foundation"
docker compose up -d
docker compose ps
```

✅ **Mục tiêu:** 3 container đều ở trạng thái `Up (healthy)`:

```
NAMES                   STATUS                 PORTS
foundation-frontend-1   Up ...    0.0.0.0:5173->5173/tcp
foundation-backend-1    Up ...    127.0.0.1:8000->8000/tcp
foundation-postgres-1   Up (healthy)   127.0.0.1:5433->5432/tcp
```

> ⚠️ **Không cần seed lại** – dữ liệu 1,000 sản phẩm, 50 nhà cung cấp, 12 kho đã được lưu trong Docker Volume và sẽ còn nguyên qua các lần tắt/bật máy bình thường. Chỉ cần seed lại nếu đã chạy `docker compose down -v`.

### Mở sẵn các tab trình duyệt:

| Tab | URL | Dùng cho |
|-----|-----|----------|
| Tab 1 | http://localhost:5173 | Frontend |
| Tab 2 | http://localhost:8000/docs | Swagger UI (Hội đồng thích nhìn thấy API) |
| Tab 3 | http://localhost:8000/docs | Swagger UI – xem Audit Log có token (demo KT3) |

---

## 🟢 PHẦN 1 – Giới thiệu vai trò SV4 (~2 phút nói)

**Nói với Hội đồng:**

> *"Thưa Hội đồng, em là SV4 – phụ trách 4 mảng chính:*
> *Thứ nhất – dựng môi trường Staging Docker Compose để cả nhóm kiểm thử an toàn, không ảnh hưởng bản demo Vercel.*
> *Thứ hai – thiết kế và triển khai phân quyền RBAC 4 vai trò.*
> *Thứ ba – chủ trì nghiệm thu 3 kịch bản kiểm thử KT1, KT2, KT3.*
> *Thứ tư – đo tải thực tế và ngoại suy khả năng mở rộng hệ thống."*

**Chỉ vào sơ đồ kiến trúc staging** (trong báo cáo hoặc README):

```
Frontend :5173  ←→  Backend :8000  ←→  PostgreSQL :5433
             (Staging Docker Compose – local)
```

---

## 🟢 PHẦN 2 – Demo KT1: Tạo phiếu nhập hợp lệ (~3 phút)

**Mục tiêu chứng minh:** Hệ thống tạo phiếu, xác nhận, tồn kho tăng đúng và ghi vết vào Audit Log.

### Bước 1: Chạy script KT1 trực tiếp trước Hội đồng

```powershell
python -X utf8 scripts\kt1_create_document.py
```

Hội đồng sẽ thấy output thực tế:

```
🔑 Đang login...
✅ Login OK | 2026-11-23 16:29:46

📦 Lấy danh sách nhà cung cấp...
✅ Nhà cung cấp: DEMO | Công ty cung ứng tổng hợp 001

📋 KT1 – Bước 1/3: Tạo phiếu nhập kho...
   HTTP 201 ✅  |  Mã phiếu: PN-2026-5358  |  Trạng thái: Bản nháp

📋 KT1 – Bước 2/3: Xác nhận phiếu PN-2026-5358...
   HTTP 200 ✅  |  Trạng thái: Đã xác nhận

📊 KT1 – Bước 3/3: Kiểm tra tồn kho SAU khi xác nhận...
   Tồn kho SAU : 25

✅ Kiểm tra tồn kho: 20 → 25 (Δ = +5, kỳ vọng +5)
✅ KT1 PASS!
   Mã phiếu  : PN-2026-5358
   Trạng thái: Đã xác nhận
   Thời gian  : 2026-11-23 16:29:57
```

### Bước 2: Giải thích kết quả

**Nói với Hội đồng:**

> *"Phiếu nhập được tạo với mã PN-2026-xxxx do server sinh tự động – UNIQUE trong database. Hệ thống trả về HTTP 201 Created. Script thực hiện 3 bước tự động: tạo phiếu → xác nhận phiếu → kiểm tra tồn kho tăng đúng +5 so với trước."*

### Bước 3: Chỉ vào Frontend (nếu được hỏi thêm)

Mở http://localhost:5173 → vào mục **Phiếu kho** → tìm mã phiếu `PN-2026-xxxx` vừa tạo → chỉ trạng thái **Đã xác nhận**.

---

## 🟢 PHẦN 3 – Demo KT2: Chống ghi trùng Idempotency (~4 phút)

**Mục tiêu chứng minh:** Gửi cùng 1 `Idempotency-Key` hai lần → tồn kho không thay đổi, hệ thống trả về đúng kết quả.

### Bước 1: Chạy script KT2

```powershell
python -X utf8 scripts\kt2_duplicate_key.py
```

Hội đồng sẽ thấy:

```
🔑 Idempotency-Key: bdeaf55f-0b87-451b-abca-634342f129e0
   (Cùng key này gửi 2 lần để kiểm tra)

📊 Tồn kho TRƯỚC khi test: 278

📤 Lần 1 - Gửi phiếu nhập...
   HTTP 201 | ✅ Tạo phiếu: PN-2026-5359

📤 Lần 2 - Gửi CÙNG key lần 2 (phải bị chặn)...
   HTTP 200 | ✅ Hệ thống nhận ra trùng key!

📊 Tồn kho SAU khi test: 278   ← KHÔNG THAY ĐỔI

✅ KT2 PASS - Hệ thống chống ghi trùng hoạt động đúng!
```

### Bước 2: Giải thích cơ chế – điểm quan trọng nhất!

**Nói với Hội đồng:**

> *"Lần gửi đầu tiên trả HTTP 201 Created – tạo phiếu thành công. Lần gửi thứ hai với cùng `Idempotency-Key` trả HTTP 200 – hệ thống nhận ra đây là request trùng và trả về kết quả của lần đầu, không ghi vào database lần nữa. Tồn kho vẫn là 278 – không bị nhân đôi. Đây là ràng buộc UNIQUE trên cột `idempotency_key` trong PostgreSQL, kết hợp với logic 'upsert' phía backend."*

### Bước 3: Nếu Hội đồng hỏi "tại sao cần điều này?"

> *"Trong thực tế kho vận, thiết bị quét mã có thể bị mất kết nối giữa chừng và tự động thử lại (retry). Nếu không có cơ chế này, một lần quét mã vật lý có thể tạo ra 2–3 phiếu nhập trùng nhau, dẫn đến sai lệch tồn kho nghiêm trọng."*

---

## 🟢 PHẦN 4 – Demo KT3: Phân quyền RBAC (~5 phút)

**Mục tiêu chứng minh:** Tài khoản Chỉ xem (Viewer) bị chặn HTTP 403, tài khoản Admin vẫn thực hiện bình thường.

### Bước 1: Chạy script KT3

```powershell
python -X utf8 scripts\kt3_rbac_403.py
```

Hội đồng sẽ thấy:

```
🔑 Login tài khoản VIEWER (Chỉ xem)...
✅ Login OK | Vai trò: Chỉ xem

📤 Thử tạo phiếu nhập bằng tài khoản Chỉ xem...
   HTTP 403 | 2026-11-23 16:30:12
   Response: {
     "error": {
       "code": "FORBIDDEN",
       "message": "Tài khoản chỉ xem không được phép thực hiện POST /api/v1/documents."
     }
   }

✅ KT3a PASS - Tài khoản Chỉ xem bị chặn đúng!

🔑 Login tài khoản ADMIN (đối chiếu)...
✅ Login OK | Vai trò: Quản trị viên

📤 Thử tạo phiếu nhập bằng tài khoản Admin (phải thành công)...
   HTTP 201 | 2026-11-23 16:30:16

✅ KT3b PASS - Admin tạo phiếu thành công: PN-2026-5360

✅ KT3 PASS HOÀN TOÀN!
   Viewer → HTTP 403 FORBIDDEN ✅
   Admin  → HTTP 201 Created   ✅
```

### Bước 2: Hiển thị Audit Log để chứng minh "ghi vết vi phạm"

> ⚠️ **Lưu ý quan trọng:** Endpoint `/api/v1/audit-logs` yêu cầu Bearer Token.
> **Không thể mở thẳng trên trình duyệt** (sẽ trả lỗi `MISSING_ACCESS_TOKEN`).
> Dùng script bên dưới thay thế – vừa đẹp, vừa chuyên nghiệp hơn.

**Chạy script xem Audit Log (terminal mới):**

```powershell
python -X utf8 scripts\show_audit_log.py
```

Hội đồng sẽ thấy trực tiếp trên terminal:

```
══════════════════════════════════════════════════════════════════════
  📋 NHẬT KÝ AUDIT LOG – Smart Warehouse (SV4 Demo)
══════════════════════════════════════════════════════════════════════

🔑 Đăng nhập Admin để lấy token...
✅ Đăng nhập thành công!

📥 Lấy log vi phạm RBAC (403 / 401)...

🚫 [  1] 2026-11-23 16:30:12 | HTTP 403
      Thông báo: [RBAC DENY 403] viewer@anphat.com | POST /api/v1/documents | Vai trò 'Chỉ xem' không được phép thực hiện thao tác thay đổi dữ liệu.
      Người thực hiện: viewer@anphat.com
      Vai trò: Chỉ xem
      Lý do: Vai trò 'Chỉ xem' không được phép thực hiện thao tác thay đổi dữ liệu.
```

> *Nếu muốn xem toàn bộ log (không chỉ 403):*
> ```powershell
> python -X utf8 scripts\show_audit_log.py --all
> ```

**Nói với Hội đồng:**

> *"Mỗi lần tài khoản Chỉ xem cố tình gọi API không được phép, hệ thống không chỉ từ chối mà còn tự động ghi vào Nhật ký Audit Log – bao gồm: ai thực hiện, vai trò gì, endpoint nào, thời điểm chính xác. Format log: `[RBAC DENY 403] <tên user> | POST /api/v1/documents | Vai trò 'Chỉ xem' không được phép thao tác thay đổi dữ liệu`. Điều này đảm bảo truy vết sau sự cố."*

### Bước 3: Trình bày Ma trận phân quyền (nếu được hỏi)

| Vai trò | Alias DB | GET (xem) | POST (tạo) | PUT/PATCH (sửa) | DELETE (xóa) |
|---------|----------|-----------|------------|-----------------|--------------|
| Quản trị viên | `admin` | ✅ | ✅ | ✅ | ✅ |
| Quản lý kho | `storekeeper` | ✅ | ✅ | ✅ | ✅ |
| Nhân viên kho | `scanner` | ✅ | ✅ | ✅ | ❌ |
| Chỉ xem | `viewer` | ✅ | ❌ | ❌ | ❌ |

**Tài khoản demo:**

| Email | Mật khẩu | Vai trò |
|-------|----------|---------|
| `admin@anphat.com` | `Admin123!` | Quản trị viên |
| `viewer@anphat.com` | `Viewer123!` | Chỉ xem |
| `scanner@anphat.com` | `Scanner123!` | Nhân viên kho |
| `storekeeper@anphat.com` | `Storekeeper123!` | Quản lý kho |

---

## 🟢 PHẦN 5 – Đối chiếu CSV/SQL & Tính nhất quán dữ liệu (~2 phút)

**Nói với Hội đồng:**

> *"Để chứng minh tính toàn vẹn dữ liệu, em kiểm tra công thức:*
> *Tồn kho = Σ(Nhập kho) − Σ(Xuất kho) + Σ(Điều chỉnh)*
> *Script `check_inventory.py` lấy toàn bộ bảng Inventory và bảng StockMovement, tính lại từ ledger giao dịch rồi so sánh. Nếu có chênh lệch sẽ báo ngay."*

Nếu Hội đồng muốn xem trực tiếp:

```powershell
python scripts\check_inventory.py
```

Kết quả mong đợi:
```
✅ KẾT LUẬN: TỒN KHO NHẤT QUÁN HOÀN TOÀN
```

---

## 🟢 PHẦN 6 – Đo tải & Ngoại suy mở rộng (~4 phút)

**Mục tiêu chứng minh:** Hệ thống xử lý được bao nhiêu điểm quét đồng thời và giới hạn ở đâu.

### Bước 1: Trình bày bảng số liệu đo thực tế (từ `docs/evidence/load_test_results.json`)

| Điểm quét (VU) | req/s | p50 (ms) | p95 (ms) | p99 (ms) | Lỗi | CPU avg | CPU max | RAM đỉnh |
|:--------------:|------:|:--------:|:--------:|:--------:|:---:|:-------:|:-------:|:--------:|
| 2 | 3.39 | 27 ms | 93 ms | 2037 ms | 0% | 8.2% | 15.8% | 158 MiB |
| 4 | 6.81 | 28 ms | 95 ms | 2122 ms | 0% | 19.0% | 28.2% | 157 MiB |
| 8 | 13.31 | 31 ms | 145 ms | 2280 ms | 0% | 33.7% | 49.5% | 162 MiB |
| 16 | 25.30 | 62 ms | 241 ms | 2445 ms | 0% | 68.0% | 91.1% | 167 MiB |

> 📌 **Nguồn số liệu:** Đo thực tế trên staging Docker local – không phải Vercel (Vercel là serverless, không đo được CPU/RAM vật lý).

### Bước 2: Giải thích mô hình ngoại suy

**Nói với Hội đồng:**

> *"Từ 2 lên 4 điểm quét, throughput tăng gần gấp đôi (3.39 → 6.81 req/s, tỷ lệ 2.01×) – gần tuyến tính lý tưởng. Từ 8 lên 16 điểm, throughput tăng thêm 1.90× trong khi CPU tăng từ 33.7% lên 68.0%. Tỷ lệ lỗi vẫn 0% ở tất cả mức tải – hệ thống ổn định. Bottleneck dự kiến sẽ xuất hiện khi CPU chạm ngưỡng bão hòa tại ~32 VU. Giải pháp mở rộng: scale CPU (vertical) hoặc dùng connection pooler như PgBouncer (horizontal)."*

### Bước 3: Nếu được hỏi "chạy lại thử được không?"

```powershell
python scripts\load_test_runner.py --all
```

> ⚠️ Thông báo trước Hội đồng: "Script sẽ chạy 4 kịch bản × 30 giây = khoảng **2 phút**."

---

## 🟢 PHẦN 7 – Chạy toàn bộ bộ test 1 lần trước Hội đồng (nếu có thời gian)

```powershell
cd "C:\Users\long\OneDrive\Desktop\CNNT\Foundation"
.\scripts\run_kt_all.ps1
```

Output sẽ hiện lần lượt **KT1 → KT2 → KT3** và tự lưu evidence vào `tests/kt_results/`. Hội đồng thấy tất cả PASS trong một lần chạy (~30 giây).

---

## 🔴 XỬ LÝ CÁC CÂU HỎI KHÓ

| Câu hỏi Hội đồng có thể hỏi | Cách trả lời ngắn gọn |
|------------------------------|----------------------|
| "Tại sao dùng staging riêng mà không test trực tiếp trên Vercel?" | Vercel là serverless, không đo được CPU/RAM. Các thao tác nguy hiểm như xóa và restore chỉ nên chạy trên môi trường cô lập. |
| "RBAC lưu quyền ở đâu?" | Lưu trong trường `role` của bảng `users` trong PostgreSQL. Mỗi request gửi kèm Bearer token, middleware `get_current_user()` xác thực JWT → `require_permission()` tra `role` → cho qua hoặc 403. |
| "Nếu cùng lúc 2 request trùng key đến?" | UNIQUE constraint của PostgreSQL xử lý tại tầng DB – transaction sau sẽ bị lỗi unique violation, backend bắt exception và trả HTTP 200 với kết quả của lần đầu. |
| "16 điểm quét bị bão hòa thì xử lý thế nào?" | Thêm worker Uvicorn (`--workers`), dùng PgBouncer để pool connection DB, hoặc scale horizontal bằng thêm container backend. |
| "Dữ liệu đo có đáng tin không, có thể đo lại không?" | Có, chạy lại `python scripts\load_test_runner.py --all` ngay tại chỗ. Kết quả sẽ gần giống vì cùng môi trường. |
| "Nếu không seed được thì sao?" | Hệ thống đã có sẵn 1,000 sản phẩm, 50 nhà cung cấp. Seed (`python -m app.seed_demo` trong container) chỉ cần chạy khi volume bị xóa (`down -v`). |
| "p95 = 241ms nghĩa là gì?" | 95% request được xử lý trong vòng 241ms, chỉ 5% chậm hơn. Ngưỡng SLA phổ biến là p95 < 500ms – hệ thống hiện tại đáp ứng tốt ở tất cả 4 mức tải. |

---

## ✅ Checklist Chuẩn bị Trước Phòng Bảo vệ

- [ ] `docker compose ps` → 3 container `Up (healthy)`
- [ ] http://localhost:5173 → Frontend mở được
- [ ] http://localhost:8000/docs → Swagger mở được
- [ ] `python -X utf8 scripts\show_audit_log.py` → Audit Log hiện đúng (không còn mở thẳng URL trình duyệt)
- [ ] 3 tab terminal sẵn sàng (mở ở thư mục `Foundation`)
- [ ] Mở sẵn file `docs/evidence/MC01_BienBan_KT1-KT3.md` và `docs/evidence/load_test_results.json`
- [ ] Slide/báo cáo mở ở trang Chương 4 (KT1–KT3) và Chương 5 (Đo tải)
- [ ] Chạy thử `.\scripts\run_kt_all.ps1` một lần để confirm không lỗi
