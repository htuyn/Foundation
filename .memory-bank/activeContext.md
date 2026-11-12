# Active Context

## Trạng thái hiện tại
- Đang duy trì ứng dụng quản lý kho React/Vite + FastAPI/PostgreSQL.
- Tích hợp CRUD, phiếu, tồn, audit, scanner API và xác thực/RBAC phía backend hiện đã có trong source. Xem `docs/integration-audit.md` để biết kết quả kiểm chứng và các mismatch còn tồn tại.
- Frontend mặc định dùng snapshot/seed local; API mode được bật bởi `VITE_API_BASE_URL`.
- Memory Bank được khởi tạo ngày 2026-10-10 từ README, cấu hình, cấu trúc source và tài liệu audit hiện có.
- Camera scanner dùng ZXing cho tạo/sửa sản phẩm và tra cứu trên trang barcode; đã bổ sung nhập thủ công trong modal và dừng media tracks khi đóng, lỗi hoặc quét được.
- QR scanner từ xa vẫn được giữ: backend phát QR nonce dùng một lần; điện thoại gửi barcode qua WebSocket xác thực, backend lưu event và push tới desktop. `VITE_SCANNER_MOBILE_BASE_URL` tách URL QR frontend khỏi `VITE_API_BASE_URL`; QR không tự fallback sang localhost.
- Form phiếu kho tra cứu barcode qua backend và cập nhật đúng dòng bản nháp đang mở; không tự xác nhận phiếu hoặc cập nhật tồn. Camera rearm barcode sau khi mã rời khung; các lần quét được xử lý theo thứ tự và dedupe theo `eventId`.
- Giao diện frontend theo light enterprise design system: nền sáng, sidebar sáng, dashboard ưu tiên tồn kho và dữ liệu thật.
- Scanner LAN: QR ghép nối bị gỡ khỏi form sản phẩm; nút phone scanner chỉ hiện trong phiếu nhập (trang tra cứu vẫn giữ luồng QR riêng). Vite proxy API/WS same-origin; Compose có frontend service và PowerShell helper chọn IPv4 private, tạo HTTPS dev cert qua mkcert; DB/API host ports bind loopback. Phiếu nhập lookup sản phẩm qua API, hỗ trợ tạo nhanh sản phẩm hợp lệ rồi thêm vào form draft.
- Sửa WebSocket scanner: root `.env` dùng `/api/v1` qua Vite proxy thay vì `http://localhost:8000/api/v1`; URL WS suy ra host frontend và `ws/wss`, giữ prefix `/api/v1`. Nếu bundle/runtime vẫn khai báo localhost khi được mở qua host LAN, frontend chuẩn hóa API về cùng origin. Reconnect chống trùng và giới hạn 8 lần; terminal/owner auth REST errors dừng thử lại. Backend log accept/reject/error với session ID/role/reason, không ghi token; test route auth/session expiry đã thêm.
- Phiếu nhập có hai lựa chọn: desktop kết nối camera điện thoại qua QR/WebSocket để đẩy scan về form đang mở; hoặc quét camera trực tiếp trên cùng thiết bị. Cả hai dùng lookup API, cập nhật draft và không tự xác nhận/cộng tồn. Camera không lặp sự kiện khi barcode vẫn nằm trong khung; cần đưa mã ra khỏi khung để quét lại có chủ ý.
- Lịch sử kiểm chứng sửa lỗi: 22 backend tests pass, 7 PostgreSQL-dependent skipped; frontend build/Compose config/python compileall pass. Runtime logs ở lần kiểm tra trước xác nhận backend nhận WS đúng route nhưng trả 403; backend sau đó rebuild/restart và DB readiness đạt. Vite PID 3208 khi đó cần restart để nạp `.env` mới; lần kiểm tra workspace hiện tại không thấy listener frontend/backend. Chưa xác nhận quét bằng điện thoại.
- Camera trực tiếp và QR phone scanner cùng được đặt trong form nhập kho; build đạt. Chưa thử camera điện thoại/browser thật hoặc end-to-end pairing sau cập nhật button.
- Để QR hoạt động trên desktop, phải mở app qua HTTPS LAN origin; khởi chạy Vite với cấu hình HTTPS LAN (script mkcert), sau đó điện thoại tin cậy CA. Lần kiểm tra workspace trước đó chưa có Vite process.
- Có script `scripts/start-lan-vite.ps1` cho trường hợp backend chạy host tại `127.0.0.1:8000` và Vite chạy trực tiếp; mặc định cổng `5174` để không đè tiến trình Vite cũ ở `5173`. Script đặt API proxy và QR origin từ IPv4 LAN, sinh cert riêng; CA cần được người dùng tin cậy thủ công trên Windows và điện thoại. Tại lần kiểm tra workspace 2026-10-11, không có Vite/backend listener; Docker daemon không kết nối được; PostgreSQL chỉ đang lắng nghe cổng `5432`, không phải cổng Compose `5433`. Vì vậy các URL/camera/QR LAN chưa thể kiểm thử runtime trong lần này.
- Sửa lỗi scanner config 2026-10-11: `.env` local có UTF-8 BOM trước `VITE_API_BASE_URL`, khiến Vite bỏ qua biến đầu tiên và frontend chọn `demo`; đã bỏ riêng BOM, Vite runtime hiện inject `/api/v1`. `.env.example` không có BOM và đã bổ sung hướng dẫn encoding/HTTPS LAN. Tại lần kiểm tra cấu hình, backend chưa lắng nghe cổng `8000`, Vite proxy trả `502`; API session được kiểm thử trực tiếp bằng TestClient với SQLite tạm.
- QR follow-up 2026-10-11: backend `/health/ready` trả 200 và session/QR routes có trong OpenAPI. `VITE_SCANNER_MOBILE_BASE_URL` chưa đặt; Vite đang HTTP `5173`, nên modal lấy `window.location.origin`, `baseUrlError` chặn gọi endpoint nonce và QR render. HTTPS `5174` chưa listen; chứng chỉ hiện có SAN `192.168.16.109`, nhưng Windows network profile là Public nên không bật server LAN. Cảnh báo URL sai được đưa thêm vào role alert; chưa phát sinh QR hoặc xác nhận pairing thật.
- Ghi nhận lịch sử tại thời điểm 2026-10-11: backend scanner lưu scan event, desktop xử lý lookup và form state; chi tiết dòng phiếu chưa persist PostgreSQL sau từng scan, session chưa gắn document ID ở DB. Authentication/RBAC chưa có ở mốc này; trạng thái mới cập nhật ngày 2026-11-10 ở phần dưới.
- Sửa 404 deep-link mobile scanner trên Vercel: thêm `vercel.json` SPA rewrite về `/index.html`; route React `/scanner/mobile`, query `mode/sessionId/expiresAt`, fragment `qrNonce/qrExpiresAt`, xác thực join và WSS vẫn giữ nguyên. Thêm Node built-in routing contract tests và ghi hướng dẫn Root Directory/config production Vercel. Cần kiểm tra Root Directory và các biến `VITE_*` trong dashboard Vercel, rồi xác minh bằng deployment thực tế; chưa có quyền kiểm tra dashboard hay chạy E2E trên điện thoại.
- Mobile QR scanner tự yêu cầu camera sau chỉ sau khi API join thành công và WebSocket xác nhận `connected`; camera attempt được khóa để tránh nhiều stream, callback bị vô hiệu khi dừng/unmount và tracks được dừng rõ ràng. Có fallback quyền camera, retry kết nối và retry camera; nonce/thời hạn/payload/ACK giữ nguyên. Chưa kiểm thử quyền/camera hoặc pairing trên thiết bị thật.

