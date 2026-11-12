# P02 – Integration Readiness & Blocker Resolution

**Ngày audit:** 2026-11-12  
**Phạm vi:** đối chiếu source hiện tại cho tích hợp SV2 scanner transaction với SV3 API/database và SV4 auth/RBAC. Đây là audit, không triển khai scanner và không thay đổi API/database.  
**Kết luận:** **NOT READY** cho tích hợp/runtime acceptance. Source contract phần lớn khớp theo hướng additive, nhưng có blocker bảo mật idempotency theo user, contract chưa được SV3/SV4 chốt, DB hiện tại không được xác minh là test/staging, các PostgreSQL tests đang skip và không có backend runtime để chứng minh ghi dữ liệu.

## 1. API Contract Gap Report

### 1.1 Request/response và mapping SV2 → API

Endpoint là `POST /api/v1/documents`, trong `backend/app/api/v1/endpoints/documents.py`; request dùng `DocumentInput` trong `backend/app/schemas.py`. `POST` trả HTTP 201. Không khai báo `response_model`, vì vậy OpenAPI hiện không mô tả response field-level một cách đầy đủ; response thực tế được tạo bởi `document_dict()`.

| Ý nghĩa giao dịch SV2 | Frontend/queue | HTTP/API hiện tại | Database/persistence | Đánh giá |
|---|---|---|---|---|
| Idempotency của request | `idempotencyKey`, UUID v4 | Header `Idempotency-Key`, 1–255 ký tự | `idempotency_requests.idempotency_key` PK/UNIQUE; hash body và JSON response | Tên và header đúng; bảng chưa gắn key với authenticated user (**blocker bảo mật**) |
| Định danh scan event | `scanEventId`, thường lấy từ QR event `eventId` hoặc UUID riêng cho camera/manual | Body `scanEventId: UUID \| null` | `stock_documents.scan_event_id`, nullable UNIQUE | Phân biệt với idempotency key; uniqueness hiện global, không theo session/user |
| Gate / hướng nghiệp vụ | `scanPoint: GATE_A \| GATE_B`; frontend map A→IN, B→OUT | Optional Literal; gate/type mismatch bị 422; gate yêu cầu `scanEventId` | Nullable text với check gate và gate/type trong revision 0009 | Additive, tương thích request client cũ; cần SV3 chốt enum và semantics |
| Loại phiếu | `type: Nhập kho \| Xuất kho` | Required Literal | `stock_documents.type` + CHECK | Khớp |
| Kho | `warehouseId` | Required UUID; 404 nếu không tồn tại | `warehouse_id` FK RESTRICT | Khớp; chưa kiểm tra runtime |
| Supplier / người nhận | IN gửi `supplierId` và `partner`; OUT gửi `partner` | IN yêu cầu `supplierId`, supplier phải active; OUT yêu cầu partner và cấm `supplierId` | FK supplier và `partner` text | Khớp với nghiệp vụ đã chọn; SV3 cần chấp thuận form một-scan/một-draft |
| Dòng sản phẩm | `lines[{productId,quantity,unitCost}]`; một barcode tạo một line | Tối thiểu 1, tối đa 500; product UUID, quantity > 0, cost ≥ 0; product không tồn tại → 422 `PRODUCT_NOT_FOUND` | `stock_document_items`; product FK; quantity/cost CHECK | Khớp; backend cấm trùng product trong cùng phiếu |
| Client time | `clientTimestamp` | Optional timezone-aware datetime; naive datetime bị 422 | `client_timestamp` timestamptz nullable | Được lưu nhưng là thời gian thiết bị, không được dùng như thời gian chuẩn server |
| Server time | Không gửi | Response field `createdAt` | `stock_documents.created_at`, server default `now()` | Đã có timestamp server; contract cần gọi rõ `createdAt` là canonical server-created time |
| Người tạo | Không gửi user ID; frontend queue partition theo `user.id` | Backend lấy `CurrentUser` từ bearer session | `created_by_user_id` FK `users`, nullable, `ON DELETE SET NULL` | Không tin user ID từ client; đúng hướng. Trường nullable để hỗ trợ phiếu cũ/xóa user |
| Response phiếu | Client hiện chỉ cần `{id}` khi gửi xong | Thực tế: `id,code,type,warehouseId,scanPoint,scanEventId,clientTimestamp,createdByUserId,supplierId,partner,createdAt,status,note,lines` | Serialize từ `stock_documents` và items | Thiếu response schema có version/typed OpenAPI; response có thêm metadata additive |
| Tồn kho | Không đổi lúc scan | POST tạo `Bản nháp`; chỉ `/documents/{id}/confirm` cập nhật tồn | Confirm, movements, status và audit nằm trong cùng DB transaction | Đúng quyết định nghiệp vụ; chưa chạy integration trên PostgreSQL |

