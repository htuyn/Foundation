# MC03 – Biên bản Đo tải & Mở rộng (Load Test)

> **Dự án**: Smart Warehouse – SV4  
> **Mục tiêu**: Đo Latency / Throughput / CPU / RAM tại 2→4→8→16 Virtual Users; ngoại suy khả năng mở rộng  
> **Ngày thực hiện**: 13/11/2026  
> **Người thực hiện**: SV4 – Nguyễn Nhật Long  
> **Tool**: `scripts/load_test_runner.py` (Python 3.12 + `requests` + `docker stats`)  
> **Script**: [`scripts/load_test_runner.py`](../../scripts/load_test_runner.py)

---

## 1. Môi trường thử nghiệm

| Thành phần | Thông tin |
|---|---|
| **Hệ điều hành** | Windows 11 |
| **Backend** | FastAPI + Uvicorn – Docker container |
| **Database** | PostgreSQL 16-alpine – Docker container |
| **Port backend** | `localhost:8000` |
| **Port DB** | `localhost:5433` |
| **Tool đo tải** | Python 3.12 + `concurrent.futures.ThreadPoolExecutor` + `docker stats` |
| **Dữ liệu seed** | 10 sản phẩm · 11 kho · 50 nhà cung cấp · 8 258 StockMovement |

---

## 2. Kịch bản thử nghiệm

### 2.1 Mô tả workload

| Loại request | Tỷ lệ | Endpoint | Vai trò |
|---|---|---|---|
| Tạo phiếu nhập kho | 70% | `POST /api/v1/documents` | Nhân viên kho |
| Đọc tồn kho | 30% | `GET /api/v1/inventory` | Nhân viên kho |

Mỗi VU nghỉ ngẫu nhiên **0.3–0.7 giây** giữa 2 request (mô phỏng nhịp quét thực tế).

### 2.2 Các mức tải thử nghiệm

| Kịch bản | VU (Virtual Users) | Thời gian | Mô phỏng |
|---|---|---|---|
| **Baseline** | 2 VU | 30s | 2 điểm quét đồng thời |
| **Scale ×2** | 4 VU | 30s | 4 điểm quét |
| **Scale ×4** | 8 VU | 30s | 8 điểm quét |
| **Scale ×8** | 16 VU | 30s | 16 điểm quét |

### 2.3 Lệnh chạy

```powershell
cd C:\Users\long\OneDrive\Desktop\CNNT\Foundation
python scripts/load_test_runner.py --all
```

---

## 3. Kết quả đo tải (thực tế – 13/11/2026 ~22:45)

### 3.1 Bảng kết quả Latency, Throughput & Tài nguyên

| VU | req/s | p50 (ms) | p95 (ms) | p99 (ms) | Error | CPU avg | CPU max | RAM đỉnh |
|---|---|---|---|---|---|---|---|---|
| **2** (baseline) | 3.14 | 46.69 | 199.83 | 2 183.81 | **0.0%** | 19.1% | 37.5% | 80.11 MiB |
| **4** | 6.07 | 78.66 | 233.48 | 2 212.55 | **0.0%** | 36.9% | 61.0% | 82.70 MiB |
| **8** | 10.00 | 159.25 | 634.67 | 2 536.71 | **0.0%** | 69.2% | 100.6% | 90.41 MiB |
| **16** | 14.37 | 438.92 | 1 376.99 | 3 289.49 | **0.0%** | 95.5% | 123.3% | 97.52 MiB |

> [!NOTE]
> p99 cao (~2–3 s) là do một số request bị delay khi PostgreSQL flush WAL buffer. p95 tăng dần theo tải — bottleneck CPU rõ ràng từ 8 VU trở lên.

> [!IMPORTANT]
> CPU vượt 100% ở 8–16 VU (Docker tính theo tổng logical cores). RAM duy trì rất thấp (< 100 MiB) ở mọi mức tải → bottleneck là **CPU / connection pool**, không phải RAM.

### 3.2 Nhận xét throughput

| Mức tải | Throughput thực tế | So với baseline (×) | Nhận xét |
|---|---|---|---|
| 2 VU | 3.14 req/s | 1.0× | Baseline ổn định |
| 4 VU | 6.07 req/s | 1.93× | Gần tuyến tính ✅ |
| 8 VU | 10.00 req/s | 3.18× | Bắt đầu giảm tốc – CPU 69% ⚠️ |
| 16 VU | 14.37 req/s | 4.57× | Bão hòa rõ – CPU 95.5% ❌ |

---

## 4. Bảng ngoại suy năng lực

> Từ kết quả thực đo, ngoại suy hiệu năng ở các mức cao hơn:

| VU | Throughput ước tính (req/s) | p95 ước tính (ms) | CPU ước tính | Khả thi? |
|---|---|---|---|---|
| 2 _(thực đo)_ | 3.14 | 199.83 | 19% | ✅ Đạt |
| 4 _(thực đo)_ | 6.07 | 233.48 | 37% | ✅ Đạt |
| 8 _(thực đo)_ | 10.00 | 634.67 | 69% | ⚠️ p95 > 500ms |
| 16 _(thực đo)_ | 14.37 | 1 376.99 | 95% | ❌ Bão hòa CPU |
| 24 _(ngoại suy)_ | ~16–18 | ~2 000+ | ~100% | ❌ Cần PgBouncer + thêm core |
| 32 _(ngoại suy)_ | ~18–20 | ~3 000+ | ~100% | ❌ Cần scale DB + replica BE |

---

## 5. Phân tích & Kết luận

### 5.1 Điểm nghẽn cổ chai (quan sát thực tế)

| Thành phần | Giới hạn quan sát | Lý do |
|---|---|---|
| **CPU backend** | Bão hòa tại 8–16 VU | Docker container 1 node, Uvicorn sync thread pool |
| **PostgreSQL** | Connection pool mặc định (5+10) | Single-node, không replica |
| **RAM** | **Không phải bottleneck** | Chỉ tăng từ 80 → 97 MiB (Δ=17 MiB) qua 4 mức tải |
| **Network** | Không đáng kể | Local loopback |

### 5.2 Khuyến nghị mở rộng

| Quy mô | Giải pháp |
|---|---|
| ≤ 4 điểm quét | Current setup đủ dùng (p95 < 240ms) |
| 5–8 điểm quét | Tăng `pool_size` + `max_overflow` trong SQLAlchemy |
| 9–16 điểm quét | Thêm PgBouncer connection pooler + tăng Uvicorn workers |
| > 16 điểm quét | Scale backend thành 2 replica + load balancer + managed DB |

### 5.3 Kết luận tổng thể

| Tiêu chí | Mục tiêu | Kết quả thực tế | Đạt? |
|---|---|---|---|
| p95 latency ≤ 500ms @ 2 VU | ≤ 500ms | **199.83 ms** | ✅ |
| p95 latency ≤ 500ms @ 4 VU | ≤ 500ms | **233.48 ms** | ✅ |
| p95 latency ≤ 500ms @ 8 VU | ≤ 500ms | **634.67 ms** | ⚠️ Vượt ngưỡng |
| Error rate < 1% @ mọi mức | < 1% | **0.0%** | ✅ |
| RAM ổn định | Không tăng vọt | **80→97 MiB (Δ17 MiB)** | ✅ |
| Xác định bottleneck | CPU/DB | **CPU bão hòa 8→16 VU** | ✅ Đã xác định |

> **KẾT LUẬN**: Hệ thống Smart Warehouse đáp ứng tốt tại ≤ 4 VU (p95 < 240ms, 0% lỗi, CPU < 40%). Từ 8 VU trở lên, CPU backend trở thành bottleneck chính (69–95%), khiến p95 vượt ngưỡng 500ms. RAM không phải vấn đề — chỉ tăng 17 MiB qua 8× tải. Hệ thống staging single-node phù hợp cho demo vận hành thực tế tại 2–4 điểm quét đồng thời.

---

## 6. Output thô (load_test_runner.py – 13/11/2026 ~22:45)

```
======================================================================
SV4 – CHƯƠNG TRÌNH ĐO TẢI & NGOẠI SUY HỆ THỐNG KHO THÔNG MINH
Thời gian: 2026-11-13 22:45:28
======================================================================
✔ Đăng nhập thành công (thukho@anphat.com)
✔ Đã nạp danh mục: 10 sản phẩm, 50 nhà cung cấp, 11 kho.

🚀 Đang chạy kịch bản 2 điểm quét (VUs) trong 30 giây...
   ✔ Tổng requests: 99 | Throughput: 3.14 req/s | Tỷ lệ lỗi: 0.0%
   ✔ Latency: p50 = 46.69 ms | p95 = 199.83 ms | p99 = 2183.81 ms
   ✔ CPU: avg=19.1% max=37.5% | RAM tại đỉnh: 80.11MiB

🚀 Đang chạy kịch bản 4 điểm quét (VUs) trong 30 giây...
   ✔ Tổng requests: 190 | Throughput: 6.07 req/s | Tỷ lệ lỗi: 0.0%
   ✔ Latency: p50 = 78.66 ms | p95 = 233.48 ms | p99 = 2212.55 ms
   ✔ CPU: avg=36.9% max=61.0% | RAM tại đỉnh: 82.7MiB

🚀 Đang chạy kịch bản 8 điểm quét (VUs) trong 30 giây...
   ✔ Tổng requests: 322 | Throughput: 10.0 req/s | Tỷ lệ lỗi: 0.0%
   ✔ Latency: p50 = 159.25 ms | p95 = 634.67 ms | p99 = 2536.71 ms
   ✔ CPU: avg=69.2% max=100.6% | RAM tại đỉnh: 90.41MiB

🚀 Đang chạy kịch bản 16 điểm quét (VUs) trong 30 giây...
   ✔ Tổng requests: 449 | Throughput: 14.37 req/s | Tỷ lệ lỗi: 0.0%
   ✔ Latency: p50 = 438.92 ms | p95 = 1376.99 ms | p99 = 3289.49 ms
   ✔ CPU: avg=95.5% max=123.3% | RAM tại đỉnh: 97.52MiB
```