- Scanner desktop giữ `ScannerConnectionDialog` và event receiver mounted nhưng ẩn UI, nên có thể ẩn cửa sổ QR để sửa quick-create sản phẩm mà không đóng session hoặc mất callback scan. Chỉ nút “Ngắt kết nối” gọi close endpoint; backend scan event vốn không đóng phiên. Kiểm tra nhiều event đã được thêm vào PostgreSQL integration test, chưa chạy do không bật DB test.
- Triage Vercel mobile-login: source không có auth guard/redirect cho `/scanner/mobile`; route nằm ngoài `Layout`, SPA rewrite hiện có. QR chỉ fallback `VITE_SCANNER_MOBILE_BASE_URL` rỗng về origin đang mở, có thể là Preview deployment. Production hiện yêu cầu khai báo rõ public canonical origin bằng biến Production-scope; không có quyền xác minh hoặc đổi Deployment Protection trong Dashboard. Scanner session auth nonce/expiry không thay đổi.

## Việc cần chú ý khi tiếp tục
1. Camera thật và WebSocket hai thiết bị chưa kiểm thử; cần frontend/API HTTPS truy cập được trên điện thoại và PostgreSQL đang chạy.
2. Kiểm tra `docs/integration-audit.md` và các tài liệu contract trước khi đổi API hoặc nghiệp vụ.
3. Không suy diễn rằng kiểm thử audit trước đó vừa được chạy lại.
4. Không công khai API trước khi áp migration, tạo admin, đặt `AUTH_SECRET_KEY`, cấu hình HTTPS/CORS/custom domain và rate limiting đăng nhập.
5. Các ưu tiên kỹ thuật được ghi trong audit: thống nhất server-side search/pagination, validation email và semantics giao dịch; xác minh camera/WebSocket trên thiết bị thật và browser E2E.
6. Production yêu cầu TLS hợp lệ, API HTTPS/WSS và CORS allowlist đúng origin.
7. Chưa test camera/WebSocket hai thiết bị thật. Mobile cần trusted HTTPS CA; chưa chạy Compose services do frontend image build vấp npm registry ECONNRESET.