### 1.2 Validation, auth/RBAC và errors

- **Validation:** `type` chỉ nhận Nhập/Xuất; IN bắt buộc supplier; OUT bắt buộc partner và không nhận supplier; scanner gate khớp hướng; scanner gate yêu cầu `scanEventId`; `clientTimestamp` phải có timezone. Pydantic/FastAPI trả HTTP 422 với `VALIDATION_ERROR` và danh sách field/message. Product không tồn tại trả 422 `PRODUCT_NOT_FOUND`; kho/supplier không tồn tại 404; supplier inactive 400.
- **Authentication:** dependency `CurrentUser` dùng bearer access token, xác minh chữ ký, session còn hiệu lực và user active qua DB. `X-User-Id` không được tin cậy. Các test auth có kiểm thử missing/forged header, valid token, session revoke.
- **Authorization:** `require_permission` áp role theo HTTP method: viewer chỉ GET; nhân viên kho không DELETE; admin/quản lý có DELETE. Các route quản trị user/password còn có `require_admin`. Confirm/cancel là POST nên hiện các role write được phép; chưa có authorization chuyên biệt theo kho/gate/document ownership.
- **Duplicate/idempotency:** cùng `Idempotency-Key` + cùng payload trả response đầu; cùng key + payload khác trả 409 `IDEMPOTENCY_KEY_DUPLICATE`. Cùng `scanEventId` + nội dung/user giống trả draft cũ; khác nội dung/user trả 409 `SCAN_EVENT_ALREADY_PROCESSED`. Cả hai response replay vẫn HTTP 201. DB advisory lock tuần tự hóa scan event; UNIQUE `scan_event_id` là lớp bảo vệ cuối.
- **Error envelope:** lỗi nghiệp vụ dạng `{"error":{"code":"...","message":"...","details":...}}`; lỗi Starlette thành `HTTP_ERROR`; validation thành `VALIDATION_ERROR`. Request validation 422 không nằm trong nhóm status được ghi audit rejection. Các lỗi DB/500 không có bằng chứng runtime trong audit này.
- **Audit:** create/replay/confirm/cancel ghi audit trong cùng dependency transaction; lỗi 400/403/409 ghi rejection qua error handler sau rollback. `CurrentUser` set actor name từ principal. Lỗi audit được nuốt để không thay response gốc; do đó không có bảo đảm audit ghi được nếu DB/audit insert lỗi.

### 1.3 API blocker nghiêm trọng

**P1 – Idempotency không gắn với principal.** `idempotency_requests` có PK toàn cục chỉ là `idempotency_key`; request hash chỉ chứa body, không chứa `user.id`. Nhánh replay trả `response_json` mà không kiểm tra owner. Hai user có thể dùng cùng key và cùng body (cố ý hoặc client key collision) để user sau nhận response phiếu đã được tạo bởi user trước, đồng thời response attribution không còn khớp actor retry. UUID v4 làm collision tình cờ rất khó nhưng không giải quyết việc client có thể gửi lại key. Các document hiện được chia sẻ theo role (không có owner filter ở GET/confirm), nên đây là blocker về isolation/integrity và attribution; không khẳng định đây tự thân là quyền đọc trái phép dưới RBAC hiện tại.

**Khuyến nghị để SV3/SV4 quyết định, chưa sửa trong P02:** scope idempotency theo authenticated user (ví dụ unique composite `(user_id, idempotency_key)` hoặc khóa biểu diễn principal + key), lưu user ID/owner trên record, xác định hành vi migration cho record cũ và kiểm thử hai principal. Không xóa/đổi header hiện có; cần chốt response khi key của principal khác được gửi.

### 1.4 Tương thích ngược và quyết định contract cần SV3/SV4

- Request metadata mới optional; client cũ không gửi metadata vẫn đáp ứng schema cũ và phiếu thường vẫn hoạt động. Response thêm JSON fields, thông thường additive với client bỏ qua field không biết; tuy nhiên cần kiểm tra consumer có strict schema hay không.
- Không đổi/xóa tên field cũ. `scanEventId` không thay `Idempotency-Key`; `clientTimestamp` không thay `createdAt`.
- Contract cần bổ sung schema response chính thức, status/error table đầy đủ và quy định server-time field. SV3/SV4 cần xác nhận gate direction, auth requirement, roles được scan/tạo/confirm, ownership của draft và semantics replay.
- `docs/api-contract.md` còn câu cũ rằng audit actor cần SV4 gắn và `docs/SV4_RBAC_baocao_cho_SV3.md` mô tả `X-User-Id`/bootstrap public. Các câu này **không khớp source mới**: source dùng bearer session; bootstrap được bảo vệ. Đây là mismatch tài liệu, không phải hành vi code hiện tại.

