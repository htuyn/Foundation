# SV2 – Báo cáo Thiết bị biên / Barcode, Offline Queue chịu lỗi và Khóa chống trùng

**Sinh viên phụ trách:** SV2  
**Ngày:** 2026-11-16  
**Trạng thái:** Đã triển khai source, unit/source-contract tests đạt; acceptance browser chưa xác minh.

---

## Chương 2.3 – Kiến trúc thiết bị biên mô phỏng

### 2.3.1 Mô hình thiết bị biên

Trong phạm vi đồ án, thiết bị quét được **mô phỏng bằng trình duyệt** (không phải phần cứng thật). Trình duyệt đóng vai handheld barcode scanner thông qua:

- **Camera API** (ZXing/`getUserMedia`) đọc EAN-13 từ vật lý
- **Nhập thủ công** EAN-13 trên bàn phím
- **Script `scanner_sim.mjs`** tạo gói tin chuẩn hóa và gửi API

> ⚠ **Lưu ý thuật ngữ:** Trong báo cáo gọi là "thiết bị biên mô phỏng" (simulated edge device). Khác biệt với máy quét phần cứng thật:
> - Phần cứng thật: firmware riêng, Wi-Fi/BLE native, không dùng browser
> - Mô phỏng: dùng `crypto.randomUUID`, `localStorage`, `fetch` của browser

### 2.3.2 Điểm quét VLAN 30 (CV01)

| Gate | Vị trí | Loại | VLAN | Subnet |
|------|--------|------|------|--------|
| GATE_A | Cổng Nhập A | IN → Nhập kho | 30 | 192.168.30.x |
| GATE_B | Cổng Xuất B | OUT → Xuất kho | 30 | 192.168.30.x |

Cấu hình VLAN 30 tương ứng với `docs/KhoHang_AnPhat.pkt` (Packet Tracer).

### 2.3.3 Hợp đồng gói tin (MC01)

Mỗi lần quét sinh một gói tin chuẩn hóa:

```json
{
  "idempotency_key":  "f172455a-ec9b-4741-8d9d-27150c93da90",
  "scan_event_id":    "b8db8a39-5f5e-4db4-a098-08b0664d6b52",
  "barcode":          "8938514907573",
  "quantity":         1,
  "type":             "IN",
  "scan_point":       "GATE_A",
  "client_timestamp": "2026-11-16T07:30:00.000+07:00",
  "user_id":          "be8a0907-fb73-4b67-9af0-12d8734e2160"
}
```

**Giải thích trường:**

| Trường | Vai trò |
|--------|---------|
| `idempotency_key` | UUID v4 sinh ngay lúc quét; bất biến khi retry/double-submit; gửi qua header `Idempotency-Key` |
| `scan_event_id` | UUID v4 riêng biệt; định danh sự kiện quét tại thiết bị (khác `idempotency_key`) |
| `barcode` | EAN-13 với check-digit hợp lệ |
| `type` | `IN`/`OUT` tại thiết bị → map sang `Nhập kho`/`Xuất kho` cho backend |
| `client_timestamp` | **Giờ quét tại kho** – đồng hồ thiết bị biên ghi |
| `user_id` | UUID người dùng đã xác thực |

**Phân biệt timestamp:**

```
client_timestamp = đồng hồ thiết bị biên (kho)
                   → ghi nhận khi sự kiện xảy ra
                   → có thể lệch nếu đồng hồ thiết bị không đồng bộ NTP

server_timestamp = createdAt trong response backend
                   → PostgreSQL ghi khi SV3 xử lý thành công
                   → là chuẩn pháp lý cho audit và báo cáo
                   → luôn dùng server_timestamp làm mốc thời gian chính thức
```

---

## Chương 3.1 – Offline Queue chịu lỗi (CV02)

### 3.1.1 Kiến trúc hàng đợi

```
[Thiết bị quét]
     │ Mỗi scan tạo idempotency_key UUID v4
     ↓
[LocalStorage FIFO Queue]  ← Primary store của thiết bị biên mô phỏng
     │ online event
     ↓
[Sync Loop]
     │ POST /documents + Idempotency-Key header
     ↓
[Backend SV3]
     │ → 2xx / 409 → xóa khỏi queue
     │ → 400 / 403 → Dead-Letter (cảnh báo thủ kho)
     │ → 401       → PAUSED_AUTH (giữ queue)
     └ → 5xx / net → RETRY_WAIT (exponential backoff)

[IndexedDB]  ← Hướng nâng cấp (đã có tại P04/P05)
```

### 3.1.2 Exponential Backoff