## Quy tắc cập nhật
Sau thay đổi kiến trúc/tính năng/sửa lỗi, cập nhật tệp này cùng `progress.md` và các trang Memory Bank/`docs/` có liên quan. Giữ rõ trạng thái đã triển khai, đã kiểm chứng và chưa xác minh.

## Xác thực tài khoản và RBAC (2026-11-10)
- API mode đã có login/logout/refresh/me, access token HMAC 15 phút gắn với session trong PostgreSQL; refresh cookie HttpOnly được xoay và có CSRF double-submit/origin validation. Token chỉ lưu trong memory frontend; refresh sau reload dùng cookie/API CSRF endpoint.
- `X-User-Id` không còn là danh tính tin cậy; bootstrap và API nghiệp vụ yêu cầu bearer access token. Role được đọc từ DB trên request. Admin quản lý users/password; user/deactivation/reset thu hồi sessions; không thể gỡ admin cuối.
- Migration `0007_user_auth_sessions` đã sinh SQL offline, nhưng chưa áp vào DB runtime. Tài khoản cũ/seed không có password hash; cần bootstrap admin qua `python -m app.create_admin` sau migration.
- Frontend API mode chặn route bằng login, có refresh/ retry; `/users` chỉ dành admin. LocalStorage demo vẫn không có auth và được đánh dấu rõ.
- Backend tests 41 passed/7 skipped; frontend build và routing 9/9 đạt, compileall/Compose config/offline migration đạt. Chưa kiểm tra UI thực tế, cookie third-party, browser hoặc production deployment.
- Production cần `AUTH_SECRET_KEY` ≥32 byte, `APP_ENV=production`, HTTPS, CORS allowlist, ưu tiên custom frontend/API subdomains cùng site với cookie domain phù hợp; cấu hình rate limit login tại gateway.
- 2026-11-10: minimum password theo yêu cầu hạ xuống 6 ký tự (tối đa 128), độ an toàn giảm. Chưa tạo `admin@gmai.com`: Docker/backend chưa chạy; cổng 5432 chưa xác nhận là DB dự án.