## 2. Database Migration Report

### 2.1 Alembic source state

- `python -m alembic history --verbose` (không kết nối DB) xác nhận source head là `0009_scanner_transaction_attribution`.
- Chain: `0001` → `0002` → `0003` → `0004`; hai nhánh `0005_rbac_viewer_role` và `0005_idempotency_audit` được merge tại `0006`; tiếp tục `0007_user_auth_sessions` → `0008_scanner_gate_attribution` → `0009_scanner_transaction_attribution`.
- `0009` thêm bốn cột nullable cho `stock_documents`: `scan_point`, `scan_event_id`, `client_timestamp`, `created_by_user_id`; FK user `SET NULL`; UNIQUE scan event; CHECK gate hợp lệ và đúng hướng document.
- `0008` thêm gate/user/server timestamp trên scanner sessions/events và attribution; file này vốn đã là thay đổi chưa commit trước P01. Cả `0008` và `0009` hiện là file untracked theo workspace status; cần bảo đảm chúng được đưa vào artifact/review migration trước deploy.
- Offline SQL đến 0009 đã được chạy ở P01 thành công với UTF-8. Đây chỉ chứng minh Alembic dựng được SQL, không chứng minh migration áp dụng thành công hay schema thực tế đồng bộ.

### 2.2 Alembic current và trạng thái áp dụng

**Không chạy `alembic current`, không chạy upgrade/downgrade và không kết nối DB.** Cấu hình đang trỏ tới `localhost:5432/warehouse_db`, `APP_ENV=development`; PostgreSQL đang lắng nghe cổng 5432 nhưng tiến trình/DB chưa được xác nhận là test hoặc staging được phép. `RUN_POSTGRES_INTEGRATION_TESTS` chưa đặt. Vì yêu cầu P02 giới hạn thao tác vào test/staging, không đủ căn cứ để truy vấn version table.

Do đó:
- **Alembic source head:** đã biết là 0009.
- **Alembic current tại DB:** chưa biết.
- **0008/0009 đã áp dụng chưa:** chưa xác minh; Memory Bank ghi chưa áp migration thật.
- **Production:** không được truy cập/thay đổi.

### 2.3 Constraints, idempotency, audit và transaction

- `stock_documents.code` unique; `scan_event_id` unique ở migration 0009; `idempotency_requests.idempotency_key` PK/UNIQUE ở 0005. Request idempotency persistence lưu hash, response status/json và timestamp; không có TTL/cleanup trong code được rà soát.
- Create document, items, audit log và idempotency response dùng cùng SQLAlchemy request transaction; dependency `get_db` commit khi endpoint thành công, rollback khi lỗi. Tạo draft không viết inventory.
- Confirm lock document; nhập dùng upsert tồn; xuất dùng conditional decrement; movements, status và audit được thêm trong cùng transaction. Nếu thiếu tồn, raise lỗi và dependency rollback toàn bộ.
- Đây là phân tích source, chưa có quan sát database row/transaction runtime.

## 3. PostgreSQL Test Investigation

- Toàn bộ **7 skipped tests** ở `backend/tests/test_products_postgres.py` có cùng điều kiện: `RUN_POSTGRES_INTEGRATION_TESTS != "1"`. Lý do skip được ghi trực tiếp là cần bật flag để chạy PostgreSQL.
- Tests đã collect được 7 test; đây không phải lỗi fixture hoặc pytest collection. Không có kiểm tra tự động “DB là test/staging” trước khi test kết nối.
- Cờ môi trường hiện unset. Config backend đọc `.env`, giá trị target đã kiểm tra không lộ credential: `postgresql+psycopg`, `localhost:5432`, database `warehouse_db`, `APP_ENV=development`. Một process `postgres` đang listen trên 5432 nhưng nguồn gốc/role của DB chưa được xác nhận. Vì vậy không bật flag và không chạy tests.
- Bảy test: product CRUD rollback; SKU concurrency; product conflicts; category/warehouse/supplier CRUD rollback; warehouse deletion conflict; inbound/outbound inventory atomicity; scanner QR join/event delivery rollback.
- Scanner **transaction** replay case được đặt bên trong test inbound/outbound, không phải test riêng. Nó kiểm tra replay bằng scanEventId và conflict, nhưng hiện skip cùng suite.
- Integration fixture override `get_current_user` thành admin giả để kiểm tra nghiệp vụ DB; do đó suite PostgreSQL không kiểm chứng auth/RBAC. Auth tests hiện dùng SQLite in-memory; đây là test auth/unit, không phải PostgreSQL integration.
- Test DB rollback dùng connection transaction và `join_transaction_mode="create_savepoint"`; test concurrency riêng cần nhiều kết nối. Chưa có bằng chứng fixture lỗi. Cần xác nhận DB rỗng/isolated, schema migrate đúng head và quyền tạo savepoint/sequence trước khi chạy.

