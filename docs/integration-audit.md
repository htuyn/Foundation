# Báo cáo audit tích hợp Frontend ↔ FastAPI ↔ PostgreSQL

**Ngày kiểm tra:** 2026-10-10  
**Phạm vi:** rà soát source/config, kiểm tra frontend/API, PostgreSQL thật, migration hiện có, round-trip CRUD/phiếu/scanner bằng integration tests rollback, frontend build và Docker Compose config.

## Cách phân loại

- **PASS** — hợp đồng/field khớp qua source tĩnh; không tự hàm ý API đang chạy hay DB đã xác minh.
- **MISMATCH** — contract, hiển thị hoặc thao tác frontend/backend có khác biệt cụ thể.
- **MISSING** — chức năng cần thiết chưa có.
- **UNVERIFIED** — có code nhưng không thể xác minh runtime hoặc database trong lượt audit.

## Kết luận nhanh

| Hạng mục | Kết quả |
|---|---|
| Frontend/API payload CRUD | **PASS:** `WarehouseContext` gọi bootstrap, CRUD, điều chỉnh tồn và phiếu; sản phẩm có sequence SKU + barcode conflict handling; phiếu nhập liên kết supplier ID. PostgreSQL integration tests rollback bao phủ các luồng này. |
| Kiểu dữ liệu cốt lõi | **PASS một phần:** camelCase, enum nghiệp vụ, bootstrap và signed adjustment tương thích; email format chưa được server validate. |
| Tìm kiếm/lọc/phân trang | **MISMATCH:** UI thực hiện trên snapshot client; endpoint có giới hạn/query riêng không được dùng. Search `transactions` và `documents` không tìm cùng trường như UI. |
| Scanner smartphone từ xa | **PASS một phần:** QR được giữ như kết nối scanner từ xa; API integration xác minh tạo phiên, cấp/consume QR, join, scan idempotency, đọc event và đóng phiên. WebSocket và hai thiết bị thật chưa thử. Chỉ còn một CTA QR, không còn luồng phát scan demo giả. |
| FastAPI/PostgreSQL chạy được | **PASS:** Docker PostgreSQL healthy, backend chạy; Alembic ở `0003_normalize_product_ids (head)` và `/health/ready` được xác minh sau migration. |
| API và nghiệp vụ đã test bằng PostgreSQL | **PASS:** 14 tests đạt trong container; test ghi dùng outer transaction rollback, không giữ dữ liệu thử. |
| Camera barcode trực tiếp | **PASS tĩnh/API, UNVERIFIED thiết bị:** ZXing dùng thật EAN-13/EAN-8/UPC-A/UPC-E/Code 128, camera sau ưu tiên, torch nếu hỗ trợ, trạng thái quyền/lỗi, cleanup và xác nhận khi thay barcode đang có; barcode preflight gọi `/products/lookup` và DB unique index vẫn chặn xung đột. Chưa thử camera trên thiết bị thật. |
| Supplier history | **PASS một phần:** phiếu nhập mới cần supplier ID; lịch sử nhập cũ giữ nguyên partner text, không tự động liên kết vì tên cũ không khớp. |

## Frontend hiện tại

### Stack, route và data source

- React + TypeScript + Vite; route ở `src/App.tsx` (dashboard, products, categories, warehouses, inbound/outbound, inventory, suppliers, transactions, users, reports, barcode, settings, audit logs và `/scanner/mobile`).
- Types dùng chung ở `src/types.ts`; seed demo ở `src/data/seed.ts` (24 sản phẩm, 2 kho cùng dữ liệu nghiệp vụ mẫu).
- `src/data/WarehouseContext.tsx` chọn API khi `VITE_API_BASE_URL` có giá trị. Khi bật API, gọi `GET {base}/bootstrap`, khởi tạo state rỗng trước khi tải và không ghi localStorage; nếu lỗi tải thì hiện lỗi/thử lại, không fallback sang seed.
- Khi không cấu hình biến trên, dùng seed và localStorage (`smart-warehouse-data-v1`). Các form/list vẫn gọi cùng Context nên có nhánh local demo và nhánh API.
- `src/features/scanner/scannerService.ts` có API client riêng; URL HTTP được tạo bằng cách ghép `VITE_API_BASE_URL` với `/scanner/...`. Giá trị phải có base path `/api/v1`, ví dụ `http://localhost:8000/api/v1`.

### Kiểu frontend và validation

