# MC03 – Biên bản Đo tải & Mở rộng (k6 Load Test)

> **Dự án**: Smart Warehouse – SV4  
> **Mục tiêu**: Đo Latency / CPU / RAM tại 2 điểm quét → ngoại suy 4→8→16 điểm  
> **Ngày thực hiện**: 11/11/2026  
> **Người thực hiện**: SV4 – Nguyễn Nhật Long  
> **Tool**: [k6](https://k6.io) + `docker stats`  
> **Script**: [`scripts/k6_load_test.js`](../../scripts/k6_load_test.js)

---

## 1. Môi trường thử nghiệm

| Thành phần | Thông tin |
|---|---|
| **Hệ điều hành** | Windows 11 |
| **CPU máy host** | _(ghi vào sau khi chạy)_ |
| **RAM máy host** | _(ghi vào sau khi chạy)_ |
| **Backend** | FastAPI + Uvicorn – Docker container |
| **Database** | PostgreSQL 16-alpine – Docker container |
| **Port backend** | `localhost:8000` |
| **Port DB** | `localhost:5433` |
| **k6 version** | _(ghi vào sau khi chạy: `k6 version`)_ |

---

## 2. Kịch bản thử nghiệm

### 2.1 Mô tả workload

| Loại request | Tỷ lệ | Endpoint | Vai trò |
|---|---|---|---|
| Tạo phiếu nhập kho | 70% | `POST /api/v1/documents` | Nhân viên kho |
| Đọc tồn kho | 30% | `GET /api/v1/inventory` | Nhân viên kho |

### 2.2 Các mức tải thử nghiệm

| Kịch bản | VU (Virtual Users) | Thời gian | Mô phỏng |
|---|---|---|---|
| **Baseline** | 2 VU | 60s | 2 điểm quét (thực tế) |
| **Scale ×2** | 4 VU | 60s | 4 điểm quét |
| **Scale ×4** | 8 VU | 60s | 8 điểm quét |
| **Scale ×8** | 16 VU | 60s | 16 điểm quét |

### 2.3 Lệnh chạy

```powershell
# Bước 1: Lấy UUID thực từ staging
$prod = (Invoke-RestMethod "http://localhost:8000/api/v1/products?pageSize=1" -H @{"X-User-ID"="36a45099-c617-5970-9e62-356c301a16bb"})[0].id
$supp = (Invoke-RestMethod "http://localhost:8000/api/v1/suppliers?pageSize=1" -H @{"X-User-ID"="36a45099-c617-5970-9e62-356c301a16bb"})[0].id
$wh   = (Invoke-RestMethod "http://localhost:8000/api/v1/warehouses?pageSize=1" -H @{"X-User-ID"="36a45099-c617-5970-9e62-356c301a16bb"})[0].id

# Bước 2: Chạy test 2 VU (baseline)
k6 run --vus 2 --duration 60s `
  -e PRODUCT_ID=$prod -e SUPPLIER_ID=$supp -e WAREHOUSE_ID=$wh `
  scripts/k6_load_test.js

# Bước 3: Chạy test 4 VU
k6 run --vus 4 --duration 60s `
  -e PRODUCT_ID=$prod -e SUPPLIER_ID=$supp -e WAREHOUSE_ID=$wh `
  scripts/k6_load_test.js

# Bước 4: Chạy test 8 VU
k6 run --vus 8 --duration 60s `
  -e PRODUCT_ID=$prod -e SUPPLIER_ID=$supp -e WAREHOUSE_ID=$wh `
  scripts/k6_load_test.js

# Bước 5: Chạy test 16 VU
k6 run --vus 16 --duration 60s `
  -e PRODUCT_ID=$prod -e SUPPLIER_ID=$supp -e WAREHOUSE_ID=$wh `
  scripts/k6_load_test.js

# Song song: Mở terminal khác để theo dõi tài nguyên
docker stats --no-stream
```

---

## 3. Kết quả đo tải

> [!NOTE]
> Chạy các lệnh k6 ở trên khi Docker Compose đang chạy và điền số liệu thực tế vào bảng.

### 3.1 Bảng kết quả Latency & Throughput

| Điểm quét (VU) | p50 (ms) | p95 (ms) | p99 (ms) | Throughput (req/s) | Error rate |
|---|---|---|---|---|---|
| **2 VU** (baseline) | — | — | — | — | — |
| **4 VU** | — | — | — | — | — |
| **8 VU** | — | — | — | — | — |
| **16 VU** | — | — | — | — | — |

> **Cập nhật sau khi chạy k6** – paste số liệu từ output terminal.

### 3.2 Bảng tài nguyên container (docker stats)

Chạy `docker stats --no-stream` **trong khi** k6 đang load:

| Điểm quét (VU) | Backend CPU % | Backend MEM | Postgres CPU % | Postgres MEM |
|---|---|---|---|---|
| **2 VU** | — | — | — | — |
| **4 VU** | — | — | — | — |
| **8 VU** | — | — | — | — |
| **16 VU** | — | — | — | — |

---

## 4. Bảng ngoại suy năng lực

> Giả sử hệ thống **tuyến tính** ở dải thấp (< 50% CPU). Ngoại suy từ kết quả baseline 2 VU:

| Điểm quét | Throughput ước tính (req/s) | p95 Latency ước tính (ms) | CPU backend ước tính | Khả thi? |
|---|---|---|---|---|
| 2 _(thực đo)_ | — | — | — | ✅ Đã đo |
| 4 _(×2)_ | — × 2 | — | — × 2 | ⏳ Cần đo |
| 8 _(×4)_ | — × 4 | — ↑ (bottleneck DB) | — × 4 | ⏳ Cần đo |
| 16 _(×8)_ | — × 6–7 (saturate) | — ↑↑ | ~80–100% | ⚠️ Giới hạn |

> [!TIP]
> Điền số liệu thực tế sau khi chạy để ngoại suy chính xác. Nếu p95 > 500ms ở 8 VU, hệ thống đang tiến đến giới hạn – cần scale DB hoặc thêm connection pool.

---

## 5. Phân tích & Kết luận

### 5.1 Điểm nghẽn cổ chai dự kiến

| Thành phần | Giới hạn dự kiến | Lý do |
|---|---|---|
| **PostgreSQL** | ~8–10 VU | Single-node, không replica |
| **Backend Uvicorn** | ~16+ VU | Async FastAPI, chịu tải tốt |
| **Disk I/O** | Thấp | Docker volume local SSD |
| **RAM** | Không giới hạn sớm | Model nhẹ, ít object lớn |

### 5.2 Khuyến nghị mở rộng

| Quy mô | Giải pháp |
|---|---|
| ≤ 4 điểm quét | Current setup đủ dùng |
| 5–8 điểm quét | Thêm PgBouncer connection pooler |
| 9–16 điểm quét | Scale backend thành 2 replica + load balancer |
| > 16 điểm quét | Chuyển PostgreSQL sang managed DB (Cloud SQL, RDS) |

### 5.3 Kết luận tổng thể

| Tiêu chí | Mục tiêu | Kết quả thực tế |
|---|---|---|
| p95 latency ≤ 500ms @ 2 VU | ✅ | _(cập nhật)_ |
| Error rate < 1% | ✅ | _(cập nhật)_ |
| Throughput tăng tuyến tính 2→4 VU | ✅ | _(cập nhật)_ |
| Hệ thống chịu được 8 VU | ⏳ | _(cập nhật)_ |

---

## 6. Output thô k6

> Paste kết quả `k6 run` tại đây sau khi chạy:

### 2 VU – 60s (Baseline)
```
(Paste output k6 tại đây)
```

### 4 VU – 60s
```
(Paste output k6 tại đây)
```

### 8 VU – 60s
```
(Paste output k6 tại đây)
```

### 16 VU – 60s
```
(Paste output k6 tại đây)
```

---

## 7. Tái hiện

```powershell
# 1. Khởi động staging
cd C:\Users\long\OneDrive\Desktop\CNNT\Foundation
docker-compose up -d
Start-Sleep -Seconds 15

# 2. Cài k6 nếu chưa có
winget install k6 --source winget

# 3. Lấy UUID và chạy test
# (xem chi tiết Mục 2.3)
k6 run --vus 2 --duration 60s scripts/k6_load_test.js
```