## 4. Runtime Readiness

- Kiểm tra listener tại thời điểm audit: không có backend ở `127.0.0.1:8000`, không có frontend ở `127.0.0.1:5173`; có PostgreSQL process tại 5432 nhưng target không được xác minh. Docker probe không thành công.
- Không gửi business request, không tạo document và không đọc/ghi DB. Do vậy **không thể xác nhận** `/health/ready`, document persistence, metadata row, audit row, inventory delta hoặc authentication/RBAC trên runtime.
- Health, auth và RBAC source/unit tests trước đó đạt trong suite; `TestClient` không đồng nghĩa backend process/runtime hoặc PostgreSQL.
- Bước runtime chỉ thực hiện sau khi owner xác nhận một DB test/staging cụ thể và cho phép dùng; chạy migrations/test-data trên DB riêng, có cleanup/backup plan. Không dùng port 5432 chỉ vì listener tồn tại.

## 5. Camera Verification Report

- Source `BarcodeScannerDialog.tsx` yêu cầu secure context: HTTPS hoặc `localhost`/`127.0.0.1` trên chính thiết bị; dùng `navigator.mediaDevices.getUserMedia`, ưu tiên camera sau và 1280×720, ZXing với TRY_HARDER, hỗ trợ EAN/UPC/Code128/Code39; xử lý permission/no-device/busy errors; cleanup stop controls và mọi media tracks khi đóng/unmount/lỗi.
- Camera scanner gate gọi callback liên tục, re-arm sau khi barcode vắng 350 ms; EAN-13 check digit được validate trong gate. QR phone scanner vẫn là luồng session/WebSocket riêng; HTTPS, origin reachable và backend runtime cũng cần thiết.
- Offline: camera decode cục bộ có thể hoạt động khi app đã tải và quyền được cấp. Giao dịch chỉ vào LocalStorage khi sản phẩm có trong frontend data; API lookup/POST sẽ retry khi mạng trở lại. QR pairing/transport và đồng bộ API không hoạt động khi offline. Không có đảm bảo storage survives browser data clearing/quota.
- Mức kiểm chứng: source inspection và routing/source-contract tests; chưa có browser automation, permission automation hay camera E2E trên thiết bị. Không khẳng định camera detection/cleanup đã chạy thật.

## 6. Multi-tab Readiness Report

- Queue là nhiều record LocalStorage theo authenticated user, lệnh được lưu trước khi POST. Web Locks API `navigator.locks.request(..., {ifAvailable:true})` là cơ chế khóa ưu tiên. Fallback là lease trong LocalStorage với expiry/heartbeat.
- **Fallback lease không phải khóa nguyên tử:** hai tab có thể cùng đọc lease rỗng, ghi và kiểm tra trong race window. Chưa thể bảo đảm single sender ở browser không hỗ trợ Web Locks.
- `storage` event chỉ refresh UI/listener; không tự gọi sync. Nếu tab B thêm lệnh khi tab A đang giữ lock, tab B có thể không đồng bộ lệnh mới cho đến online event, retry timer, mở lại scanner hoặc lần sync kế tiếp.
- Khi tab/process crash, record `SYNCING` được reset `PENDING` ở lần sync tiếp theo; lease fallback hết hạn sau 30 giây. Nếu server đã commit POST nhưng response bị mất, cùng body/key được retry và backend idempotency có thể replay. Đây là recovery logic theo source, chưa được browser crash test.
- Retry timer ở memory bị xóa khi dialog unmount; pending/retry queue vẫn ở LocalStorage nhưng không có background worker sau đóng tab. Không có browser multi-tab/crash automation đã chạy.
- Ưu tiên P02: dùng Web Locks hoặc cơ chế coordination có tính atomic; trigger sync khi có storage event/new enqueue; tests hai tab, tab crash và server commit/response timeout. Không thay scanner trong audit này.

## 7. SV3/SV4 Dependency List

