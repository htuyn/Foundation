# Active Context

## Trạng thái hiện tại
- Đang duy trì ứng dụng quản lý kho React/Vite + FastAPI/PostgreSQL.
- Tích hợp CRUD, phiếu, tồn, audit và scanner API hiện đã có trong source. Xem `docs/integration-audit.md` để biết kết quả kiểm chứng và các mismatch còn tồn tại.
- Frontend mặc định dùng snapshot/seed local; API mode được bật bởi `VITE_API_BASE_URL`.
- Memory Bank được khởi tạo ngày 2026-10-10 từ README, cấu hình, cấu trúc source và tài liệu audit hiện có.
- Camera scanner dùng ZXing cho tạo/sửa sản phẩm và tra cứu trên trang barcode; đã bổ sung nhập thủ công trong modal và dừng media tracks khi đóng, lỗi hoặc quét được.
- QR scanner từ xa vẫn được giữ: backend phát QR nonce dùng một lần; điện thoại gửi barcode qua WebSocket xác thực, backend lưu event và push tới desktop. `VITE_SCANNER_MOBILE_BASE_URL` tách URL QR frontend khỏi `VITE_API_BASE_URL`; QR không tự fallback sang localhost.
- Form phiếu kho tra cứu barcode qua backend và cập nhật đúng dòng bản nháp đang mở; không tạo sản phẩm, không xác nhận phiếu và không cập nhật tồn. Mobile scan liên tục, cooldown mặc định 1.8 giây có thể cấu hình.
- Giao diện frontend theo light enterprise design system: nền sáng, sidebar sáng, dashboard ưu tiên tồn kho và dữ liệu thật.
- Scanner LAN: QR ghép nối bị gỡ khỏi form sản phẩm; nút phone scanner chỉ hiện trong phiếu nhập (trang tra cứu vẫn giữ luồng QR riêng). Vite proxy API/WS same-origin; Compose có frontend service và PowerShell helper chọn IPv4 private, tạo HTTPS dev cert qua mkcert; DB/API host ports bind loopback. Phiếu nhập lookup sản phẩm qua API, hỗ trợ tạo nhanh sản phẩm hợp lệ rồi thêm vào form draft.
- Sửa WebSocket scanner: root `.env` dùng `/api/v1` qua Vite proxy thay vì `http://localhost:8000/api/v1`; URL WS suy ra host frontend và `ws/wss`, giữ prefix `/api/v1`. Nếu bundle/runtime vẫn khai báo localhost khi được mở qua host LAN, frontend chuẩn hóa API về cùng origin. Reconnect chống trùng và giới hạn 8 lần; terminal/owner auth REST errors dừng thử lại. Backend log accept/reject/error với session ID/role/reason, không ghi token; test route auth/session expiry đã thêm.
- Phiếu nhập có hai lựa chọn: desktop kết nối camera điện thoại qua QR/WebSocket để đẩy scan về form đang mở; hoặc quét camera trực tiếp trên cùng thiết bị. Cả hai dùng lookup API, cập nhật draft và không tự xác nhận/cộng tồn. Camera direct chạy liên tục, cooldown cùng mã 1,8 giây; barcode chưa đăng ký mở quick-create.
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