```
Lần thử 1: 1s   (+ jitter ≤ 250ms)
Lần thử 2: 2s   (+ jitter ≤ 500ms)
Lần thử 3: 4s   (+ jitter ≤ 1000ms)
Lần thử 4: 8s
Lần thử 5: 16s
Lần thử 6: 32s
Lần thử 7: 60s
Lần thử 8: 60s  ← tối đa; sau đó → Dead-Letter
```

### 3.1.3 Xử lý mã phản hồi

| HTTP | Code | Hành động | Lý do |
|------|------|-----------|-------|
| 2xx | — | Xóa khỏi queue; ghi `server_timestamp` | Thành công |
| 409 | `DUPLICATE_KEY` | Xóa khỏi queue | Idempotent – đã xử lý trước đó |
| 400 | `INSUFFICIENT_STOCK` | → Dead-Letter | Xuất vượt tồn; thủ kho cần xử lý thủ công |
| 400 | dữ liệu sai | → Dead-Letter | Dữ liệu không hợp lệ; không retry |
| 403 | sai quyền | → Dead-Letter | Tài khoản không có quyền; không retry |
| 401 | session hết hạn | PAUSED_AUTH; giữ queue | Yêu cầu đăng nhập lại |
| 5xx / network | — | RETRY_WAIT | Lỗi tạm thời; thử lại sau |

---

## Chương 3.2 – Bảng dung lượng (MC03)

### Đo kích thước bản ghi thực tế

Phương pháp: `JSON.stringify(packet).length × 2` (UTF-16 = 2 bytes/ký tự)

```json
Mẫu bản ghi tối thiểu (tất cả trường bắt buộc):
{
  "idempotency_key":  "f172455a-ec9b-4741-8d9d-27150c93da90",  → 36 ký tự
  "scan_event_id":    "b8db8a39-5f5e-4db4-a098-08b0664d6b52",  → 36 ký tự
  "barcode":          "8938514907573",                           → 13 ký tự
  "quantity":         1,                                          → 1 ký tự
  "type":             "IN",                                      → 2 ký tự
  "scan_point":       "GATE_A",                                  → 6 ký tự
  "client_timestamp": "2026-11-16T07:30:00.000+07:00",          → 25 ký tự
  "user_id":          "be8a0907-fb73-4b67-9af0-12d8734e2160",  → 36 ký tự
  "queued_at":        1731731400000,                             → 13 ký tự
  "attempt_count":    0,                                          → 1 ký tự
  "status":           "PENDING"                                  → 7 ký tự
}
```

**Tính toán:**

| Chỉ số | Giá trị |
|--------|---------|
| JSON text (ký tự) | ≈ 320 ký tự |
| UTF-16 bytes | ≈ 640 bytes |
| Overhead key localStorage | ≈ 100 bytes (key string × 2) |
| **Thực tế / bản ghi** | **≈ 740 bytes** |

### Bảng dung lượng

| Chỉ số | Giá trị | Ghi chú |
|--------|---------|---------|
| LocalStorage quota (per origin) | 5 MB = 5,242,880 bytes | Giới hạn hầu hết trình duyệt |
| UTF-16: ký tự tối đa | 2,621,440 ký tự | 1 char = 2 bytes |
| Bytes/bản ghi (thực đo) | ≈ 740 bytes | Bao gồm key overhead |
| **Lượt quét tối đa offline** | **≈ 7,084 lượt** | 5,242,880 / 740 |
| Ngưỡng cảnh báo 80% | ≈ 5,667 lượt | Hiển thị banner cảnh báo |
| Thực tế (do UTF-16) | ≈ 3,500–7,000 lượt | Phụ thuộc nội dung trường |

> **Chú thích quan trọng:** LocalStorage thực tế có thể chỉ bằng **50%** số lượng ký tự vì UTF-16 (mỗi ký tự Unicode = 2 bytes). Nếu barcode có nhiều ký tự Unicode hoặc note dài, số lượt giảm.

### Hướng nâng cấp

| Giải pháp | Quota | Phù hợp |
|-----------|-------|---------|
| LocalStorage | ~5 MB/origin (cứng) | Thiết bị biên mô phỏng, demo |
| IndexedDB | Quota hệ thống (không cứng) | Sản xuất, hàng đợi lớn |
| SQLite (native app) | Toàn bộ disk | Phần cứng thật |

**IndexedDB đã được triển khai** tại `gateQueueStore.ts` (P04/P05) với FIFO queueOrder, migration atomicity và Web Locks.

---

## Chương 5 – Số liệu giới hạn LocalStorage