| Nhóm | Dữ liệu frontend | Validation/enum quan sát được |
|---|---|---|
| Product | `id, sku, barcode, name, category, unit, cost:number, minStock:number, status, createdAt` | Form bắt buộc SKU/tên/category/cost; cost và minStock không âm; SKU uppercase ở form; barcode optional. Enum status: `Đang kinh doanh`, `Ngừng kinh doanh`. |
| Warehouse | `id, code, name, address, manager, status` | Form bắt buộc code/name/address/manager; status `Đang hoạt động`, `Tạm ngưng`. |
| Supplier | `id, code, name, phone, email, address, active:boolean` | Form yêu cầu phần lớn trường; email dùng input type email; `active` được map từ nhãn trạng thái. |
| UserRecord | `id, name, email, role, active, createdAt` | Email input type email; role `Quản trị viên`, `Quản lý kho`, `Nhân viên kho`; chỉ là bản ghi hiển thị. |
| InventoryItem | `productId, warehouseId, quantity:number, location` | Điều chỉnh dùng integer khác 0 và reason; không cho số dư âm trong local mode; API mode dựa vào backend. |
| WarehouseDocument | `id, code, type, warehouseId, partner, createdAt, status, note, lines[]` | `type`: `Nhập kho`/`Xuất kho`; line có `productId, quantity, unitCost`; UI yêu cầu ít nhất 1 line, quantity dương; draft mới được xác nhận/hủy. |
| Transaction | `id, code, type, productId, warehouseId, quantity, actor, createdAt, source` | type gồm nhập/xuất/điều chỉnh. UI hiện thêm dấu `−` chỉ cho xuất và `+` cho cả nhập lẫn điều chỉnh. |
| Scanner | `sessionId, mode, status, createdAt, expiresAt`; event có `eventId, sessionId, barcode, format, scannedAt, deviceId?` | Formats `EAN_13`, `EAN_8`, `UPC_A`, `UPC_E`, `CODE_128`, `QR_CODE`, `MANUAL`; eventId giữ khi retry. |

Các trang list đang lọc, sort và phân trang 10 dòng ở trình duyệt. Search/filter quan sát được gồm tên/SKU/barcode sản phẩm; tên/mã/kho/trạng thái phiếu; product/SKU/location/kho/trạng thái tồn; mã giao dịch/sản phẩm/SKU/actor; nhà cung cấp/user/category/kho. Không thấy API client riêng cho các trang; CRUD và bootstrap gọi từ `WarehouseContext`.

## Backend: endpoints đã khai báo trong source

Router nghiệp vụ được gắn prefix `/api/v1` tại `backend/app/main.py`. Bảng dưới mô tả contract đọc được từ router/schema, **không xác nhận server đang phục vụ endpoint**.

