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
- Mobile scanner quét liên tục với rearm khi barcode rời khung, pause/resume, camera sau, EAN-13/EAN-8/UPC-A/UPC-E/Code 128/Code 39, nhập barcode thủ công, phản hồi rung/âm thanh best-effort và dọn media tracks.
- Migration Alembic `0004_scanner_code_39` chỉ mở rộng check constraint format, không xóa/sửa dữ liệu hiện có.
- Migration Alembic `0004_scanner_code_39` chỉ mở rộng check constraint scan format, không xóa/sửa dữ liệu hiện có.
- Mobile gửi event qua WebSocket xác thực; backend validate quyền/schema, giới hạn tốc độ, persist `eventId` idempotently, ACK và broadcast tới desktop.
- Form phiếu kho tra cứu sản phẩm theo barcode và cập nhật dòng bản nháp hiện tại, hiển thị kết quả; không tự tạo sản phẩm hoặc xác nhận phiếu.
- Cập nhật README và `docs/scanner-mobile.md` hướng dẫn HTTPS/TLS, WSS, `VITE_API_BASE_URL` và `CORS_ORIGINS` cho production.
- Redesign UI theo light enterprise: tokens nền sáng/indigo/teal, sidebar sáng, dashboard composition với tổng quan tồn kho nổi bật và metrics vận hành gọn; cards/bảng/form/modal/toast và scanner đồng bộ. Bỏ nhãn xu hướng/trạng thái đồng bộ không có căn cứ và action không hoạt động khỏi phần dashboard. Giữ routing và luồng nghiệp vụ.
- Scanner LAN: gỡ QR remote khỏi form sản phẩm, chỉ để kết nối phone trong phiếu nhập và giữ remote QR trên trang tra cứu. Thêm quick-create sản phẩm theo barcode chưa tồn tại, dùng chung `saveProduct`, sau khi lưu thì thêm vào draft form (không cộng tồn).
- Thêm Vite proxy same-origin cho REST/WebSocket và frontend Compose dev service; backend/PostgreSQL bind loopback host. QR mặc định lấy origin hiện tại, có validation HTTPS/localhost; helper Windows chọn IP private theo default route, tạo cert mkcert và áp migrations.
- WebSocket incident: phát hiện `.env` local đang trỏ `VITE_API_BASE_URL=http://localhost:8000/api/v1`, bỏ qua Vite WS proxy và tạo đúng URL lỗi đã báo. Chuyển cấu hình sang `/api/v1`, thêm target proxy cho `npm run dev`, chuẩn hóa URL localhost cũ sang same-origin khi frontend được mở bằng LAN host. Reconnect dùng một connect attempt mỗi subscription, backoff và dừng sau 8 lần; owner đồng bộ trạng thái rồi dừng với phiên terminal/auth error. Backend ghi log an toàn về role/session/reason, không token. Thêm test helper và TestClient WS owner/device routes.
- Thêm quét barcode liên tục trực tiếp trong form nhập kho trên chính thiết bị: tái sử dụng `BarcodeScannerDialog`/ZXing, gọi lookup hiện có rồi cập nhật dòng phiếu nháp. Mã chưa đăng ký mở quick-create với barcode giữ nguyên. Không cần QR/WebSocket; remote scanner dùng chung vẫn được giữ ở luồng tra cứu.
- Khôi phục QR pairing trong phiếu nhập làm lựa chọn chính cho máy tính không có camera: `RemoteScannerButton` chuyển scan event về đúng `DocumentForm`; direct camera được giữ làm lựa chọn phụ trên cùng thiết bị. Cập nhật nhãn nút và hướng dẫn sử dụng.
- Scanner phiếu nhập dedupe event theo `eventId`, đưa lookup vào queue tuần tự để không bỏ rơi các lần quét cùng barcode đến nhanh; queue chờ người dùng tạo/bỏ qua sản phẩm chưa đăng ký. Từng dòng draft cho phép nhập số lượng nguyên trực tiếp. Mobile/direct camera không tái phát scan khi barcode còn nằm liên tục trong khung và re-arm sau 350ms vắng mã (chưa benchmark thiết bị thật).
- Kiểm tra cập nhật scanner: `npm run build` đạt; `npm run test:vercel-routing` 9/9 đạt; `git diff --check` không có lỗi whitespace. Chưa thử QR/WebSocket hoặc camera trên thiết bị thật.
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