```
Quota:            5,242,880 bytes (~5 MB)
Bytes/record:     ~740 bytes (đo: JSON.stringify × 2 + key overhead)
Max records:      ~7,084 lượt quét
Warning at 80%:   ~5,667 lượt
Practical limit:  ~3,500–7,000 lượt (phụ thuộc nội dung)

Với IndexedDB:    Không giới hạn cứng (quota hệ thống, thường ≥ 10% disk)
```

---

## Minh chứng (MC01, MC02, MC03)

### MC01 – Hợp đồng gói tin và mã nguồn scanner_sim

- **Hợp đồng:** `docs/api-contract.md` → mục "SV2 – Gói tin thiết bị biên"
- **Mã nguồn simulator:** `scripts/scanner_sim.mjs`
- **JSON thực tế:** Chạy `node scripts/scanner_sim.mjs --gate A --dry-run` để xem gói tin mẫu
- **Source contract tests:** `tests/vercel-routing.test.mjs` → test "CV01: scanner_sim produces normalized packet"

### MC02 – LocalStorage khi ngắt mạng, log đồng bộ, Dead-Letter

- **Offline queue:** `src/features/scanner/offlineQueueLocalStorage.ts`
- **IndexedDB queue (nâng cao):** `src/features/scanner/gateQueueStore.ts`
- **Sync logic:** `src/features/scanner/gateTransactions.ts`
- **UI Dead-Letter:** `GateScannerDialog.tsx` → panel "Dead-Letter"
- **Minh chứng thủ công:**
  1. Mở DevTools → Application → LocalStorage
  2. Mở Network → chọn Offline
  3. Quét vài EAN-13 → quan sát queue trong UI
  4. Bỏ Offline → quan sát tự đồng bộ
  5. Mở Dead-Letter panel để xem nhật ký lỗi

### MC03 – Bảng dung lượng và KT1/KT2

- **Bảng dung lượng:** Xem Chương 5 bên trên; source tại `offlineQueueLocalStorage.ts` → `computeCapacityTable()`
- **KT1 (quét thật):** Nút "Mở camera (KT1)" trong GateScannerDialog → quét EAN-13 vật lý hoặc nhập tay
- **KT2 (double-submit):** Submit thủ công 2 lần trong 500ms → guard `isManualDoubleClick` chặn; kiểm tra `idempotencyKey` không đổi
- **Source contract tests:** `tests/vercel-routing.test.mjs` → test "CV03 KT1" và "CV03 KT2"

---

## Khi bảo vệ

1. **Quét bằng Camera/nhập EAN-13:** Nút "Mở camera (KT1)" hoặc form nhập thủ công
2. **Bật Offline trong DevTools:** Network tab → Offline → quét → quan sát "Mất kết nối mạng" và queue lưu
3. **Bật Online:** Quan sát đồng bộ tự động, trạng thái chuyển PENDING → SYNCING → SYNCED
4. **Bấm đúp:** Nút "Tạo giao dịch" 2 lần nhanh → thông báo "đã nhận trước đó"
5. **Mở LocalStorage:** DevTools → Application → Local Storage → xem key `sv2-edge-queue-v1:*`
6. **Mở Dead-Letter panel:** Nút "Dead-Letter" trong GateScannerDialog
7. **Giải thích:**
   - `idempotency_key` giữ nguyên để tránh tạo phiếu trùng khi retry
   - `server_timestamp` là chuẩn pháp lý vì đồng hồ thiết bị biên có thể lệch

---

## File thay đổi trong SV2

| File | Mô tả |
|------|-------|
| `scripts/scanner_sim.mjs` | Script giả lập thiết bị biên; sinh gói tin EAN-13 chuẩn hóa |
| `src/features/scanner/offlineQueueLocalStorage.ts` | LocalStorage FIFO queue; response handling; capacity table; export |
| `src/features/scanner/GateScannerDialog.tsx` | UI: offline indicator; dead-letter panel; capacity warning; export |
| `docs/api-contract.md` | Hợp đồng gói tin SV2; bảng response handling; timestamp phân biệt |
| `tests/vercel-routing.test.mjs` | Tests CV01/CV02/CV03 KT1/KT2 source-contract |
| `.memory-bank/activeContext.md` | Cập nhật trạng thái |
| `.memory-bank/progress.md` | Ghi nhận SV2 hoàn thiện |

## Giới hạn và chưa xác minh

- Chưa chạy `scanner_sim.mjs` với backend thật (cần Node.js và API đang chạy)
- Chưa test camera và DevTools Offline trên browser thật
- Chưa phối hợp với SV1 tắt Access Point trong .pkt để tạo offline thật
- LocalStorage quota thực tế phụ thuộc trình duyệt và hệ điều hành
- Acceptance browser persistence tests chưa chạy (P05 blocker còn mở)
