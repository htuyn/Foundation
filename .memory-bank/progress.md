# Progress

## Đã triển khai (theo source và tài liệu hiện có)
- Frontend quản lý dashboard, sản phẩm, kho, danh mục, nhà cung cấp, tồn, phiếu, giao dịch, báo cáo, audit và scanner.
- Chế độ demo seed/localStorage và API mode FastAPI/PostgreSQL.
- Backend CRUD và nghiệp vụ tồn/phiếu, migration Alembic, API scanner REST/WebSocket.
- Tài liệu API, schema DB, mapping frontend-backend, scanner mobile và audit tích hợp trong `docs/`.
- Hộp thoại ZXing cho sản phẩm có nhập barcode thủ công, thông báo quyền/lỗi camera và dọn media tracks khi dừng/đóng/lỗi/quét thành công; hỗ trợ EAN-13, EAN-8, UPC-A, UPC-E, Code 128.
- Thêm/sửa sản phẩm vẫn preflight barcode qua API lookup; database unique constraint và lỗi 409 là chốt cuối. Sửa sản phẩm có barcode yêu cầu xác nhận trước khi thay.
- Làm rõ trên trang barcode sự khác nhau giữa quét trực tiếp (tra cứu sản phẩm đã có) và ghép nối QR (đẩy scan từ điện thoại về máy tính); giữ nguyên QR/API/WebSocket vì luồng này có mục đích riêng.
- Hoàn thiện URL scanner: `VITE_SCANNER_MOBILE_BASE_URL` tách frontend HTTPS trong QR khỏi URL API; QR bị chặn nếu URL rỗng, localhost, HTTP hoặc chứa path/query/credential.
- Mobile scanner quét liên tục với cooldown, pause/resume, camera sau, EAN-13/EAN-8/UPC-A/UPC-E/Code 128/Code 39, nhập barcode thủ công, phản hồi rung/âm thanh best-effort và dọn media tracks.
- Migration Alembic `0004_scanner_code_39` chỉ mở rộng check constraint format, không xóa/sửa dữ liệu hiện có.
- Migration Alembic `0004_scanner_code_39` chỉ mở rộng check constraint scan format, không xóa/sửa dữ liệu hiện có.
- Mobile gửi event qua WebSocket xác thực; backend validate quyền/schema, giới hạn tốc độ, persist `eventId` idempotently, ACK và broadcast tới desktop.
- Form phiếu kho tra cứu sản phẩm theo barcode và cập nhật dòng bản nháp hiện tại, hiển thị kết quả; không tự tạo sản phẩm hoặc xác nhận phiếu.
- Cập nhật README và `docs/scanner-mobile.md` hướng dẫn HTTPS/TLS, WSS, `VITE_API_BASE_URL` và `CORS_ORIGINS` cho production.
- Redesign UI theo light enterprise: tokens nền sáng/indigo/teal, sidebar sáng, dashboard composition với tổng quan tồn kho nổi bật và metrics vận hành gọn; cards/bảng/form/modal/toast và scanner đồng bộ. Bỏ nhãn xu hướng/trạng thái đồng bộ không có căn cứ và action không hoạt động khỏi phần dashboard. Giữ routing và luồng nghiệp vụ.
- Scanner LAN: gỡ QR remote khỏi form sản phẩm, chỉ để kết nối phone trong phiếu nhập và giữ remote QR trên trang tra cứu. Thêm quick-create sản phẩm theo barcode chưa tồn tại, dùng chung `saveProduct`, sau khi lưu thì thêm vào draft form (không cộng tồn).
- Thêm Vite proxy same-origin cho REST/WebSocket và frontend Compose dev service; backend/PostgreSQL bind loopback host. QR mặc định lấy origin hiện tại, có validation HTTPS/localhost; helper Windows chọn IP private theo default route, tạo cert mkcert và áp migrations.
- WebSocket incident: phát hiện `.env` local đang trỏ `VITE_API_BASE_URL=http://localhost:8000/api/v1`, bỏ qua Vite WS proxy và tạo đúng URL lỗi đã báo. Chuyển cấu hình sang `/api/v1`, thêm target proxy cho `npm run dev`, chuẩn hóa URL localhost cũ sang same-origin khi frontend được mở bằng LAN host. Reconnect dùng một connect attempt mỗi subscription, backoff và dừng sau 8 lần; owner đồng bộ trạng thái rồi dừng với phiên terminal/auth error. Backend ghi log an toàn về role/session/reason, không token. Thêm test helper và TestClient WS owner/device routes.
- Thêm quét barcode liên tục trực tiếp trong form nhập kho trên chính thiết bị: tái sử dụng `BarcodeScannerDialog`/ZXing, cùng barcode cooldown 1,8 giây và suppress lookup cùng barcode đang chạy, gọi lookup hiện có rồi cập nhật dòng phiếu nháp. Mã chưa đăng ký đóng camera rồi mở quick-create với barcode giữ nguyên. Không cần QR/WebSocket; remote scanner dùng chung vẫn được giữ ở luồng tra cứu.
- Khôi phục QR pairing trong phiếu nhập làm lựa chọn chính cho máy tính không có camera: `RemoteScannerButton` chuyển scan event về đúng `DocumentForm`; direct camera được giữ làm lựa chọn phụ trên cùng thiết bị. Cập nhật nhãn nút và hướng dẫn sử dụng.
- Kiểm tra `npm run build`: đạt sau khi đưa QR button trở lại phiếu nhập. Chưa xác minh hai thiết bị thật; QR yêu cầu HTTPS frontend LAN mà điện thoại tin cậy.
- Thêm `scripts/start-lan-vite.ps1` để chạy host Vite qua HTTPS LAN, truyền API proxy và QR origin bằng environment variables; mặc định dùng cổng `5174` nhằm tránh dừng Vite đang chiếm `5173`. Cài mkcert 1.4.4 qua winget. `mkcert -install` lỗi/hang trong phiên công cụ, nên script chỉ tạo cert và hướng dẫn trust `rootCA.pem` thủ công. Đã khởi chạy Vite; truy cập bằng localhost và IPv4 LAN đều phản hồi, module scanner dùng API mode, `GET /api/v1/products` qua proxy trả 200, QR config được bundle thành `https://192.168.16.109:5174`. Wi-Fi network category Public; chưa kiểm tra từ điện thoại hoặc trust CA.