## Sửa lỗi deep-link scanner trên Vercel
- Nguyên nhân tại source: repo frontend ở root, đã có React Router route `/scanner/mobile` và parser đầy đủ query/hash QR, nhưng thiếu `vercel.json` SPA rewrite cho direct navigation.
- Đã thêm `vercel.json` rewrite catch-all về `/index.html`; thêm Node built-in tests kiểm tra fallback, route React, tham số/expiry, yêu cầu join nonce và chuyển WSS theo HTTPS. Không thay đổi backend auth/nonce/session expiry hoặc thuật toán scanner.
- Bổ sung hướng dẫn Vercel: Root Directory `.`; output `dist`; `VITE_API_BASE_URL` cần là URL HTTPS Render đầy đủ có `/api/v1`; QR origin dùng HTTPS frontend.
- `npm run test:vercel-routing`: 4 passed; `npm run build`: đạt. Smoke test Vite preview mở trực tiếp `/scanner/mobile?...` trả HTTP 200 và nội dung `index.html`.
- Chưa kiểm tra Root Directory/Environment Variables trên dashboard Vercel và chưa xác minh deployment production hoặc quét hai thiết bị. Smoke test là local preview, không thay thế kiểm tra rewrite trên Vercel hoặc API/WebSocket thực tế.

## Tự khởi động camera mobile sau QR
- `ScannerMobilePage` tự gọi ZXing `decodeFromConstraints` với ưu tiên `facingMode: environment` chỉ sau khi API join qua nonce hoàn tất và WebSocket báo `connected`; nút bật camera vẫn là fallback cho yêu cầu quyền của browser.
- Thêm khóa camera đang khởi tạo, mã generation để bỏ kết quả mở camera muộn sau stop/unmount, dừng `IScannerControls` và toàn bộ media tracks, giữ cooldown quét. Mất kết nối dừng camera; có nút kết nối lại WebSocket hoặc thử xác thực lại khi lỗi tạm thời. Lỗi nonce/session terminal hướng người dùng tạo QR mới.
- Không thay đổi API/WebSocket, payload, cơ chế ACK, xác thực hoặc kiểm tra thời hạn. UI báo lỗi quyền/tìm camera và cho nhập mã thủ công như trước.
- Kết quả hiện tại: `npm run build` đạt; `npm run test:vercel-routing` đạt 5/5. Đây là build và source-contract tests, không mô phỏng getUserMedia thật; kiểm thử quyền grant/deny, camera vật lý, rời trang trên mobile và backend production chưa thể xác minh trong môi trường này.

## Quét nhiều sản phẩm trong cùng scanner session
- Nguyên nhân: `ScannerConnectionDialog` gọi `closeSession()` trong cleanup khi modal unmount và trong `dismiss`. Đóng cửa sổ QR để thao tác form vì vậy kết thúc session; mobile nhận trạng thái `ended` rồi dừng camera. Backend `store_scan` và WebSocket scan handler không đóng session theo event, mà xác nhận/persist/broadcast từng event.
- Giữ `ScannerConnectionDialog` mounted bên trong `RemoteScannerButton` trong cả trạng thái ẩn; ẩn/đóng UI chỉ bỏ modal, giữ owner subscription và callback scan. Nút “Ngắt kết nối” vẫn gọi endpoint close tường minh; mobile leave, expiry và xác thực terminal giữ nguyên.
- Thêm frontend source-contract test cho receiver vẫn mounted và session chỉ đóng qua action rõ ràng. Mở rộng PostgreSQL integration test: gửi hai barcode với eventId riêng trong cùng session, xác nhận status vẫn `connected`, duplicate event vẫn idempotent và leave mới kết thúc session.
- Kiểm thử thực tế: `npm run build` đạt; `npm run test:vercel-routing` đạt 6/6; `python -m pytest -q -p no:asyncio` đạt 23 passed, 7 skipped, một cảnh báo deprecation. PostgreSQL integration test mở rộng nằm trong nhóm skipped khi không bật DB; chưa có browser/mobile hai thiết bị nên camera/session production chưa được xác minh.
- Không đổi backend runtime, schema, migration, endpoint hay payload. Cần redeploy frontend Vercel; không cần deploy Render hoặc migration.

