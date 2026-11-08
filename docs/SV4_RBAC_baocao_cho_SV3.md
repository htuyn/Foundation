# Báo cáo đồng bộ SV4 → SV3 (RBAC Middleware)

> **Ngày:** 29/10/2026 | **Người gửi:** SV4 | **Người nhận:** SV3

---

## 1. Tóm tắt những gì SV4 đã làm

SV4 đã tự xây dựng toàn bộ RBAC middleware.  
Code nằm trong repo tại: `backend/app/core/rbac.py`

---

## 2. Cơ chế hoạt động (SV3 cần nắm)

### 2.1 Xác thực danh tính
```
Client → [Header: X-User-Id: <uuid>] → FastAPI → tra bảng users → lấy role
```
- **Không dùng JWT/session** – đơn giản hóa cho đề tài, đủ để demo RBAC
- SV3 **không cần làm thêm gì** cho phần xác thực, SV4 đã handle hết

### 2.2 Ma trận phân quyền (đã chốt, theo roadmap)

| Role | GET | POST | PUT/PATCH | DELETE |
|---|---|---|---|---|
| Quản trị viên | ✅ | ✅ | ✅ | ✅ |
| Quản lý kho | ✅ | ✅ | ✅ | ✅ |
| Nhân viên kho | ✅ | ✅ | ✅ | ❌ |
| **Chỉ xem** | ✅ | ❌ | ❌ | ❌ |

> Scanner endpoints (`/api/v1/scanner/*`) và `/api/v1/bootstrap` → **miễn xác thực**

---

## 3. Những thứ SV3 CẦN đồng bộ

### 3.1 Migration mới: `0005_rbac_viewer_role.py`

SV4 đã tạo migration này. **SV3 cần chạy:**
```bash
docker compose exec api alembic upgrade head
```
Migration sẽ cập nhật CHECK constraint bảng users thêm `'Chỉ xem'`.

### 3.2 Model + Schema đã cập nhật

- `entities.py` → CHECK constraint User.role đã thêm `'Chỉ xem'`
- `schemas.py` → `UserInput.role` Literal đã thêm `'Chỉ xem'`

---

## 4. Câu trả lời cho 4 câu hỏi SV3 đã hỏi

### ❓ Câu 1: "Khi user bị chặn 403 thì gọi hàm nào của SV3 để ghi Audit Log?"

**SV4 tự xử lý.** Middleware gọi `_write_deny_log()` nội bộ:
```python
db.add(AuditLog(
    message=f"[RBAC DENY] {user.role} | {method} {path}",
    actor_name=user.name,
))
```
SV3 không cần expose thêm hàm nào.

### ❓ Câu 2: "Dùng header X-User-Id: <uuid>?"

**Đúng, đã implement chính xác vậy.** Request gửi header `X-User-Id: <uuid>` → middleware tra DB → lấy role.

### ❓ Câu 3: "Ai thêm 'Chỉ xem' vào constraint?"

**SV4 đã làm xong** (migration + model + schema). SV3 chỉ cần `alembic upgrade head`.

### ❓ Câu 4: "Chỉ xem chỉ GET, không POST/PUT/DELETE – confirm?"

**Confirm đúng.** Đã implement chính xác theo roadmap.

---

## 5. Phần SV3 cần làm để hoàn tất tích hợp (Ngày 10)

- Bảng `audit_logs` không có ràng buộc nào chặn format message đặc biệt → OK, không cần sửa
- Backup script của SV3 sẽ tự động include cả log `[RBAC DENY]`
- Phần idempotency + backup/restore của SV3 giữ nguyên kế hoạch

---

## 6. Seed data 4 user demo (SV4 thêm vào seed_demo.py)

```python
# 4 users đại diện 4 vai trò để test RBAC
users = [
    {"name": "Admin Nguyễn", "email": "admin@anphat.com", "role": "Quản trị viên"},
    {"name": "Quản lý Trần", "email": "quanly@anphat.com", "role": "Quản lý kho"},
    {"name": "Thủ kho Lê",   "email": "thukho@anphat.com", "role": "Nhân viên kho"},
    {"name": "Viewer Phạm",  "email": "viewer@anphat.com", "role": "Chỉ xem"},
]
```

---

## 7. Test nhanh để SV3 verify

```bash
# 1. Thử GET với user bất kỳ → OK
curl http://localhost:8000/api/v1/products -H "X-User-Id: <uuid-admin>"

# 2. POST với Viewer → phải ra 403
curl -X POST http://localhost:8000/api/v1/products \
  -H "X-User-Id: <uuid-viewer>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test",...}'
# Response: {"error":{"code":"FORBIDDEN","message":"Vai trò 'Chỉ xem' không được phép..."}}

# 3. Kiểm tra audit log ghi được
# SELECT * FROM audit_logs WHERE message LIKE '%RBAC DENY%' ORDER BY created_at DESC LIMIT 5;
```

---

## 8. Bảng phụ thuộc còn lại

| Cần | Từ ai | Deadline |
|---|---|---|
| ~~Middleware RBAC ghi log vào Audit Log~~ | ✅ SV4 xong | Ngày 10 |
| Backup/restore chạy được trên staging | SV3 | Ngày 11 |
| Offline Queue và nút gửi lặp | SV2 | Ngày 10 |