## Đã kiểm chứng theo audit 2026-10-10
- Docker PostgreSQL/backend và migration đến `0003_normalize_product_ids (head)` đã được xác minh.
- 14 backend tests đạt trong container; test ghi rollback transaction ngoài.
- Frontend build đạt.
- Đây là kết quả được trích từ `docs/integration-audit.md`, không được chạy lại khi tạo Memory Bank.

## Xác minh cập nhật scanner (2026-10-10)
- `npm run build`: đạt sau các thay đổi cuối.
- `python -m pytest -q -p no:asyncio`: 8 passed, 7 skipped; các test PostgreSQL integration không chạy do không có DB test trong môi trường này. Bỏ qua plugin vì lệnh mặc định gặp pytest collection error với pytest-asyncio cài sẵn.
- `python -m compileall -q app tests`: đạt. Alembic `upgrade head --sql` sinh SQL đến revision `0004_scanner_code_39`; migration chưa áp dụng vào database thật.
- Chưa chạy browser E2E hoặc thử camera vật lý trên điện thoại; không kết luận luồng đã được xác nhận trên thiết bị production.

## Xác minh nâng cấp UI (2026-10-10)
- `npm run build`: đạt sau cập nhật light theme, dashboard composition và component dùng chung.
- Chưa thực hiện browser E2E hoặc kiểm tra trực quan ở các breakpoint/theme; responsive và tương phản cần được xác nhận trên trình duyệt thực tế.