## Khắc phục QR production và điều tra Vercel login
- Kiểm tra lịch sử: commit liên tục sửa dialog mount/session lifecycle, không sửa route hoặc URL QR. `App.tsx` đăng ký `/scanner/mobile` độc lập bên ngoài `Layout`; không có auth guard/redirect ở source; `vercel.json` có SPA catch-all tới `/index.html`; không tìm thấy middleware Vercel trong repo.
- Nguyên nhân source có thể chứng minh: QR chọn `VITE_SCANNER_MOBILE_BASE_URL` nếu có, nếu không thì dùng `window.location.origin`; vì vậy mở desktop từ Preview URL có thể tạo QR trỏ Preview. Không thể chứng minh Protection đang bật hoặc domain QR thực tế là Preview mà không có production URL/Vercel Dashboard. Vercel Deployment Protection là ngoài source.
- Fail-safe: production build không tạo QR nếu thiếu `VITE_SCANNER_MOBILE_BASE_URL`; cấu hình này phải là origin HTTPS public canonical, chỉ trong Production scope. Development vẫn fallback origin. Không bypass/tắt Deployment Protection hoặc thay đổi auth scanner.
- Kiểm thử lần cập nhật: `npm run build` đạt; `npm run test:vercel-routing` đạt 7/7; backend `python -m pytest -q -p no:asyncio` đạt 23 passed, 7 skipped, 1 deprecation warning; `git diff --check` sạch. `package.json` không có lint script. Không kiểm tra trực tiếp Production Vercel/mobile ẩn danh; PostgreSQL-specific integration tests vẫn skip.
- Deploy Vercel sau khi đặt `VITE_SCANNER_MOBILE_BASE_URL` đúng origin và kiểm tra Deployment Protection. Không có backend/schema change, không cần Render deployment/migration. Nếu bật Protection trên Production, cần đánh giá vì gate ở cấp deployment có thể chặn toàn website; frontend hiện chưa có tài khoản đăng nhập riêng.

## Nâng cấp giao diện FOUNDATION (2026-10-11)
- Đã đổi brand sidebar thành FOUNDATION và thêm token/responsive overrides gọn ở cuối `src/styles.css`; giữ các trang/route, chế độ sáng-tối, API, form, bảng và scanner hiện có.
- `npm run build`: đạt (TypeScript và Vite production build).
- `npm run test:vercel-routing`: 7 passed, 0 failed; bao gồm route mobile scanner, expiry, API/WSS và auto-camera source contracts.
- `git diff --check`: đạt. Chưa có browser automation; chưa thực hiện kiểm tra trực quan ở các viewport yêu cầu hoặc test camera hai thiết bị.

## Light-only và nâng cấp bảng (2026-10-11)
- Ép `data-theme=light` tại bootstrap, thêm meta `color-scheme=light` và gỡ nút/logic chuyển theme; không đổi scanner route.
- Tăng độ rõ bảng bằng vertical dividers, header nhạt, separators/hover, vùng cuộn ngang độc lập, cùng kích thước/độ đọc phù hợp hơn.
- `npm run build`: đạt; `npm run test:vercel-routing`: 7 passed; `git diff --check`: đạt. Chưa kiểm thử trực quan thực tế ở desktop/tablet/mobile.
- Gỡ hai khối trạng thái workspace/API khỏi sidebar theo yêu cầu; giữ các điều hướng và thông tin tài khoản. Build đạt.

## Giữ phiên QR khi nhập sản phẩm (2026-10-11)
- Sau khi mobile kết nối thành công, QR dialog tự thu gọn; desktop còn nút trạng thái để mở lại thông tin phiên. Đóng/ẩn dialog không gọi API kết thúc phiên.
- Thêm hàng đợi barcode theo thứ tự cho form nhập kho; tránh ghi đè form sản phẩm mới, gộp các lần quét cùng mã thành số lượng, tiếp tục hàng đợi sau lưu hoặc bỏ qua.
- `npm run build`: đạt. `npm run test:vercel-routing`: 7 passed. `git diff --check`: đạt. Chưa E2E trên thiết bị điện thoại.