| Bên phụ thuộc | Cần xác nhận/hoàn tất | Vì sao chặn |
|---|---|---|
| SV3 | Chấp thuận request/response schema `/documents`, metadata gate/event/client time và response `createdAt`; xác nhận error/replay semantics | Contract report hiện mới dựa trên source, chưa có xác nhận tích hợp |
| SV3 + SV4 | Scope Idempotency-Key theo principal, xử lý record cũ và kiểm thử không replay response giữa user | Rủi ro lộ dữ liệu phiếu giữa user |
| SV4 | Xác nhận RBAC cho scanner create, xem draft, confirm/cancel, gate assignment và audit attribution; đối chiếu báo cáo RBAC cũ với bearer/session hiện tại | Source phân quyền chung theo method, chưa có policy theo gate/document ownership |
| DB owner/SV3 | Chỉ định rõ DB test/staging host/db/credential channel và cho phép `alembic current/upgrade` + suite | Local 5432 hiện chưa xác minh môi trường; không được tự kết nối |
| SV3/DB owner | Áp 0008→0009 trên DB test/staging và xác nhận head/schema trước khi integration suite | Schema thật chưa được xác nhận |
| SV2 + SV3 | Tách/đảm bảo test PostgreSQL cho scanner draft duplicate/replay và timeout retry | Hiện case scanner draft nằm trong test DB tổng đang skip |
| QA/thiết bị | HTTPS/browser và thiết bị có camera, cấp quyền, barcode test, hai tab | Chưa có camera E2E/multi-tab automation |

## 8. Blocker Resolution Plan

1. **P0 – Security review/fix (SV3+SV4):** quyết định scope idempotency theo principal; thêm regression test chống cross-user replay. Sau đó review migration/data compatibility.
2. **P1 – Chốt contract (SV3/SV4):** ký xác nhận field mapping, response shape, server timestamp, gate-to-document semantics, RBAC create/read/confirm/cancel và error codes. Cập nhật docs sau khi chốt; không tự đổi field.
3. **P1 – Xác nhận test DB (DB owner):** cung cấp DB test/staging được phép, xác nhận không phải production và backup/cleanup. Chỉ khi có thông tin này mới chạy `alembic current`, upgrade và PostgreSQL tests.
4. **P1 – Migration/integration:** áp chuỗi đến 0009 trên DB test/staging, kiểm tra `alembic current == head`, chạy đủ 7 tests và bổ sung coverage scanner transaction/auth scope; xử lý mọi thất bại trước runtime.
5. **P1 – Runtime API/RBAC:** khởi chạy backend trỏ test DB, xác nhận health readiness, login/token/role, tạo draft, replay cùng key/event, audit row và tồn không đổi; confirm một phiếu test rồi xác minh inventory/movement/audit transaction.
6. **P2 – Browser/camera:** chạy HTTPS browser automation cho permission denied/granted, init, decode, cleanup, reload và offline/reconnect; sau đó E2E bằng camera thật trên thiết bị mục tiêu.
7. **P2 – Multi-tab/crash:** xác minh coordination; thử hai tabs cùng queue/sync, tab close/crash tại trước POST/sau server commit, reload recovery và auth user switch.
8. **Release gate:** review migration files (đặc biệt 0008 hiện là workspace change), tài liệu SV4 stale và final test evidence; chỉ đổi trạng thái sang READY khi P0/P1 đóng và các E2E bắt buộc đạt.

## 9. Kết luận readiness

**NOT READY.** Không kết nối DB vì hiện chỉ biết một PostgreSQL ở `localhost:5432/warehouse_db` thuộc `APP_ENV=development`, chưa được owner xác nhận là test/staging; không chạy migration hoặc business request. Blocker nghiêm trọng nhất là Idempotency-Key toàn cục chưa gắn authenticated user. Tiếp theo cần SV3/SV4 chốt contract/RBAC, DB owner cấp môi trường test được phép, áp migrations và chạy PostgreSQL/runtime/browser verification.

P02 này không triển khai tính năng scanner, không thay API/database contract và không thao tác production.

## 10. Kiểm tra được chạy trong P02

- `python -m pytest -q -p no:asyncio`: **42 passed, 7 skipped**; PostgreSQL skip vẫn giữ nguyên vì cờ chưa bật và DB chưa được xác nhận test/staging.
- `npm run test:vercel-routing`: **10/10 passed**. Đây là source/contract tests, không phải browser/camera E2E.
- `npm run build`: đạt.
- `python -m alembic history --verbose`: source head 0009; không kết nối database. `git diff --check`: đạt (chỉ có cảnh báo quy đổi LF/CRLF của workspace).