| Method + URL | Request/query | Response / hành vi |
|---|---|---|
| GET `/health` | — | `{status,service}`; không cần DB theo code. |
| GET `/health/ready` | — | `200 {status,database}` sau `SELECT 1`, nếu không `503 DATABASE_UNAVAILABLE`. |
| GET `/api/v1/bootstrap` | — | Snapshot `WarehouseState`: products, warehouses, inventory, documents, transactions, suppliers, users, categories (chuỗi tên), auditLogs. Không giới hạn phân trang. |
| GET `/api/v1/categories` | — | `{id,name}[]`. POST body `{name}` → 201 `{id,name}`; PATCH `/categories/by-name/{name}` body `{name}` đổi tên; DELETE cùng path → 204. |
| GET `/api/v1/products` | `q?`, `category?`, `page=1`, `pageSize=100` (1–500) | Product array. `q` tìm name/SKU/barcode, category lọc theo tên. |
| GET `/api/v1/products/{product_id}` | UUID path | Product hoặc 404. GET `/api/v1/products/lookup?code=` tìm SKU/barcode hoặc 404. |
| GET `/api/v1/products/next-sku` | — | SKU đề xuất qua sequence PostgreSQL; POST vẫn tự cấp SKU nếu client không gửi. |
| POST `/api/v1/products` | `name`, `category`, `cost` bắt buộc; `sku?`, `barcode?`, `unit?`, `minStock?`, `status?` | 201 Product. SKU và barcode trim-safe unique; barcode rỗng chuẩn hóa null. Duplicate trả 409 có mã lỗi theo trường. |
| PUT `/api/v1/products/{product_id}` | Cùng schema ProductInput (toàn bộ thông tin) | Product đã cập nhật hoặc 404/409. DELETE cùng path → 204; 409 nếu đã có movement/document history. |
| GET `/api/v1/warehouses` | — | Warehouse array. POST body `{code,name,address?,manager?,status?}` → 201; PUT `/{id}` nhận cùng body. Response dùng `manager`. |
| GET `/api/v1/suppliers` | — | Supplier array. POST `{code,name,phone?,email?,address?,active?}` → 201; PUT `/{id}`; DELETE `/{id}` → 204 hoặc 409 khi có phiếu nhập tham chiếu supplier ID hoặc legacy partner cùng tên. |
| GET `/api/v1/users` | — | UserRecord array. POST `{name,email,role?,active?}` → 201; PUT `/{id}`. Không có credential/login/auth. |
| GET `/api/v1/inventory` | `warehouseId?` UUID | `{productId,warehouseId,quantity,location}[]`; không có query tìm kiếm/trạng thái/phân trang. |
| POST `/api/v1/inventory/adjust` | `{productId:UUID,warehouseId:UUID,quantity:int!=0,reason}` | Movement `{id,code,type,productId,warehouseId,quantity,actor,createdAt,source}`; 404 reference hoặc 409 tồn âm. |
| GET `/api/v1/transactions` | `type?`, `q?`, `page=1`, `pageSize=100` (1–500) | Mảng movement được chiếu thành Transaction; adjustment có `quantity_delta` signed; nhập/xuất trả quantity dương. `q` tìm code/actor/source. |
| GET `/api/v1/documents` | `type?`, `status?`, `q?`, `page=1`, `pageSize=100` (1–500) | WarehouseDocument array; `q` tìm code/partner. GET `/{id}` trả một phiếu. |
| POST `/api/v1/documents` | Nhập: `{type,warehouseId,supplierId,note?,lines}`; xuất: `{type,warehouseId,partner,note?,lines}`; ít nhất 1 line, quantity >0, không lặp product | 201 draft Document; inbound supplier phải tồn tại/active, response có `supplierId`; không cập nhật tồn. |
| POST `/api/v1/documents/{id}/confirm` | Không body | Document; xác nhận lặp trên phiếu đã xác nhận trả lại document. Update tồn/movement/audit trong transaction; xuất vượt tồn trả 409. |
| POST `/api/v1/documents/{id}/cancel` | Không body | Document đã hủy; chỉ cho hủy draft, nếu khác trả 409. |
| POST `/api/v1/scanner/sessions` | Không body | 201 session + `ownerToken` trả một lần. |
| POST `/api/v1/scanner/sessions/{id}/qr` | Owner `Authorization: Bearer ...` | `{nonce,expiresAt}`; cấp mới revoke ticket chưa dùng. |
| GET `/api/v1/scanner/sessions/{id}` | Owner bearer | Session view; ghi expired nếu quá hạn. |
| POST `/api/v1/scanner/sessions/{id}/join` | `{qrNonce,deviceName}` | `{joined,deviceToken,message}`; nonce one-time; một thiết bị/phiên. |
| POST `/api/v1/scanner/sessions/{id}/scans` | Device bearer; `{eventId,sessionId,barcode,format,scannedAt,deviceId?}` | `{delivered,duplicate,event}`; idempotent theo eventId nếu nội dung khớp; không sửa tồn. |
| GET `/api/v1/scanner/sessions/{id}/scans` | Owner bearer | Event array theo thời gian. POST `/{id}/close` owner bearer → session ended. |
| WebSocket `/api/v1/ws/scanner/sessions/{id}` | Subprotocol `scanner.v1`, owner token là protocol kế tiếp | Broadcast scan event. Connection registry ở memory một process. |

### Schema/model/database

- `backend/app/schemas.py`: Pydantic v2, camelCase giữ theo frontend. `ProductInput.cost` Decimal (14,2), minStock ≥0; `DocumentLineInput.quantity >0`, unitCost ≥0; type/status/role/scan format là Literal. `ScannerEventInput.scannedAt` yêu cầu timezone-aware.
- `backend/app/models/entities.py`: categories, products, warehouses, suppliers, users, inventory, stock_documents, stock_document_items, stock_movements, audit_logs và scanner session/ticket/event. Có UUID, FK, check constraints, unique/index và `Numeric(14,2)`.
- Alembic hiện ở `0003_normalize_product_ids`: `0002` bổ sung SKU sequence + supplier FK, `0003` chuẩn hóa unique index sau preflight duplicate check. DB này có dữ liệu nghiệp vụ; phiếu nhập cũ không được tự động gắn supplier.
- `backend/app/db/session.py` dùng psycopg/SQLAlchemy, pool 5 + max overflow 10 + `pool_pre_ping`; request session được đóng trong dependency.
- Config CORS đọc `CORS_ORIGINS`, default chỉ gồm `localhost:5173`, `127.0.0.1:5173`, `localhost:4173`; credentials false. Root `.env.example` khai báo `VITE_API_BASE_URL=http://localhost:8000/api/v1` và các setting Docker; backend có `backend/.env.example` riêng.

