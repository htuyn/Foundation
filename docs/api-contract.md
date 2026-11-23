# API Contract

Base URL: `http://localhost:8000/api/v1`. JSON responses use UTF-8, camelCase fields matching frontend types, UUIDs as strings and timestamps as ISO 8601 with timezone. Errors have the shape `{"error":{"code":"...","message":"...","details":null}}`. Validation returns HTTP 422; duplicate/stock conflicts return 409; missing records 404; scanner capability failures return 403/410. Warehouse business APIs require authenticated bearer access tokens and server-side RBAC. QR pairing/scanner event endpoints remain public at the HTTP auth layer and use session-scoped capability tokens; see `docs/authentication.md`.

## Health

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/health` | — | `{"status":"ok","service":"smart-warehouse-api"}` (process only) |
| GET | `/health/ready` | — | 200 when `SELECT 1` succeeds; 503 `DATABASE_UNAVAILABLE` otherwise |

## Warehouse domain

| Method / path | Request and query | Success response / behavior |
|---|---|---|
| GET `/bootstrap` | — | `WarehouseState`: `products`, `warehouses`, `inventory`, `documents`, `transactions`, `suppliers`, `users`, `categories` (string names), `auditLogs` |
| GET `/products` | Optional `q`, `category`, `page` (1+), `pageSize` (1–500; default 100) | Product array. `q` searches name/SKU/barcode. Current UI does client filtering after bootstrap. |
| GET `/products/{id}` | UUID path | Product |
| GET `/products/lookup?code=...` | Non-empty barcode or SKU | Product; read-only; 404 if unknown |
| GET `/products/next-sku` | — | `{sku}` suggestion from a PostgreSQL sequence; sequence values are unique, but suggestions are not reserved until a product is created |
| POST `/products` | Required `name`, `category`, `cost`; optional `sku`, `barcode`, `unit`, `minStock`, `status` | 201 Product. Omitted/blank SKU gets an `SP-######` sequence value. SKU comparison is case-insensitive after trimming; nonempty barcode is unique after trimming. Duplicate constraints return 409. Empty barcode becomes null. |
| PUT `/products/{id}` | Same full Product request | Updated Product |
| DELETE `/products/{id}` | UUID path | 204; 409 if referenced by document or movement |
| GET `/categories` | — | `{id,name}[]` |
| POST `/categories` | `{name}` | 201 `{id,name}` |
| PATCH `/categories/by-name/{name}` | `{name}` | Rename category and associated products through FK; returns `{id,name,previousName}` |
| DELETE `/categories/by-name/{name}` | URL-encoded current name | 204; 409 while products reference it |
| GET `/warehouses` | — | Warehouse array |
| POST `/warehouses` | `{code,name,address,manager,status}` | 201 Warehouse |
| PUT `/warehouses/{id}` | Same full request | Updated Warehouse |
| GET `/inventory` | Optional `warehouseId` | Inventory rows `{productId,warehouseId,quantity,location}` |
| POST `/inventory/adjust` | `{productId,warehouseId,quantity,reason}`; integer nonzero delta and nonempty reason | Movement record; stock and movement commit together; 409 if resulting stock would be negative |
| GET `/documents` | Optional `type`, `status`, `q`, `page`, `pageSize` | Document array; line objects use frontend field `lines` |
| GET `/documents/{id}` | UUID path | Document |
| POST `/documents` | Inbound: `{type:"Nhập kho",warehouseId,supplierId,note,lines:[{productId,quantity,unitCost}]}`. Outbound: `{type:"Xuất kho",warehouseId,partner,note,lines}`. Optional scanner metadata: `scanPoint` (`GATE_A` inbound, `GATE_B` outbound), `scanEventId` UUID and timezone-aware `clientTimestamp`. Optional `Idempotency-Key` header (1–255 chars). | 201 draft Document. Identical key/body retries replay the first response; key/body mismatch returns 409. Scanner submissions persist one draft per scan before sending from client; repeated `scanEventId` with identical authenticated user/context/body replays the matching draft, conflicting content returns 409 `SCAN_EVENT_ALREADY_PROCESSED`. Creator user is taken from authenticated `CurrentUser`. Creating a draft does not change inventory. |
| POST `/documents/{id}/confirm` | Empty body | Confirmed Document; stock update, movements, status and audit log share one transaction. Reconfirming an already confirmed document returns the existing document without changing stock. Export uses conditional atomic decrement; insufficient stock returns 400 `INSUFFICIENT_STOCK` and rolls back all lines. |
| POST `/documents/{id}/cancel` | Empty body | Cancelled draft; non-draft documents return 400 `DOCUMENT_NOT_DRAFT`. |