## Xác minh scanner LAN (2026-10-11)
- `npm run build`: đạt.
- `python -m pytest -q -p no:asyncio`: 8 passed, 7 skipped; PostgreSQL integration tests bị skip do DB test chưa chạy.
- `python -m compileall -q app tests`, `docker compose config --quiet` và PowerShell AST parse cho helper: đạt.
- `docker compose build frontend`: thất bại tại `npm ci` trong build container do registry connection reset (`ECONNRESET`); do đó chưa khởi chạy/kiểm tra service Compose.
- Chưa test LAN, camera, HTTPS trust trên phone hoặc WebSocket thực tế. Phiếu nhập vẫn giữ line items trong form state tới thao tác lưu draft; chưa có API persist item theo từng scan và session chưa lưu document ID.

## Xác minh sửa lỗi WebSocket (2026-10-11)
- Bằng chứng gốc: `.env` thực tế có `VITE_API_BASE_URL=http://localhost:8000/api/v1`; URL builder dùng hostname/port từ biến này, trong khi Vite proxy `/api/v1` chỉ được dùng với relative base. Trên điện thoại, localhost là chính điện thoại; request cũng bỏ qua proxy frontend.
- Đã đổi `.env` local sang `/api/v1` và đặt `VITE_DEV_API_TARGET=http://127.0.0.1:8000`; sửa URL resolution, giới hạn reconnect, thêm log backend và kiểm thử WebSocket.
- Kết quả cuối: `python -m pytest -q -p no:asyncio` đạt 22 passed, 7 skipped (PostgreSQL integration tests vẫn skip); `npm run build`, `docker compose config --quiet`, `python -m compileall -q app tests` đạt. Có một Starlette/httpx deprecation warning trong test.
- Kiểm tra runtime trước sửa: backend nhận đúng WS route và log 403; REST `GET .../scans` trả 200; hai session điều tra không có `connected_at`/device token và đang chờ khi được tạo trước khi đóng, loại trừ lỗi route/prefix hoặc sai owner token REST. Log cũ không ghi lý do auth cụ thể. Backend đã được rebuild/restart riêng (không restart PostgreSQL); `/health/ready` trả ready/database connected. Frontend Vite PID 3208 vẫn chạy với env cũ và cần restart để nạp `.env` mới.
- Không có runtime/container log trong phiên này nên không thể xác nhận backend đã nhận các lần thử lỗi trước thay đổi; chưa kiểm thử mạng/camera thật.

## Kiểm tra workspace hiện tại (2026-10-11)
- Đã đọc cấu trúc và cấu hình: frontend React 18/TypeScript/Vite, scanner ZXing + QR/WebSocket; backend FastAPI/SQLAlchemy/Alembic; PostgreSQL 16 qua Compose. Không có Memory Bank thiếu tài liệu; đủ sáu tài liệu đã có.
- `.env` hiện đặt `VITE_API_BASE_URL=/api/v1` và `VITE_DEV_API_TARGET=http://127.0.0.1:8000`; lỗi cấu hình URL absolute `localhost` được ghi nhận trong lịch sử nhưng không còn hiện diện trong cấu hình được kiểm tra. Không đọc giá trị secret.
- `npm run build`: đạt. `python -m pytest -q -p no:asyncio` trong `backend/`: 22 passed, 7 skipped (PostgreSQL integration tests), một cảnh báo Starlette/httpx deprecation. `python -m compileall -q app tests` và `docker compose config --quiet`: đạt.
- Tại thời điểm kiểm tra không có listener ở cổng 5173/5174/8000/5433; Docker CLI không kết nối được Docker Desktop Linux engine. TCP cổng 5432 có listener nhưng chưa xác minh đó là DB của ứng dụng; không chạy migration hay thay đổi DB.
- Luồng scanner chưa được E2E xác minh trong môi trường hiện tại. Cần backend/PostgreSQL Compose sẵn sàng, Vite qua HTTPS LAN và CA được tin cậy trên điện thoại; nguyên nhân chặn hiện tại là các dịch vụ chưa chạy, không phải bằng chứng về lỗi code WebSocket.

## Xác minh quét camera trực tiếp trong phiếu nhập (2026-10-11)
- `npm run build`: đạt sau bổ sung chế độ continuous camera và camera button trong form nhập.
- Chưa kiểm thử trực quan hoặc camera vật lý trên điện thoại; cần mở ứng dụng qua HTTPS trusted origin để browser cấp quyền camera.