## Backend idempotency, Audit Log và backup (2026-10-29)
- Thêm migration `0005_idempotency_audit`: bảng idempotency dùng `idempotency_key` làm khóa chính/UNIQUE, lưu hash payload và response gốc; Audit Log có action, outcome, HTTP status và JSON details.
- `POST /api/v1/documents` hỗ trợ `Idempotency-Key` trong cùng transaction với tạo phiếu. Retry cùng payload trả response ban đầu; reuse key cho body khác trả 409 `IDEMPOTENCY_KEY_REUSED`. Mã phiếu đã có unique constraint; cơ chế advisory lock sinh mã tiếp tục được giữ.
- Frontend API mode gửi khóa idempotency và giữ khóa cho lần retry cùng payload cho đến khi response và bootstrap refresh thành công.
- Xác nhận xuất/điều chỉnh vượt tồn trả 400 `INSUFFICIENT_STOCK`, không cập nhật tồn. API rejection 400/403/409 được ghi Audit Log; test PostgreSQL bổ sung kiểm tra replay, key conflict, tồn và audit.
- Thêm `scripts/backup_postgres.sh` (pg_dump custom format + SHA-256), `scripts/restore_postgres.sh` (verify checksum trước pg_restore), và hướng dẫn URI local/managed, cron, staging trong `docs/postgres-backup-restore.md`.
- Kiểm tra: PostgreSQL integration suite đạt 32 passed, một cảnh báo Starlette/httpx; frontend build và routing tests 7/7 đạt. `compileall`, `bash -n` hai script và Alembic offline SQL generation đạt. Tạo custom-format backup trước migration tại `C:\Users\hongt\AppData\Local\Temp\opencode\warehouse-before-0005.dump` (778272 bytes; SHA-256 `a5acef2b66dfab0faec9e92cb44a6542f07b68914667e6f9aafa2fbcd24e813f`). Alembic `0004` và `0005` đã áp dụng lên PostgreSQL Compose local; backend rebuilt, health/readiness và revision `0005` xác nhận. Chạy hai script backup/restore thực tế trong PostgreSQL container; checksum đạt, restore clean thành công vào database validation local cô lập `warehouse_restore_validation_20261029`. Chưa diễn tập trên staging/managed; lịch hệ thống chưa cấu hình.
- Giới hạn: ứng dụng chưa có authentication/authorization. Audit context sẵn sàng đọc `request.state.actor_name`, nhưng vẫn fallback `Hệ thống` tới khi SV4 nối middleware xác thực và đặt principal đáng tin cậy. Idempotency header backend vẫn optional để giữ tương thích client cũ; frontend hiện gửi và giữ lại cùng key khi retry trong phiên.



## SV1 - Hạ tầng & Dữ liệu
- [x] **CV01: Thiết kế & Cấu hình hạ tầng mạng Kho An Phát (Packet Tracer)**
  - Đã hoàn thành sơ đồ mạng mô phỏng (`docs/KhoHang_AnPhat.pkt`).
  - Đã kiểm thử ping thông mạng giữa máy quét Wi-Fi (Point-1) và App-Server (`192.168.1.10`) đạt 100% (Minh chứng MC01).
- [/] **CV02: Thiết kế Cơ sở dữ liệu & ERD** (Đang triển khai)

- Đã thay QR modal desktop bằng bảng session inline, giữ phiếu nhìn thấy; hiển thị thời lượng phiên, số event nhận, barcode mới nhất và trạng thái xử lý/kết nối.
- Phiếu nháp có thống kê loại/số lượng/giá trị, barcode/SKU/đơn vị, nút +/- , chỉnh số nguyên trực tiếp, xóa riêng và highlight dòng vừa quét.
- Lookup remote và thêm basket được tuần tự hóa; mutation basket dựa trên state hiện tại để không mất increment khi event về nhanh. Retry được chống trùng theo `eventId`.
- Mobile giữ scan chưa ACK trong bộ nhớ và retry cùng `eventId` khi reconnect/timeout. Backend đã lưu idempotent và owner replay event đã lưu; không đổi API/schema/bảo mật. Outbox không sống qua reload/đóng tab.
- Camera yêu cầu lý tưởng 1280×720; TRY_HARDER, focus liên tục và zoom chỉ khi có capability; re-arm 350 ms. Không kết luận hiệu năng nhanh hơn khi chưa đo.
- Kiểm thử cuối: `npm run build` đạt; `npm run test:vercel-routing` 9/9 đạt; `python -m pytest -q -p no:asyncio` 25 passed, 7 skipped. Pytest mặc định gặp pytest-asyncio collection INTERNALERROR; 7 test bị skip theo cấu hình DB. Chưa thử thiết bị Android/iPhone hoặc mạng chập chờn thật.

