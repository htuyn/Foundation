# Active Context

## Trạng thái hiện tại
- Đang duy trì ứng dụng quản lý kho React/Vite + FastAPI/PostgreSQL.
- Tích hợp CRUD, phiếu, tồn, audit và scanner API hiện đã có trong source. Xem `docs/integration-audit.md` để biết kết quả kiểm chứng và các mismatch còn tồn tại.
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
- Giới hạn cần nêu: backend scanner lưu scan event, desktop xử lý lookup và form state; chi tiết dòng phiếu chưa persist PostgreSQL sau từng scan, session chưa gắn document ID ở DB. Không có user auth/authorization; không mở dịch vụ trên mạng không tin cậy.
- Sửa 404 deep-link mobile scanner trên Vercel: thêm `vercel.json` SPA rewrite về `/index.html`; route React `/scanner/mobile`, query `mode/sessionId/expiresAt`, fragment `qrNonce/qrExpiresAt`, xác thực join và WSS vẫn giữ nguyên. Thêm Node built-in routing contract tests và ghi hướng dẫn Root Directory/config production Vercel. Cần kiểm tra Root Directory và các biến `VITE_*` trong dashboard Vercel, rồi xác minh bằng deployment thực tế; chưa có quyền kiểm tra dashboard hay chạy E2E trên điện thoại.
- Mobile QR scanner tự yêu cầu camera sau chỉ sau khi API join thành công và WebSocket xác nhận `connected`; camera attempt được khóa để tránh nhiều stream, callback bị vô hiệu khi dừng/unmount và tracks được dừng rõ ràng. Có fallback quyền camera, retry kết nối và retry camera; nonce/thời hạn/payload/ACK giữ nguyên. Chưa kiểm thử quyền/camera hoặc pairing trên thiết bị thật.

- Scanner desktop giữ `ScannerConnectionDialog` và event receiver mounted nhưng ẩn UI, nên có thể ẩn cửa sổ QR để sửa quick-create sản phẩm mà không đóng session hoặc mất callback scan. Chỉ nút “Ngắt kết nối” gọi close endpoint; backend scan event vốn không đóng phiên. Kiểm tra nhiều event đã được thêm vào PostgreSQL integration test, chưa chạy do không bật DB test.
- Triage Vercel mobile-login: source không có auth guard/redirect cho `/scanner/mobile`; route nằm ngoài `Layout`, SPA rewrite hiện có. QR chỉ fallback `VITE_SCANNER_MOBILE_BASE_URL` rỗng về origin đang mở, có thể là Preview deployment. Production hiện yêu cầu khai báo rõ public canonical origin bằng biến Production-scope; không có quyền xác minh hoặc đổi Deployment Protection trong Dashboard. Scanner session auth nonce/expiry không thay đổi.

## Việc cần chú ý khi tiếp tục
1. Camera thật và WebSocket hai thiết bị chưa kiểm thử; cần frontend/API HTTPS truy cập được trên điện thoại và PostgreSQL đang chạy.
2. Kiểm tra `docs/integration-audit.md` và các tài liệu contract trước khi đổi API hoặc nghiệp vụ.
3. Không suy diễn rằng kiểm thử audit trước đó vừa được chạy lại.
4. Không công khai API đến khi có authentication/authorization.
5. Các ưu tiên kỹ thuật được ghi trong audit: thống nhất server-side search/pagination, validation email và semantics giao dịch; xác minh camera/WebSocket trên thiết bị thật và browser E2E.
6. Production yêu cầu TLS hợp lệ, API HTTPS/WSS và CORS allowlist đúng origin.
7. Chưa test camera/WebSocket hai thiết bị thật. Mobile cần trusted HTTPS CA; chưa chạy Compose services do frontend image build vấp npm registry ECONNRESET.

## Quy tắc cập nhật
Sau thay đổi kiến trúc/tính năng/sửa lỗi, cập nhật tệp này cùng `progress.md` và các trang Memory Bank/`docs/` có liên quan. Giữ rõ trạng thái đã triển khai, đã kiểm chứng và chưa xác minh.

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
- Mobile/direct camera coi barcode giữ liên tục trong khung là một lần quét; scanner rearm sau khi barcode biến mất tối thiểu 700ms, cho phép quét lại có chủ ý mà không cộng lặp do camera giữ mã.
- `npm run build` và `npm run test:vercel-routing` đạt (9/9). Chưa thử QR/WebSocket hoặc camera trên thiết bị thật.

## Backend idempotency, Audit Log và backup (2026-10-29)
- Alembic `0005_idempotency_audit` thêm bảng `idempotency_requests` (khóa chính UNIQUE theo `idempotency_key`) và metadata có cấu trúc cho `audit_logs`.
- `POST /api/v1/documents` hỗ trợ `Idempotency-Key`: cùng key/cùng payload replay response ban đầu; cùng key/payload khác trả 409. `stock_documents.code` vốn UNIQUE; advisory transaction lock tiếp tục tuần tự hóa sinh mã PN/PX. Xuất/điều chỉnh vượt tồn trả 400 `INSUFFICIENT_STOCK`.
- Frontend API mode gửi và giữ `Idempotency-Key` cho retry cùng payload; xóa key tạm sau khi response và refresh bootstrap thành công.
- Ghi audit các API rejection 400/403/409 và mở rộng serializer; hoạt động CRUD/phiếu tiếp tục ghi log thành công. Actor lấy từ context gắn với `request.state.actor_name`; chưa có user authentication nên fallback vẫn là `Hệ thống`, SV4 cần đặt danh tính đã xác thực vào state này.
- Thêm script backup/restore PostgreSQL có SHA-256 và hướng dẫn lịch cron/staging/managed DB ở `docs/postgres-backup-restore.md`.
- Xác minh: backend PostgreSQL suite đạt 32 passed; frontend build và routing tests 7/7 đạt. Backup trước migration được tạo tại thư mục temp và kiểm tra SHA-256; Alembic `0004`–`0005` đã áp dụng lên PostgreSQL Compose local, backend container rebuild/restart, `/health/ready` trả ready và DB ở `0005_idempotency_audit`. Chạy thực tế cả hai script trong PostgreSQL container; checksum verified và restore `--clean` thành công vào DB cô lập `warehouse_restore_validation_20261029`. Chưa chạy restore trên staging/managed; lịch hệ thống chưa cấu hình.