## Bảng đối chiếu frontend ↔ backend

| Chức năng | Dữ liệu frontend cần | API backend hiện có | Trường không khớp | Trạng thái |
|---|---|---|---|---|
| Bootstrap/dashboard | `WarehouseState` đầy đủ; dashboard/report tính từ products, inventory, documents, transactions | `GET /bootstrap` trả đủ các key và serializer dùng camelCase | Snapshot không phân trang và không có summary riêng; report tiếp tục tính client-side | **PASS (field tĩnh), UNVERIFIED (DB/runtime)** |
| Sản phẩm CRUD | Product fields, category là string name, cost/minStock number; form gửi toàn bộ object | GET/POST/PUT/DELETE products; bootstrap là đường UI hiện dùng | barcode frontend luôn string, DB/schema cho null; adapter chuyển null ↔ `""` nên tương thích. Delete hiện await/catch lỗi | **PASS tĩnh; UNVERIFIED runtime** |
| SKU/barcode | tìm name/SKU/barcode; tra cứu để nhận diện, không đổi tồn | GET `/products/lookup?code=` và GET list có q | BarcodePage tra cứu trong bootstrap local state, không gọi lookup; không phải contract sai nhưng lookup endpoint không được frontend sử dụng | **PASS (dữ liệu), MISMATCH (đường tích hợp lookup)** |
| Danh mục | Frontend state `string[]`; create/rename/delete theo tên | Bootstrap trả string[]; GET categories lại trả `{id,name}[]`; CRUD by-name | Nếu đổi UI sang GET `/categories` trực tiếp sẽ lệch kiểu string[]; Context hiện chỉ dùng bootstrap và gửi rename đúng path đã encode | **PASS qua bootstrap; MISMATCH nếu dùng GET categories thay bootstrap** |
| Kho | `manager` string, address/status/code/name | GET/POST/PUT; serializer map `manager_name` ↔ `manager` | Không có: Context gửi đủ dữ liệu form và response bootstrap cùng shape | **PASS (static), UNVERIFIED (runtime)** |
| Nhà cung cấp | code/name/phone/email/address/active boolean | GET/POST/PUT/DELETE | Email UI có input type=email; backend giới hạn độ dài nhưng chưa validate format email; delete đã await/catch | **MISMATCH nhỏ (email validation)** |
| User records | name/email/role/active/createdAt; các role tiếng Việt | GET/POST/PUT; role Literal khớp | Email format backend chưa validate. Không có xác thực/phân quyền; đây là records, không phải tài khoản đăng nhập | **MISMATCH / MISSING auth** |
| Tồn kho/điều chỉnh | quantity integer; quantity delta signed, location; filters client-side | GET inventory chỉ warehouseId; POST adjustment `{productId,warehouseId,quantity,reason}`; transaction movement response | Adjustment payload khớp. UI adjustment validation trong form phụ thuộc HTML/number; request backend validate nonzero/integer. Không có API filters/search/page tương đương toàn bộ Inventory UI | **PASS (payload), MISMATCH (filter/pagination contract)** |
| Phiếu nhập/xuất | type, warehouseId, partner, note, lines; status; `createdAt` ISO | GET/POST/confirm/cancel; schema và enums khớp | UI search có thêm warehouse name, backend q chỉ code/partner; frontend filter/page 10 ở client trong khi API phân trang mặc định 100. UI submit không tự gắn Idempotency-Key; confirm endpoint có idempotent theo status/lock | **PASS (body/status), MISMATCH (query behavior), UNVERIFIED (transaction DB)** |
| Lịch sử giao dịch | quantity number, type enum, actor/source/date | GET `/transactions` type/q/page/pageSize; serializer signed adjustment, dương nhập/xuất | UI search dùng cả product name/SKU, backend q không join product. UI render `+` cho tất cả type trừ `Xuất kho`; adjustment âm vì vậy hiển thị dấu cộng kèm giá trị âm, không biểu diễn đúng delta | **MISMATCH** |
| Ngày giờ/giá | ngày dạng string parse bởi `Date`; tiền number | Serializer trả `isoformat()` và float từ Decimal; scanner trả `isoformat()` | Scanner schema từ chối datetime naive; `float` tương thích TS number nhưng không giữ chính xác decimal như kiểu chuỗi | **PASS cơ bản / giới hạn NUMERIC→number** |
| Phân trang/tìm kiếm | 10 rows/page và filters trong React trên state | Products/documents/transactions cung cấp q/filter/page/pageSize; inventory chỉ warehouseId; bootstrap trả toàn bộ | UI không gọi endpoints list có phân trang; dữ liệu đầy đủ tải cùng bootstrap. Semantics q transaction/document không tương đương UI search | **MISMATCH (scale và semantics)** |
| Lỗi HTTP/loading | API error message cần hiển thị; loading/empty/error state | API error `{error:{code,message,details}}`; validation 422, nghiệp vụ 404/409/410 | Bootstrap loading/error được xử lý. Các thao tác async được await phần lớn; ngoại lệ xóa product/supplier. UI chủ yếu hiển thị `message`, không trình bày field-level `details` từ 422 | **MISMATCH nhỏ** |
| Scanner smartphone | Session UUID/API mode, nonce, eventId, bearer, EAN/UPC/Code128/QR, ISO date; browser camera | Session/QR/join/scans/close + WS routes; enum khớp; HTTP/WS base path khớp `/api/v1` | Token module-memory mất khi reload; WebSocket broadcaster single process; smartphone cần host/CORS truy cập được | **PASS tĩnh, UNVERIFIED thiết bị/runtime** |
| Audit logs | `{id,message,createdAt,actor}` | Bootstrap `auditLogs`; serializers khớp | Actor hiện constant `Hệ thống`, không xác định user thật; một số UI text vẫn nói log cục bộ | **PASS (shape), MISMATCH (actor semantics/docs)** |
| Settings/basket | local alert threshold, temporary scan basket | Không có API tương ứng | Đây là cài đặt và state tạm, không cần persistence DB theo luồng hiện tại | **PASS (ngoài scope API)** |