Rejected API requests with HTTP 400, 403, or 409 are written to `audit_logs` with action, result, status code and error code. Success and rejection records use trusted `request.state.actor_name` when an authentication integration sets it; otherwise actor defaults to `Hệ thống`. SV4's authentication middleware must set this value after verifying the principal; user records are not authentication.
| GET `/transactions` | Optional `type`, `q`, `page`, `pageSize` | Movement records; adjustment `quantity` is signed, inbound/outbound quantity is positive to match frontend. |
| GET/POST `/suppliers` | GET has no body; POST `{code,name,phone,email,address,active}` | Supplier array / 201 Supplier |
| PUT/DELETE `/suppliers/{id}` | PUT full supplier body; DELETE no body | Updated Supplier / 204; supplier records referenced by inbound history cannot be deleted |
| GET/POST `/users` | GET no body; POST `{name,email,role,active}` | User array / 201 UserRecord |
| PUT `/users/{id}` | Same full user body | Updated UserRecord; these rows are not credentials and confer no permissions |

## Smartphone scanner

Scanner QR is a backend-issued, short-lived, single-use nonce (60 seconds by default). Browser owner and mobile device receive separate random bearer tokens; only SHA-256 token hashes are stored. The QR contains the one-time pairing nonce, not the owner/device bearer tokens. Configure frontend `VITE_API_BASE_URL` to an API URL reachable from both desktop and phone and use an HTTPS-reachable frontend URL for camera access.

| Method / path | Authorization / request | Response / behavior |
|---|---|---|
| POST `/scanner/sessions` | None | 201 session view plus `ownerToken` (show only to creator). Session expires after configured TTL. |
| POST `/scanner/sessions/{id}/qr` | `Authorization: Bearer <ownerToken>` | `{nonce,expiresAt}`; issuing a fresh QR revokes earlier unconsumed tickets. |
| GET `/scanner/sessions/{id}` | Owner bearer | Session view; updates expired status |
| POST `/scanner/sessions/{id}/join` | `{qrNonce,deviceName}` | `{joined,deviceToken,message}`; valid nonce consumed once, only one device may join |
| POST `/scanner/sessions/{id}/scans` | Device bearer; `{eventId,sessionId,barcode,format,scannedAt,deviceId?}` | Legacy-compatible REST ingestion; duplicate event ID is idempotent only when contents match; no inventory mutation |
| GET `/scanner/sessions/{id}/scans` | Owner bearer | Events ordered by scan time |
| POST `/scanner/sessions/{id}/close` | Owner bearer | Ended session; revokes unconsumed tickets and device token |
| POST `/scanner/sessions/{id}/leave` | Device bearer | Ended session; revokes device token and unconsumed tickets |
| WebSocket `/api/v1/ws/scanner/sessions/{id}` | Subprotocols `scanner.v1`, `<ownerToken>` | Pushes join/status/scan events; only waiting/connected, unexpired sessions accepted; requires periodic `ping` |
| WebSocket `/api/v1/ws/scanner/sessions/{id}/device` | Subprotocols `scanner.device.v1`, `<deviceToken>` | Device sends `ping` or `{type:"scan",event:{...}}`; backend validates and stores idempotently, replies `scan_ack`, then pushes the event to the owner socket |

Scanner HTTP/WebSocket endpoints validate payloads and apply process-local rate limits. Accepted formats include EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, QR_CODE and MANUAL; PostgreSQL format constraint was expanded by Alembic revision `0004_scanner_code_39`. Desktop opens the owner WebSocket during the waiting state, reconnects with backoff, and fetches persisted events after reconnect; it does not poll session status. The in-process WebSocket broadcaster and rate limiter are single-process only. Horizontal scaling needs shared pub/sub and shared gateway rate limits; mobile camera and two-device behavior remain unverified in this environment.

SV2 gate scanner uses authenticated `POST /documents` rather than a new scanner transaction endpoint. Each accepted scan creates one draft document with a distinct `Idempotency-Key`; `scanEventId` is a separate scanner-event identifier. GATE_A maps only to inbound drafts and GATE_B only to outbound drafts. Warehouse/supplier/partner are selected in the scanner UI. Draft confirmation remains the only operation that changes inventory. Migration `0009_scanner_transaction_attribution` depends on workspace revision `0008_scanner_gate_attribution`.

## SV2 – Gói tin thiết bị biên (Edge Device Packet Contract)

Mỗi lần quét từ thiết bị biên mô phỏng (VLAN 30, trình duyệt đóng vai handheld scanner) gửi gói tin chuẩn hóa sau đây. Khóa idempotency được sinh **ngay lúc quét** và giữ nguyên khi retry, bấm đúp hay đồng bộ lại.

