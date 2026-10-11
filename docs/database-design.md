# Database Design

PostgreSQL is the source of truth when `VITE_API_BASE_URL` is configured. SQLAlchemy 2.x models are in `backend/app/models/entities.py`; Alembic revisions are in `backend/alembic/versions/`. Snake_case DB columns are adapted to the camelCase frontend model in `backend/app/services/serialization.py`.

## Tables and constraints

| Table | Key fields / constraints | Frontend mapping |
|---|---|---|
| `categories` | UUID PK; unique `lower(name)` | `WarehouseState.categories` names; product category FK |
| `products` | UUID PK, category FK RESTRICT, unique `lower(btrim(sku))`, partial unique `btrim(barcode)` for nonempty values, nonnegative cost/min_stock, status check | `Product`, maps `category_id` to category name and `min_stock` to `minStock`; optional SKU generation uses `product_sku_seq` |
| `warehouses` | UUID PK, unique `lower(code)`, status check | `Warehouse.manager` maps to `manager_name` text |
| `inventory` | Composite PK `(product_id, warehouse_id)`, nonnegative quantity, product/warehouse FKs RESTRICT | `InventoryItem` |
| `stock_documents` | UUID PK, unique code, type/status checks, warehouse and nullable supplier FKs RESTRICT; trigger requires supplier ID on inbound documents | `WarehouseDocument`; new inbound documents reference `suppliers.id`; legacy inbound rows remain unlinked and retain original `partner` |
| `stock_document_items` | Composite PK `(document_id, product_id)`, positive quantity, nonnegative unit cost | `DocumentLine` |
| `stock_movements` | UUID PK, signed nonzero `quantity_delta`, movement type check, product/warehouse/document-line references, time/product indexes | `Transaction`; output quantity maps to positive inbound/outbound and signed adjustment |
| `suppliers` | UUID PK, unique case-insensitive code | `Supplier`; deleting suppliers referenced by document FK or legacy inbound partner is blocked |
| `users` | UUID PK, unique case-insensitive email, frontend role check | `UserRecord` only; no password, auth, or authorization |
| `audit_logs` | UUID PK, created-time index, actor text | `AuditRecord`; actor currently system snapshot, not identity FK |
| `scanner_sessions` | Owner/device token hashes, expiry, status check | Future backend scanner session contract |
| `scanner_qr_tickets` | Unique nonce hash, session FK, expiry/consumed/revoked timestamps | One-use scanner QR nonce; distinct from product barcode |
| `scan_events` | Client event UUID PK, session FK, format check, session/time index | Scanner event; does not modify stock |

## Inventory transaction rules

- Confirming a stock document and changing inventory, inserting movements, changing document status and writing audit records occur in one PostgreSQL transaction.
- Outbound updates are conditional SQL decrements (`quantity >= requested`) to prevent concurrent oversell. Failure rolls back every line and movement.
- Reconfirming an already confirmed document returns its current state without duplicating movements.
- Adjustments require a nonzero signed integer and reason; insufficient quantity rolls back.
- Movements are immutable operational history by application behavior; correction should be a compensating adjustment/document rather than deleting history.
- Seed inventory and historical demo movements are not reconciled. Database initialization does not import demo data; opening balances must be explicitly decided before importing it.

## Operational notes and limits

- All timestamps use timezone-aware PostgreSQL `TIMESTAMPTZ` and are serialized with offsets.
- `NUMERIC(14,2)` stores cost; quantities are integers because frontend types use `number` for unit counts.
- No API authentication is implemented; database user accounts are presentation records only. Do not expose this development API to untrusted networks.
- Scanner WebSocket fan-out is in process and not suitable for multiple backend workers without shared pub/sub.