## Những điểm không thể xác minh

1. Kiểm thử API/DB được thực hiện bằng TestClient trong Docker backend; không có kiểm thử giao diện trình duyệt end-to-end ở phiên này.
2. Scanner tests xác minh REST flow với PostgreSQL, nhưng chưa thực hiện handshake WebSocket hoặc xác minh camera/HTTPS trên điện thoại thật.
3. WebSocket broadcaster lưu kết nối trong bộ nhớ một tiến trình; triển khai nhiều worker cần cơ chế pub/sub dùng chung.

## Tài liệu chưa đồng bộ với source

- `docs/frontend-backend-mapping.md` và báo cáo audit được cập nhật sau khi thêm xóa kho an toàn và test CRUD/phiếu/scanner. Tiếp tục đồng bộ nếu thay đổi contract.

## Việc còn lại trước khi phát hành

1. **Chốt query scaling:** UI hiện lọc/sort/phân trang trên bootstrap snapshot; cân nhắc chuyển list qua server pagination và thống nhất search transaction/document.
2. **Validation:** kiểm tra format email ở backend; quyết định currency JSON contract (`number` hiện dùng hay decimal string).
3. **Scanner:** kiểm thử camera và WebSocket hai thiết bị qua HTTPS/WSS; bổ sung shared pub/sub nếu chạy nhiều backend workers.
4. **Bảo mật:** users hiện chỉ là bản ghi mô phỏng; cần authentication/authorization trước khi public API trên mạng không tin cậy.
5. **Browser E2E:** kiểm tra CRUD và các phản hồi 422/409 trực tiếp trên UI; test responsive/accessibility.
6. **Dữ liệu:** database hiện mới có schema; tạo dữ liệu nghiệp vụ chỉ theo thao tác được yêu cầu, không tự seed hoặc xóa dữ liệu.

## Files nguồn đã đối chiếu

- Frontend: `src/App.tsx`, `src/types.ts`, `src/data/seed.ts`, `src/data/WarehouseContext.tsx`, `src/pages/ProductsPage.tsx`, `src/pages/DocumentsPage.tsx`, `src/pages/InventoryPage.tsx`, `src/pages/TransactionsPage.tsx`, `src/pages/ManagementPages.tsx`, `src/pages/UtilityPages.tsx`, `src/features/scanner/types.ts`, `src/features/scanner/scannerService.ts`, `src/features/scanner/ScannerMobilePage.tsx`.
- Backend: `backend/app/main.py`, `backend/app/api/v1/api.py`, `backend/app/api/v1/endpoints/resources.py`, `backend/app/api/v1/endpoints/documents.py`, `backend/app/api/v1/endpoints/scanner.py`, `backend/app/schemas.py`, `backend/app/models/entities.py`, `backend/app/services/serialization.py`, `backend/app/core/config.py`, `backend/app/db/session.py`, `backend/alembic/versions/0001_initial_schema.py`, `backend/tests/test_contracts.py`.
- Cấu hình/tài liệu: `.env.example`, `backend/.env.example`, `docs/api-contract.md`, `docs/frontend-backend-mapping.md`, `docs/scanner-mobile.md`.