## Nâng cấp giao diện FOUNDATION (2026-10-11)
- Audit trước khi sửa: React 18/TypeScript/Vite, React Router 7, CSS thuần, Lucide, Recharts; các route nghiệp vụ hiện có cùng `/scanner/mobile` đã được xác nhận. Git diff ban đầu sạch.
- Đổi nhãn thương hiệu sidebar sang FOUNDATION; thêm lớp token và responsive polish trong `src/styles.css` (indigo nhất quán, radius/elevation, trạng thái focus bảng, bảng/modal và breakpoints nhỏ). Không thêm dependency, không đổi route/API/nghiệp vụ/scanner.
- `npm run build`: đạt. `npm run test:vercel-routing`: 7/7 đạt; gồm source-contract kiểm tra scanner. Chưa chạy browser visual/E2E ở 1440/1280/768/390/360px hoặc thiết bị camera thật.
- Bổ sung theo yêu cầu light-only/table: khóa `data-theme=light` tại bootstrap kể cả scanner route, bỏ nút/logic đổi theme, khai báo color-scheme light; bảng dùng divider dọc, header xám nhạt, row separators/hover và cuộn ngang trong container. API/scanner không đổi.
- Kiểm chứng lần cập nhật này: `npm run build` và `npm run test:vercel-routing` (7/7) đạt; `git diff --check` đạt. Chưa có kiểm tra trực quan đa viewport.
- Follow-up: gỡ workspace label “An Phát Trading / Kết nối API” và thẻ trạng thái dữ liệu khỏi sidebar; giữ nguyên menu và thông tin hồ sơ. `npm run build` đạt.

## Cải tiến luồng scanner nhập kho (2026-10-11)
- QR modal tự ẩn sau khi điện thoại kết nối; `RemoteScannerButton` tiếp tục hiển thị trạng thái kết nối, còn session/WebSocket receiver vẫn được giữ mounted. Hành động ẩn QR được ghi rõ không ngắt phiên; chỉ nút ngắt kết nối gọi close API.
- Barcode trong phiếu nhập được xử lý tuần tự. Mã khác được xếp hàng trong lúc nhập nhanh sản phẩm; quét lặp barcode hiện tại tăng số lượng; lưu/bỏ qua sản phẩm sẽ tiếp tục hàng đợi. Không thay API, payload, nonce hoặc session contract.
- `npm run build` đạt; `npm run test:vercel-routing` 7/7 đạt; `git diff --check` đạt. Chưa kiểm thử camera/QR bằng thiết bị thật.

## Đồng bộ barcode vào phiếu nháp (2026-10-29)
- Phiếu nhập xử lý scan events tuần tự và bỏ qua event trùng `eventId`; các lần quét mới cùng barcode vẫn cộng dồn số lượng, kể cả khi lookup trước đó chưa xong. Nếu mã chưa đăng ký, hàng đợi tạm dừng tới khi người dùng tạo hoặc bỏ qua sản phẩm quick-create.
- Số lượng từng dòng phiếu có thể sửa trực tiếp bằng input số nguyên tối thiểu 1. Quét/sửa chỉ đổi draft; tồn kho chỉ đổi khi xác nhận phiếu.
- Mobile/direct camera coi barcode giữ liên tục trong khung là một lần quét; scanner re-arm khi barcode vắng khỏi kết quả giải mã đủ 350 ms. Cấu hình re-arm chưa được đo trên thiết bị thật.
- `npm run build` và `npm run test:vercel-routing` đạt (9/9). Chưa thử QR/WebSocket hoặc camera trên thiết bị thật.

