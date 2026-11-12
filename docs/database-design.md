# Database Design

PostgreSQL is the source of truth when `VITE_API_BASE_URL` is configured. SQLAlchemy 2.x models are in `backend/app/models/entities.py`; Alembic revisions are in `backend/alembic/versions/`. Snake_case DB columns are adapted to the camelCase frontend model in `backend/app/services/serialization.py`.

## Tables and constraints

| Table | Key fields / constraints | Frontend mapping |
|---|---|---|
| `categories` | UUID PK; unique `lower(name)` | `WarehouseState.categories` names; product category FK |
| `products` | UUID PK, category FK RESTRICT, unique `lower(btrim(sku))`, partial unique `btrim(barcode)` for nonempty values, nonnegative cost/min_stock, status check | `Product`, maps `category_id` to category name and `min_stock` to `minStock`; optional SKU generation uses `product_sku_seq` |
| `warehouses` | UUID PK, unique `lower(code)`, status check | `Warehouse.manager` maps to `manager_name` text |
| `inventory` | Composite PK `(product_id, warehouse_id)`, nonnegative quantity, product/warehouse FKs RESTRICT | `InventoryItem` |
| `stock_documents` | UUID PK, unique code, type/status checks, warehouse and nullable supplier FKs RESTRICT; optional scanner gate/event/client timestamp and creator-user FK; unique `scan_event_id` | `WarehouseDocument`; GATE_A is inbound, GATE_B is outbound; scanner-created documents remain drafts until explicit confirmation |
| `stock_document_items` | Composite PK `(document_id, product_id)`, positive quantity, nonnegative unit cost | `DocumentLine` |
| `stock_movements` | UUID PK, signed nonzero `quantity_delta`, movement type check, product/warehouse/document-line references, time/product indexes | `Transaction`; output quantity maps to positive inbound/outbound and signed adjustment |
| `suppliers` | UUID PK, unique case-insensitive code | `Supplier`; deleting suppliers referenced by document FK or legacy inbound partner is blocked |
| `users` | UUID PK, unique case-insensitive email, role check, nullable password hash | Authenticated account and frontend `UserRecord`; role is resolved server-side |
| `audit_logs` | UUID PK, created-time index, actor, action, outcome, HTTP status and JSON details | `AuditRecord`; authenticated business requests attribute actor from request context |
| `idempotency_requests` | Idempotency key PK/UNIQUE, SHA-256 request fingerprint, original status/JSON response | Replays identical `POST /documents` requests without creating a second document |
| `scanner_sessions` | Owner/device token hashes, optional gate/owner user, expiry, status check | QR/device session; scanner capability tokens are separate from login auth |
| `scanner_qr_tickets` | Unique nonce hash, session FK, expiry/consumed/revoked timestamps | One-use scanner QR nonce; distinct from product barcode |
| `scan_events` | Client event UUID PK, session FK, optional gate/user/server timestamp, format check, session/time index | Scanner event; does not modify stock |

## Inventory transaction rules

- Confirming a stock document and changing inventory, inserting movements, changing document status and writing audit records occur in one PostgreSQL transaction.
- Outbound updates are conditional SQL decrements (`quantity >= requested`) to prevent concurrent oversell. Failure rolls back every line and movement.
- Reconfirming an already confirmed document returns its current state without duplicating movements.
- Document creation accepts an `Idempotency-Key`; its unique key and stored response commit atomically with the draft. Same-key/same-body retries replay; same-key/different-body returns 409.
- Adjustments require a nonzero signed integer and reason; insufficient quantity returns 400 `INSUFFICIENT_STOCK` and rolls back.
- Movements are immutable operational history by application behavior; correction should be a compensating adjustment/document rather than deleting history.
- Seed inventory and historical demo movements are not reconciled. Database initialization does not import demo data; opening balances must be explicitly decided before importing it.

## Operational notes and limits

- All timestamps use timezone-aware PostgreSQL `TIMESTAMPTZ` and are serialized with offsets.
- `NUMERIC(14,2)` stores cost; quantities are integers because frontend types use `number` for unit counts.
- Business API authentication/RBAC uses bearer access tokens and `auth_sessions`; scanner QR endpoints use their separate capability/session authentication. Production still requires TLS, secrets, exact CORS and rate limiting.
- API 400/403/409 rejections are persisted to Audit Log. Real person attribution requires the authentication integration to set a trusted request actor; current fallback is `Hệ thống`.
- Backup/restore scripts and staging procedure: `docs/postgres-backup-restore.md`. A staging restore has not been run from this workspace.
- Scanner WebSocket fan-out is in process and not suitable for multiple backend workers without shared pub/sub.