## Sửa lỗi CORS Vercel Preview/Render (2026-11-02)
- Nguyên nhân source: FastAPI chỉ cấu hình `allow_origins=settings.cors_origin_list`; Settings có `CORS_ORIGINS` nhưng không có regex, nên origin Vercel Preview ngoài allowlist không được phản hồi CORS. Middleware CORS chỉ khai báo một lần; không tìm thấy `render.yaml` hoặc override production trong repository.
- Thêm `cors_origin_regex: str | None = None` để Pydantic Settings đọc `CORS_ORIGIN_REGEX`, dùng đồng thời allowlist và regex trong middleware. Giữ `allow_credentials=False`, methods/headers hiện tại và mặc định localhost. Docker Compose chuyển tiếp biến tùy chọn.
- Regex Render giới hạn vào `^https://foundation-[a-z0-9-]+-kthp-s-projects\.vercel\.app$`; Production origin cố định vẫn nằm trong `CORS_ORIGINS`. Bổ sung hướng dẫn Render, link README, cập nhật hai env example; không thêm secrets.
- Test `backend/tests/test_cors.py` chạy TestClient qua CORSMiddleware thật: Production/2 Preview được phép; project khác, suffix giả mạo và HTTP không được CORS; OPTIONS `/api/v1/bootstrap` kiểm tra status, origin, methods và headers.
- Xác minh: backend suite `python -m pytest -q -p no:asyncio` 34 passed, 7 skipped (PostgreSQL integration theo cấu hình DB); `npm run build` đạt; `npm run test:vercel-routing` 9/9; `docker compose config --quiet` và `git diff --check` đạt. Pytest có một Starlette/httpx deprecation warning.
- Chưa deploy hoặc restart Render và chưa gọi production API từ trình duyệt; cần đặt `CORS_ORIGINS=https://foundation-wheat-tau.vercel.app` cùng `CORS_ORIGIN_REGEX` như `docs/render-deployment.md`, rồi xác minh deployment thực tế.

## Đăng nhập và RBAC phía backend (2026-11-10)
- Thay cơ chế header giả mạo `X-User-Id` bằng access token HMAC-SHA-256 15 phút, ràng buộc session ID và kiểm tra session/user đang hoạt động trên mỗi request.
- Thêm refresh token ngẫu nhiên, chỉ lưu hash trong DB, xoay vòng khi refresh; logout, đổi/reset mật khẩu và vô hiệu hóa user thu hồi phiên. Cookie refresh HttpOnly; CSRF cookie/header và origin allowlist được xác minh. Login thành công/đăng xuất và API rejection hiện có audit.
- Mật khẩu hash bằng scrypt (N=32768, r=8, p=1), tối thiểu 6 ký tự. Migration `0007_user_auth_sessions` thêm nullable `users.password_hash` để user cũ không có mật khẩu đăng nhập, cùng `auth_sessions`.
- Bảo vệ `/api/v1/bootstrap` và các API kho bằng bearer access token; health/scanner QR giữ public có chủ đích. Quản trị user/password chỉ dành cho admin; không thể tự hạ/vô hiệu hóa admin hoặc xóa admin hoạt động cuối. Bootstrap snapshot không phát user list cho role khác admin.
- Frontend có trang đăng nhập/đăng xuất, khôi phục phiên, tự refresh và retry đồng thời an toàn; route quản trị user chỉ hiển thị admin. Admin tạo user kèm mật khẩu ban đầu/đặt lại password. Demo localStorage được ghi rõ là không có bảo mật auth.
- Thêm CLI prompt ẩn `python -m app.create_admin`, tài liệu `docs/authentication.md`, cấu hình secret/cookie/CORS và hướng dẫn deploy. Tài khoản seed demo không có mật khẩu.
- Xác minh: backend `python -m pytest -q -p no:asyncio`: 40 passed, 7 PostgreSQL tests skipped; frontend build đạt; routing tests 9/9; `compileall`, `docker compose config --quiet`, Alembic offline SQL đến `0007_user_auth_sessions`, `git diff --check` đạt. Fixture PostgreSQL integration đã override current-user bằng admin test để giữ nguyên các test nghiệp vụ sau khi bootstrap yêu cầu auth.
- Chưa áp migration lên DB thật, chưa tạo admin runtime, chưa kiểm tra browser/deployment production. Cần đặt `AUTH_SECRET_KEY` mạnh, chạy migration rồi bootstrap admin; Vercel/Render nên dùng custom domain cùng site do third-party cookie restrictions. Đặt rate limiting login ở gateway trước khi public.

## Hạ ngưỡng độ dài mật khẩu và yêu cầu tạo admin (2026-11-10)
- Theo yêu cầu, password bootstrap/login/tạo user/reset chấp nhận 6–128 ký tự; hash scrypt và token/session không thay đổi. Cảnh báo mật khẩu ngắn dễ đoán, nên dùng passphrase mạnh hơn. Backend suite hiện 41 passed/7 skipped; build và routing tests 9/9 đạt.
- Chưa tạo `admin@gmai.com`: Docker daemon không chạy, backend `127.0.0.1:8000` không phản hồi. Cổng `5432` có listener nhưng chưa xác minh DB thuộc ứng dụng; không chạy migration/ghi vào DB không rõ nguồn. Cần bật đúng Compose database, áp migration rồi chạy CLI admin.