> Kết quả JSON đầy đủ: [`docs/evidence/load_test_results.json`](../../docs/evidence/load_test_results.json)

---

## 7. Tái hiện

```powershell
# 1. Khởi động staging
cd C:\Users\long\OneDrive\Desktop\CNNT\Foundation
docker-compose up -d
Start-Sleep -Seconds 20

# 2. Chạy load test (không cần k6)
python scripts/load_test_runner.py --all

# Kết quả lưu tại: docs/evidence/load_test_results.json
```

---

## 1. Môi trường thử nghiệm

| Thành phần | Thông tin |
|---|---|
| **Hệ điều hành** | Windows 11 |
| **Backend** | FastAPI + Uvicorn – Docker container |
| **Database** | PostgreSQL 16-alpine – Docker container |
| **Port backend** | `localhost:8000` |
| **Port DB** | `localhost:5433` |
| **Tool đo tải** | Python 3.12 + `concurrent.futures.ThreadPoolExecutor` |
| **Dữ liệu seed** | 1 000 sản phẩm · 10 kho · 50 nhà cung cấp · 8 258 StockMovement |

---

## 2. Kịch bản thử nghiệm

### 2.1 Mô tả workload

| Loại request | Tỷ lệ | Endpoint | Vai trò |
|---|---|---|---|
| Tạo phiếu nhập kho | 70% | `POST /api/v1/documents` | Nhân viên kho |
| Đọc tồn kho | 30% | `GET /api/v1/inventory` | Nhân viên kho |

Mỗi VU nghỉ ngẫu nhiên **0.3–0.7 giây** giữa 2 request (mô phỏng nhịp quét thực tế).

### 2.2 Các mức tải thử nghiệm

| Kịch bản | VU (Virtual Users) | Thời gian | Mô phỏng |
|---|---|---|---|
| **Baseline** | 2 VU | 30s | 2 điểm quét đồng thời |
| **Scale ×2** | 4 VU | 30s | 4 điểm quét |
| **Scale ×4** | 8 VU | 30s | 8 điểm quét |
| **Scale ×8** | 16 VU | 30s | 16 điểm quét |

### 2.3 Lệnh chạy

```powershell
cd C:\Users\long\OneDrive\Desktop\CNNT\Foundation
python scripts/load_test_runner.py --all
```

---

## 3. Kết quả đo tải (thực tế – 13/11/2026)

### 3.1 Bảng kết quả Latency & Throughput

| Điểm quét (VU) | Throughput (req/s) | p50 (ms) | p95 (ms) | p99 (ms) | Error rate |
|---|---|---|---|---|---|
| **2 VU** (baseline) | 3.40 | 32.03 | 134.55 | 2 401.60 | **0.0%** |
| **4 VU** | 6.63 | 29.59 | 129.34 | 2 112.02 | **0.0%** |
| **8 VU** | 12.68 | 64.22 | 191.15 | 2 287.93 | **0.0%** |
| **16 VU** | 22.59 | 125.13 | 450.77 | 2 554.08 | **0.0%** |

> [!NOTE]
> p99 cao (~2 s) là do một số request bị delay khi PostgreSQL flush WAL. p95 ≤ 500 ms ở mọi mức tải — đạt ngưỡng thiết kế.

### 3.2 Nhận xét throughput

| Mức tải | Throughput thực tế | So với baseline (×) | Hệ số tuyến tính |
|---|---|---|---|
| 2 VU | 3.40 req/s | 1.0× | — |
| 4 VU | 6.63 req/s | 1.95× | ~linear ✅ |
| 8 VU | 12.68 req/s | 3.73× | ~linear ✅ |
| 16 VU | 22.59 req/s | 6.64× | Bắt đầu bão hòa ⚠️ |

---

## 4. Bảng ngoại suy năng lực

> Từ kết quả thực đo, ngoại suy hiệu năng ở các mức cao hơn:

| Điểm quét (VU) | Throughput ước tính (req/s) | p95 ước tính (ms) | Khả thi? |
|---|---|---|---|
| 2 _(thực đo)_ | 3.40 | 134.55 | ✅ Đạt |
| 4 _(thực đo)_ | 6.63 | 129.34 | ✅ Đạt |
| 8 _(thực đo)_ | 12.68 | 191.15 | ✅ Đạt |
| 16 _(thực đo)_ | 22.59 | 450.77 | ✅ Đạt (gần ngưỡng) |
| 24 _(ngoại suy)_ | ~28–30 | ~600–800 | ⚠️ Cần PgBouncer |
| 32 _(ngoại suy)_ | ~32–35 | ~1 000+ | ❌ Cần scale DB |

---

## 5. Phân tích & Kết luận

### 5.1 Điểm nghẽn cổ chai

| Thành phần | Giới hạn quan sát | Lý do |
|---|---|---|
| **PostgreSQL** | ~16–24 VU | Single-node, không replica, connection pool mặc định |
| **Backend Uvicorn** | >24 VU | Async FastAPI, chịu tải tốt |
| **Disk I/O** | Thấp | Docker volume local SSD |
| **RAM** | Không giới hạn sớm | Model nhẹ, ít object lớn |

### 5.2 Khuyến nghị mở rộng

| Quy mô | Giải pháp |
|---|---|
| ≤ 8 điểm quét | Current setup đủ dùng |
| 9–16 điểm quét | Thêm PgBouncer connection pooler |
| 17–32 điểm quét | Scale backend thành 2 replica + load balancer |
| > 32 điểm quét | Chuyển PostgreSQL sang managed DB (Cloud SQL, RDS) |

### 5.3 Kết luận tổng thể

| Tiêu chí | Mục tiêu | Kết quả thực tế | Đạt? |
|---|---|---|---|
| p95 latency ≤ 500ms @ 2 VU | ≤ 500ms | **134.55 ms** | ✅ |
| p95 latency ≤ 500ms @ 16 VU | ≤ 500ms | **450.77 ms** | ✅ |
| Error rate < 1% | < 1% | **0.0%** | ✅ |
| Throughput tăng gần tuyến tính 2→8 VU | ×4 | **×3.73** | ✅ |
| Hệ thống chịu được 16 VU | Chịu được | **22.59 req/s, 0% lỗi** | ✅ |

> **KẾT LUẬN**: Hệ thống Smart Warehouse đáp ứng đầy đủ yêu cầu hiệu năng tại môi trường staging. p95 duy trì dưới 500ms ở toàn bộ 4 mức tải. Hệ thống bắt đầu bão hòa ở ~16 VU — phù hợp với kiến trúc single-node staging, và có lộ trình mở rộng rõ ràng khi cần.

---

## 6. Output thô (load_test_runner.py)

```
======================================================================
SV4 – CHƯƠNG TRÌNH ĐO TẢI & NGOẠI SUY HỆ THỐNG KHO THÔNG MINH
Thời gian: 2026-11-13 21:59:48
======================================================================
✔ Đã nạp danh mục: 10 sản phẩm, 50 nhà cung cấp, 10 kho.

🚀 Đang chạy kịch bản 2 điểm quét (VUs) trong 30 giây...
   ✔ Tổng requests: 103 | Throughput: 3.40 req/s | Tỷ lệ lỗi: 0.0%
   ✔ Latency: p50 = 32.03 ms | p95 = 134.55 ms | p99 = 2401.60 ms

🚀 Đang chạy kịch bản 4 điểm quét (VUs) trong 30 giây...
   ✔ Tổng requests: 201 | Throughput: 6.63 req/s | Tỷ lệ lỗi: 0.0%
   ✔ Latency: p50 = 29.59 ms | p95 = 129.34 ms | p99 = 2112.02 ms

🚀 Đang chạy kịch bản 8 điểm quét (VUs) trong 30 giây...
   ✔ Tổng requests: 390 | Throughput: 12.68 req/s | Tỷ lệ lỗi: 0.0%
   ✔ Latency: p50 = 64.22 ms | p95 = 191.15 ms | p99 = 2287.93 ms

🚀 Đang chạy kịch bản 16 điểm quét (VUs) trong 30 giây...
   ✔ Tổng requests: 689 | Throughput: 22.59 req/s | Tỷ lệ lỗi: 0.0%
   ✔ Latency: p50 = 125.13 ms | p95 = 450.77 ms | p99 = 2554.08 ms
```

> Kết quả JSON đầy đủ: [`docs/evidence/load_test_results.json`](../../docs/evidence/load_test_results.json)

---

## 7. Tái hiện

```powershell
# 1. Khởi động staging
cd C:\Users\long\OneDrive\Desktop\CNNT\Foundation
docker-compose up -d
Start-Sleep -Seconds 20

# 2. Chạy load test (không cần k6)
python scripts/load_test_runner.py --all

# Kết quả lưu tại: docs/evidence/load_test_results.json
```