## Chưa xác minh / còn hạn chế
- Chưa có browser end-to-end.
- Chưa xác minh camera trên thiết bị thật, WebSocket handshake và luồng hai thiết bị qua HTTPS/WSS.
- User/role chưa có authentication/authorization.
- UI lọc/phân trang chủ yếu ở client; semantics query API và UI chưa đồng nhất hoàn toàn.
- Email chưa được backend validate định dạng; scanner WebSocket registry chỉ dùng một process.
- Một số mismatch cụ thể khác được ghi chi tiết trong `docs/integration-audit.md`.
- Chưa thử camera vật lý/browser trên điện thoại sau thay đổi này. Test backend local cần tắt plugin `pytest-asyncio` do lỗi collection giữa pytest 8.2.2 và pytest-asyncio 0.23.3; PostgreSQL integration tests bị skip khi không có DB test.

## Tiếp theo
- Dùng audit làm danh sách kiểm tra khi chọn phạm vi tiếp theo; kiểm thử camera trên thiết bị thật và chạy PostgreSQL integration tests trong Docker/runtime có DB.
- Trước production public, bổ sung authentication/authorization; không xem token scanner theo phiên là xác thực người dùng.
- Cập nhật trạng thái tại đây và `activeContext.md` sau mỗi thay đổi dự án.

## Sửa lỗi scanner configuration (2026-10-11)
- Nguyên nhân: `.env` local có UTF-8 BOM trước khóa đầu tiên `VITE_API_BASE_URL`; Vite bỏ qua khóa đó, module scanner không nhận API base và đặt `scannerMode='demo'`. Backend endpoint không thiếu: `POST /api/v1/scanner/sessions` đã được đăng ký, response khớp frontend.
- Đã bỏ đúng 3 byte BOM khỏi `.env` local, không thay đổi giá trị còn lại. `loadEnv` và module Vite đang chạy xác nhận `VITE_API_BASE_URL=/api/v1`; `.env.example` vốn không có BOM, đã thêm chú thích giữ UTF-8 không BOM và không dùng localhost cho QR.
- Test `backend/tests/test_scanner_session.py` gọi `POST /api/v1/scanner/sessions` qua FastAPI TestClient và nhận HTTP 201; kiểm tra UUID, mode/status, token, thời hạn và record lưu trong SQLite in-memory đạt. Đây là test cô lập, không phải API backend/PostgreSQL đang chạy.
- Tại lần sửa scanner config, backend host `127.0.0.1:8000` chưa phản hồi và Vite proxy trả 502; session chỉ được xác nhận qua TestClient/SQLite tạm. Trạng thái runtime mới nhất về QR được ghi ở mục tiếp theo.

## Điều tra QR không render (2026-10-11)
- Backend runtime hiện trả `/health/ready` HTTP 200; OpenAPI có `POST /api/v1/scanner/sessions` và `POST /api/v1/scanner/sessions/{session_id}/qr`. Endpoint tạo session trả session ID/owner token/thời hạn; endpoint QR trả nonce dùng một lần và thời hạn. Frontend tự ghép URL mobile, không có QR image/URL field từ backend.
- Nguyên nhân QR chưa xuất hiện: `VITE_SCANNER_MOBILE_BASE_URL` chưa cấu hình, frontend đang mở qua HTTP ở port 5173 nên fallback `window.location.origin` bị `baseUrlError`; QR effect không gọi endpoint nonce hoặc thư viện `qrcode`. Không bỏ qua kiểm tra này.
- Chứng chỉ hiện có SAN cho `192.168.16.109`, nhưng HTTPS port 5174 chưa chạy và Windows network profile là Public. Không mở thêm LAN server trên mạng Public; cần chuyển mạng sang Private chỉ khi tin cậy, chạy `scripts/start-lan-vite.ps1`, tin cậy CA trên desktop/điện thoại rồi mở URL HTTPS LAN. Cảnh báo block URL được gắn role alert. Chưa tạo QR thật hoặc xác nhận điện thoại truy cập được.