## Backend idempotency, Audit Log và backup (2026-10-29)
- Alembic `0005_idempotency_audit` thêm bảng `idempotency_requests` (khóa chính UNIQUE theo `idempotency_key`) và metadata có cấu trúc cho `audit_logs`.
- `POST /api/v1/documents` hỗ trợ `Idempotency-Key`: cùng key/cùng payload replay response ban đầu; cùng key/payload khác trả 409. `stock_documents.code` vốn UNIQUE; advisory transaction lock tiếp tục tuần tự hóa sinh mã PN/PX. Xuất/điều chỉnh vượt tồn trả 400 `INSUFFICIENT_STOCK`.
- Frontend API mode gửi và giữ `Idempotency-Key` cho retry cùng payload; xóa key tạm sau khi response và refresh bootstrap thành công.
- Ghi audit các API rejection 400/403/409 và mở rộng serializer; hoạt động CRUD/phiếu tiếp tục ghi log thành công. Actor lấy từ context gắn với `request.state.actor_name`; chưa có user authentication nên fallback vẫn là `Hệ thống`, SV4 cần đặt danh tính đã xác thực vào state này.
- Thêm script backup/restore PostgreSQL có SHA-256 và hướng dẫn lịch cron/staging/managed DB ở `docs/postgres-backup-restore.md`.
- Xác minh: backend PostgreSQL suite đạt 32 passed; frontend build và routing tests 7/7 đạt. Backup trước migration được tạo tại thư mục temp và kiểm tra SHA-256; Alembic `0004`–`0005` đã áp dụng lên PostgreSQL Compose local, backend container rebuild/restart, `/health/ready` trả ready và DB ở `0005_idempotency_audit`. Chạy thực tế cả hai script trong PostgreSQL container; checksum verified và restore `--clean` thành công vào DB cô lập `warehouse_restore_validation_20261029`. Chưa chạy restore trên staging/managed; lịch hệ thống chưa cấu hình.


## Nâng cấp scanner (2026-11-02)
- Bảng kết nối QR trên desktop hiển thị inline, không che phiếu; session đã xác thực và WebSocket owner vẫn được giữ khi ẩn bảng. Có thời lượng phiên, số lượt nhận, barcode gần nhất và trạng thái đang xử lý.
- Dòng phiếu nháp hiển thị barcode, tổng loại/số lượng/giá trị, nút `+`/`−`, chỉnh số nguyên tối thiểu 1 và xóa riêng; dòng vừa quét được highlight. Scan xử lý tuần tự và dedupe theo `eventId`.
- Camera yêu cầu lý tưởng 1280×720, ZXing TRY_HARDER với chu kỳ 80 ms, focus/zoom theo capability và re-arm sau 350 ms không giải mã. Mobile giữ event chưa ACK trong outbox bộ nhớ và retry cùng `eventId` khi timeout/reconnect; reload/đóng tab làm mất event chưa ACK.
- Xác minh: `npm run build` đạt; `npm run test:vercel-routing` đạt 9/9; `python -m pytest -q -p no:asyncio` đạt 25 passed, 7 skipped. Pytest mặc định lỗi INTERNALERROR khi collect với pytest-asyncio trong môi trường hiện tại. Chưa thử camera, pairing, autofocus/zoom hoặc mạng chập chờn trên Android/iPhone thật.

## Sửa CORS Vercel Preview ↔ Render (2026-11-02)
- Source trước sửa chỉ cho phép `CORS_ORIGINS` (mặc định localhost); Pydantic Settings chưa có `cors_origin_regex`. `CORSMiddleware` chỉ được khai báo một lần, credentials tắt, methods/headers giới hạn như hiện tại. Không có `render.yaml`.
- Đã thêm `CORS_ORIGIN_REGEX` (mặc định `None`) vào Settings và nối với middleware. Regex Preview được cấu hình bằng environment variable trên Render; Production vẫn dùng `CORS_ORIGINS`, local whitelist mặc định không đổi. Docker Compose cũng chuyển tiếp biến mới.
- Thêm test `TestClient` qua middleware thật cho Production, hai Preview Foundation, project khác, suffix giả mạo, HTTP, preflight bootstrap, methods/headers, và defaults local.
- Kiểm thử: backend `python -m pytest -q -p no:asyncio` đạt 34 passed, 7 skipped; routing tests 9/9; frontend build và `docker compose config --quiet` đạt. Chưa deploy/restart Render và chưa xác minh browser/production; cần đặt biến theo `docs/render-deployment.md`.

