# API Contract

Base URL: `http://localhost:8000/api/v1`. JSON responses use UTF-8, camelCase fields matching `src/types.ts`, UUIDs as strings and timestamps as ISO 8601 with timezone. Errors have the shape `{"error":{"code":"...","message":"...","details":null}}`. Validation returns HTTP 422; duplicate/stock conflicts return 409; missing records 404; scanner authorization 403/410. No authentication or actual role-based authorization is implemented; user endpoints store frontend account records only.

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
| POST `/documents` | Inbound: `{type:"Nhập kho",warehouseId,supplierId,note,lines:[{productId,quantity,unitCost}]}`. Outbound: `{type:"Xuất kho",warehouseId,partner,note,lines}`. | 201 draft Document. Inbound supplier ID must identify an active supplier; the server uses its canonical name. Outbound requires partner text. At least one line, positive quantity, no repeated product. Does not change inventory. Response includes nullable `supplierId`. |
| POST `/documents/{id}/confirm` | Empty body | Confirmed Document; stock update, movements, status and audit log share one transaction. Idempotent for an already confirmed document. Export uses conditional atomic decrement; insufficient stock returns 409 and rolls back all lines. |
| POST `/documents/{id}/cancel` | Empty body | Cancelled draft; confirmed documents cannot be cancelled through this endpoint. |
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