### Gói tin thiết bị biên → API (CV01)

| Trường | Kiểu | Bắt buộc | Mô tả |
|--------|------|----------|-------|
| `idempotency_key` | UUID v4 | ✓ | Khóa chống trùng; sinh tại thiết bị khi quét; bất biến khi retry. Gửi qua header `Idempotency-Key`. |
| `scan_event_id` | UUID v4 | ✓ | ID sự kiện quét riêng biệt; khác `idempotency_key`. |
| `barcode` | string EAN-13 | ✓ | 13 chữ số với check-digit hợp lệ. |
| `quantity` | integer ≥ 1 | ✓ | Số lượng mỗi lần quét. |
| `type` | `"IN"` \| `"OUT"` | ✓ | IN = Nhập kho (GATE_A); OUT = Xuất kho (GATE_B). |
| `scan_point` | `"GATE_A"` \| `"GATE_B"` | ✓ | Cổng quét vật lý. |
| `client_timestamp` | ISO 8601 + timezone | ✓ | **Giờ quét tại kho** (đồng hồ thiết bị biên). |
| `user_id` | UUID v4 | ✓ | UUID người dùng đã xác thực. |

> **Phân biệt timestamp:**
> - `client_timestamp` = thời điểm quét được ghi tại thiết bị biên (đồng hồ kho). Có thể lệch nếu đồng hồ thiết bị không đồng bộ NTP.
> - `server_timestamp` = `createdAt` trong response từ backend – thời điểm SV3 ghi vào PostgreSQL. **Đây là chuẩn pháp lý** cho audit, lịch sử và báo cáo.
> - `client_timestamp` chỉ dùng để trace độ trễ mạng và phân tích hoạt động tại thiết bị biên.

### Map gói tin → POST /documents

```json
{
  "type": "Nhập kho",
  "warehouseId": "<uuid>",
  "supplierId": "<uuid>",
  "note": "Scanner GATE_A · EAN-13 · 8938514907573",
  "scanPoint": "GATE_A",
  "scanEventId": "<uuid>",
  "clientTimestamp": "2026-11-16T07:30:00.000+07:00",
  "lines": [{ "productId": "<uuid>", "quantity": 1, "unitCost": 0 }]
}
```
Header: `Idempotency-Key: <idempotency_key UUID v4>`

### Xử lý phản hồi API (CV02)

| HTTP Status | Hành động tại client |
|-------------|----------------------|
| 2xx | Xóa khỏi hàng đợi, ghi `server_timestamp` từ `createdAt`. |
| 409 `DUPLICATE_KEY` | Xóa khỏi hàng đợi – coi là đã xử lý (idempotent). |
| 400 `INSUFFICIENT_STOCK` | → Dead-Letter; cảnh báo thủ kho; không retry. |
| 400 (dữ liệu sai), 403 | → Dead-Letter; cảnh báo thủ kho; không retry. |
| 401 | Giữ hàng đợi nguyên; yêu cầu đăng nhập lại (PAUSED_AUTH). |
| 5xx / lỗi mạng | Retry với exponential backoff: 1s → 2s → 4s → … → 60s (tối đa 8 lần). |

### Dung lượng LocalStorage (CV02 – Bảng thực đo)

```
Quota LocalStorage (per origin)   ≈ 5 MB = 5,242,880 bytes
UTF-16 encoding                   : 2 bytes / ký tự → 2,621,440 ký tự tối đa
Kích thước 1 bản ghi JSON         ≈ 320 ký tự → 640 bytes UTF-16 + ~100 bytes key
Kích thước thực tế/bản ghi        ≈ 740 bytes (đo: JSON.stringify.length × 2)
Lượt quét tối đa offline          ≈ 5,242,880 / 740 ≈ 7,084 lượt
Ngưỡng cảnh báo 80%               ≈ 5,667 lượt
Hướng nâng cấp                    IndexedDB (không giới hạn cứng; đã có tại P04/P05)
```

### Điểm quét VLAN 30 (CV01 – mô phỏng)

| Gate | Vị trí | Loại phiếu | VLAN |
|------|--------|-----------|------|
| GATE_A | Cổng Nhập A | Nhập kho (IN) | 30 |
| GATE_B | Cổng Xuất B | Xuất kho (OUT) | 30 |

> **Lưu ý thuật ngữ báo cáo:** Trình duyệt chỉ mô phỏng thiết bị cầm tay; trong báo cáo gọi là "thiết bị biên mô phỏng" (simulated edge device) và nêu rõ sự khác biệt với máy quét phần cứng thật (phần cứng thật có firmware, BLE/Wi-Fi riêng, không phụ thuộc browser APIs như `crypto.randomUUID` hoặc `localStorage`).