## SV2 scanner transactions (2026-11-12)
- Thêm scanner gate tại phiếu nhập/xuất: GATE_A tạo draft IN, GATE_B tạo draft OUT; dùng camera/manual và QR receiver hiện có. Mỗi scan tạo một draft riêng, không tự confirm hay đổi tồn.
- Client lưu queue transaction theo user trong LocalStorage trước khi gửi; UUID v4 `idempotencyKey` riêng với `scanEventId`, giữ nguyên request body/key khi retry. Web Locks được dùng nếu có; fallback dùng lease LocalStorage. Network/timeout retry backoff tối đa 8 lần; API 400/403/404/409/422 vào dead-letter, 401 yêu cầu auth.
- `POST /documents` nhận metadata tùy chọn scan point, scan event UUID và client timestamp; creator user được lấy từ authenticated `CurrentUser`. DB migration `0009_scanner_transaction_attribution` phụ thuộc revision `0008_scanner_gate_attribution` đang tồn tại dưới dạng thay đổi chưa commit trong workspace.
- Kiểm tra: frontend build, routing/source tests và backend unit suite chạy sau cập nhật; PostgreSQL tests còn skip. Chưa xác minh migration trên DB thật, browser/mobile E2E, quota limit hoặc tranh chấp multi-tab thực tế.

## P04 scanner transaction manager (2026-11-12)
- User phê duyệt thiết kế P03 để triển khai phần client. Gate transaction queue chuyển sang IndexedDB, có migrate queue LocalStorage cũ sau khi IDB commit; không sửa `/documents`, schema hay auth/RBAC backend.
- Scanner gate tái sử dụng camera/QR hiện có; mỗi accepted scan chụp snapshot context, tạo UUID v4 idempotency key khác scanEventId/barcode, validate trước khi enqueue. Queue write hoàn tất trước khi gọi sync; persistence failure không gọi API. Retry giữ nguyên key/body; cùng barcode nhưng event mới tạo transaction mới; double-submit manual và event đang xử lý được guard.
- Web Locks + BroadcastChannel; fallback atomic lease trong IndexedDB. Queue keyed theo user. `createdAt` response lưu local thành serverTimestamp; không thêm API field.
- Unit tests gate transaction: 7 passed; routing source/contract tests 10/10; frontend build đạt tại lần chạy cuối. Đây không chứng minh write/read IndexedDB trong browser hoặc camera/API runtime.
- P02 blockers giữ nguyên: chưa xác nhận DB test/staging, API contract/SV3/SV4 approval chưa được chứng minh, backend không chạy trong phiên kiểm tra. Không chạy PostgreSQL, migration, API runtime, browser multi-tab hay camera E2E. P04 không được đánh dấu acceptance hoàn tất trước các kiểm tra này.

## P05 offline-first queue (2026-11-12)
- IndexedDB queue nâng schema lên version 2, sequence/queueOrder được ghi atomically cùng record; backfill P04 records khi upgrade. FIFO head-of-line: retry/auth pause không bị vượt qua; record không bị xóa khi thành công mà chỉ chuyển SYNCED sau server response.
- LocalStorage migration validate toàn bộ nguồn trước ghi; record+sequence+marker ở cùng IDB transaction; chỉ xóa nguồn sau commit. Marker cho phép cleanup retry sau crash giữa commit và xóa source; lỗi giữ nguyên LocalStorage.
- Lifecycle bổ sung PAUSED_AUTH (đọc tương thích AUTH_REQUIRED), API `/health` probe timeout 5s, event online/offline/visibility, timeout requests 15s và poll 5s cho pending khi API chưa reachable; không dựa riêng navigator.onLine.
- Kiểm tra P05: `npm run build` đạt; gate unit 11/11; scanner/routing source-contract 11/11. Chưa có browser IndexedDB harness nên offline multi-scan/reload/browser restart, migration thực tế, quota, multi-tab/crash và reconnect E2E chưa được chứng minh.
- P02 blocker vẫn mở; không kết nối DB/API runtime. P05 implementation đã có nhưng acceptance chưa hoàn tất đến khi browser persistence test chạy trên môi trường được xác nhận.
