# Runbook – Xử lý khi Mạng bị Đứt (Offline Recovery)

> **Dự án**: Smart Warehouse – SV4  
> **Phiên bản**: 1.0  
> **Ngày cập nhật**: 11/11/2026  
> **Người thực hiện**: SV4 – Nguyễn Nhật Long

---

## 1. Mô tả tình huống

| Triệu chứng | Nguyên nhân có thể |
|---|---|
| `curl: Failed to connect` | Backend container không chạy |
| `502 Bad Gateway` | Nginx/frontend không kết nối được backend |
| `ECONNREFUSED localhost:8000` | Backend crash hoặc port bị block |
| `could not connect to server: Connection refused` (Postgres) | DB container down |
| Mất kết nối LAN giữa scanner và server | Switch/WiFi bị ngắt |

---

## 2. Quy trình khôi phục nhanh (< 5 phút)

### Bước 1 – Kiểm tra trạng thái container

```powershell
cd C:\Users\long\OneDrive\Desktop\CNNT\Foundation
docker-compose ps
```

**Kết quả mong đợi:**

```
NAME                STATUS          PORTS
foundation-backend-1    Up              0.0.0.0:8000->8000/tcp
foundation-postgres-1   Up (healthy)    127.0.0.1:5433->5432/tcp
foundation-frontend-1   Up              0.0.0.0:5173->5173/tcp
```

Nếu container **Exit** hoặc **Restarting** → chuyển sang Bước 2.

---

### Bước 2 – Khởi động lại staging

```powershell
# Khởi động lại toàn bộ stack
docker-compose up -d

# Chờ postgres healthy (khoảng 10–15 giây), rồi kiểm tra
Start-Sleep -Seconds 15
curl http://localhost:8000/health
```

Nếu trả về `{"status":"ok"}` → hệ thống đã phục hồi.

---

### Bước 3 – Kiểm tra log lỗi (nếu vẫn fail)

```powershell
# Log backend (10 dòng cuối)
docker-compose logs --tail=50 backend

# Log postgres
docker-compose logs --tail=30 postgres
```

**Lỗi thường gặp và cách xử lý:**

| Log hiển thị | Nguyên nhân | Giải pháp |
|---|---|---|
| `password authentication failed` | Sai POSTGRES_PASSWORD trong .env | Kiểm tra file `.env`, khớp với `POSTGRES_PASSWORD` |
| `database "warehouse_db" does not exist` | Volume bị xóa | Chạy lại `docker-compose down -v` rồi `up -d` + seed lại |
| `port 8000 already in use` | Tiến trình khác chiếm port | `netstat -ano \| findstr :8000` → kill PID |
| `alembic.util.exc.CommandError: Can't locate revision` | Migration chưa chạy | Xem Bước 4 |

---

### Bước 4 – Chạy lại migration (nếu DB mới)

```powershell
# Vào container backend
docker-compose exec backend alembic upgrade head

# Seed dữ liệu mẫu
docker-compose exec backend python app/seed_demo.py
```

---

### Bước 5 – Kiểm tra kết nối DB từ bên ngoài

```powershell
# Từ máy host (port 5433 được map ra ngoài)
# Yêu cầu: psql đã cài sẵn trên máy
psql -h 127.0.0.1 -p 5433 -U warehouse_user -d warehouse_db -c "SELECT COUNT(*) FROM inventory;"
```

---

## 3. Quy trình dự phòng khi mất mạng LAN (Scanner offline)

### 3.1 Tình huống: Scanner mất kết nối Wi-Fi đến server

Khi scanner Android/iOS mất kết nối đến `http://<server-ip>:5173`:

1. **Không tắt app** – dữ liệu scan tạm thời vẫn trong RAM
2. Kiểm tra Wi-Fi trên thiết bị scanner
3. Kiểm tra server staging còn chạy: `curl http://localhost:8000/health`
4. Reconnect Wi-Fi → app tự thử lại request

### 3.2 Tình huống: Server mất điện / máy chủ shutdown

```powershell
# Khởi động lại máy chủ staging
docker-compose up -d

# Kiểm tra sức khỏe endpoints
curl http://localhost:8000/health
curl http://localhost:8000/api/v1/inventory?pageSize=5 -H "X-User-ID: 36a45099-c617-5970-9e62-356c301a16bb"
```

---

## 4. Backup & Restore nhanh (kết hợp với SV3)

### Backup PostgreSQL

```bash
# Chạy script backup (scripts/backup_postgres.sh)
docker-compose exec postgres pg_dump -U warehouse_user warehouse_db > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Restore PostgreSQL

```bash
# Restore từ file .sql
docker-compose exec -T postgres psql -U warehouse_user warehouse_db < backup_YYYYMMDD_HHMMSS.sql
```

> **Lưu ý**: Script đầy đủ xem tại [`scripts/backup_postgres.sh`](../scripts/backup_postgres.sh) và [`scripts/restore_postgres.sh`](../scripts/restore_postgres.sh)

---

## 5. Danh sách liên hệ khẩn

| Vai trò | Trách nhiệm |
|---|---|
| SV4 (Long) | RBAC, staging, kiểm thử – liên hệ đầu tiên |
| SV3 | Backup/Restore PostgreSQL |
| SV2 | Frontend, LocalStorage scanner |
| SV1 | Kiến trúc tổng thể |

---

## 6. Checklist phục hồi nhanh

- [ ] `docker-compose ps` → tất cả container **Up**
- [ ] `curl http://localhost:8000/health` → `{"status":"ok"}`
- [ ] `curl http://localhost:8000/api/v1/inventory?pageSize=5` → trả danh sách
- [ ] Truy cập `http://localhost:5173` → Frontend load được
- [ ] Thử tạo phiếu test qua Postman → 201 Created
- [ ] Kiểm tra Audit Log có ghi nhận → `GET /api/v1/audit-logs`

