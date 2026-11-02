# Scanner smartphone — hướng dẫn và hợp đồng tích hợp

## Dùng thử

1. **Sản phẩm:** form sản phẩm hỗ trợ nhập barcode, camera trực tiếp trên thiết bị hiện tại và máy quét USB/Bluetooth; không còn nút ghép nối điện thoại. Camera dừng khi nhận mã, không tự lưu.
2. **Tra cứu:** trang **Quét mã vạch** giữ camera trực tiếp, nhập barcode/SKU và scanner QR từ xa riêng cho tra cứu. Lookup dùng backend; thêm vào danh sách thao tác chỉ sửa basket tạm, không tạo phiếu hoặc tăng tồn. QR_CODE được phân loại riêng.
3. **Nhập kho bằng desktop và camera điện thoại:** trên máy tính mở phiếu nhập rồi nhấn **Quét bằng điện thoại (QR)**. Điện thoại quét QR kết nối bằng camera thường và mở trang scanner. Sau khi backend xác thực nonce, ghép nối phiên và WebSocket báo kết nối, trang tự yêu cầu camera sau; nếu trình duyệt chặn hoặc chưa cấp quyền, nhấn **Cho phép camera / Bật camera** và cấp quyền trong trình duyệt. Barcode chuyển qua WebSocket về form đang mở trên desktop, được tra tuần tự qua API và thêm/cộng số lượng theo `productId`; một `eventId` retry không cộng lần nữa, còn một lần quét mới cùng barcode vẫn tăng số lượng. Bảng kết nối nằm trong form, không che dòng phiếu; số lượt nhận, thời gian phiên và lần nhận gần nhất được hiển thị realtime. Barcode chưa có sẽ mở form tạo nhanh trên desktop, giữ nguyên mã và tạm dừng queue tới khi tạo/bỏ qua. Có thể **Ẩn cửa sổ** kết nối trên desktop để chỉnh thông tin sản phẩm; receiver vẫn chạy, phiên và camera điện thoại không bị ngắt. Chỉ **Ngắt kết nối** mới chủ động kết thúc phiên. Phiếu chỉ cộng tồn sau khi nhân viên lưu và chủ động xác nhận.
4. **Quét trực tiếp tùy chọn:** nếu đang mở ứng dụng trên điện thoại hoặc thiết bị có camera, nhấn **Quét trên thiết bị này** trong form nhập. Đây là camera trực tiếp trong form, không dùng QR/WebSocket.
5. **LAN trên Windows:** có thể chạy Compose qua `./scripts/start-lan-scanner.ps1`, hoặc giữ backend hiện tại và chạy Vite trực tiếp bằng `./scripts/start-lan-vite.ps1` (mặc định cổng `5174`, chọn cổng khác bằng `-Port`). Cài mkcert trước bằng `winget install --id FiloSottile.mkcert --exact --source winget`. Script Vite kiểm tra backend tại `127.0.0.1:8000`, chọn IPv4 private, tạo HTTPS cert có SAN cho IP và localhost, đặt API proxy `/api/v1` cùng QR origin LAN, rồi khởi chạy Vite. API và WebSocket đi qua proxy; không cần mở cổng backend/PostgreSQL cho điện thoại.
6. **WebSocket tùy chọn:** QR remote dùng URL cùng origin, giữ prefix `/api/v1`, proxy tới backend route `/api/v1/ws/scanner/sessions/{session_id}`. Đây không phải luồng bắt buộc để nhập kho bằng camera trực tiếp.
7. **HTTPS và chứng chỉ:** mobile yêu cầu secure context; HTTP qua IP LAN không đủ. Script tạo HTTPS cert nhưng không tự import CA vào trust store. Import `rootCA.pem` (đường dẫn do script in ra) vào Current User > Trusted Root Certification Authorities trên Windows và cài/bật trust trên điện thoại theo hướng dẫn hệ điều hành; không chia sẻ `rootCA-key.pem` hoặc private key frontend. Không tiếp tục nếu trình duyệt còn cảnh báo chứng chỉ. Dùng URL Desktop/Phone được script in ra. Cho phép cổng Vite qua Windows Firewall chỉ trên mạng Private nếu cần; không mở PostgreSQL. Nếu Wi-Fi Windows được đánh dấu Public, đổi loại mạng sang Private chỉ khi đó là mạng đáng tin cậy.
8. **Không tắt TLS:** không bỏ qua cảnh báo chứng chỉ. Production cần reverse proxy HTTPS, SPA fallback `/scanner/mobile`, CORS allowlist đúng. API chưa có authentication/authorization người dùng nên không mở dịch vụ ra mạng không tin cậy.
## Ranh giới demo

- Camera sản phẩm chỉ đọc mã; lưu sản phẩm vẫn do người dùng xác nhận và API/database unique index là nguồn kiểm tra cuối cùng.
- Barcode camera trực tiếp và scanner QR từ xa là hai luồng tách biệt. Luồng trực tiếp tra cứu sản phẩm ngay ở browser hiện tại; QR chuyển event từ một thiết bị khác về máy tính.
- Luồng QR chỉ hoạt động với backend API. Không có localStorage/BroadcastChannel hay công cụ phát scan giả để giả lập kết nối hoặc kết quả nghiệp vụ.
- API mode xác thực QR nonce dùng một lần, session và device bearer. Sự kiện gửi tới backend rồi được phát cho máy tính; scan không cập nhật tồn kho.
- Scanner tokens chỉ giới hạn quyền trong phiên, không phải đăng nhập tài khoản hoặc phân quyền nghiệp vụ.
- Camera sản phẩm hỗ trợ EAN-13, EAN-8, UPC-A, UPC-E, Code 128 và Code 39; camera trực tiếp và mobile bật ZXing TRY_HARDER, yêu cầu lý tưởng 1280×720 và thử giải mã mỗi 80 ms. Camera áp dụng lấy nét liên tục/zoom khi browser cung cấp capability, ưu tiên camera sau và cho đổi camera/đèn flash nếu hỗ trợ. Barcode giữ liên tục trong khung chỉ tính một lượt; re-arm sau 350 ms không nhận diện. Giá trị này chưa được kiểm thử thực tế trên Android/iPhone. QR_CODE được phân loại riêng và không tự thêm vào phiếu kho.

## Tích hợp backend hiện tại

- Khi chạy Vite trực tiếp, `.env` cần `VITE_API_BASE_URL=/api/v1` và `VITE_DEV_API_TARGET=http://127.0.0.1:8000`. Lưu `.env` dạng UTF-8 không BOM; BOM ở đầu file có thể khiến Vite bỏ qua biến đầu tiên. Khởi động lại Vite sau khi sửa cấu hình. `VITE_SCANNER_MOBILE_BASE_URL` có thể để trống trong local dev; QR phải dùng origin HTTPS truy cập được từ điện thoại, không dùng `localhost`. Script `scripts/start-lan-vite.ps1` tự cấu hình API proxy và origin HTTPS LAN.
- `src/features/scanner/types.ts`: `ScannerSession`, `ScanEvent`, `ScanResult`, `ConnectionStatus`, `ScannerError` và service contracts.
- `scannerService.ts`: remote WebSocket chỉ hoạt động khi có `VITE_API_BASE_URL`; không cấu hình API thì remote scanner bị disable, không giả lập đồng bộ. REST API dành cho tạo session, join, đọc lại event và tương thích client cũ; WebSocket device gửi scan payload, owner nhận broadcast.
- `BarcodeScannerDialog.tsx`: camera trực tiếp, chọn thiết bị, tùy chọn đèn flash/zoom, quyền/lỗi camera, nhập thủ công và dọn media tracks. Chế độ mặc định đọc một mã; `continuous` giữ camera hoạt động, không lặp khi barcode còn trong khung và re-arm sau 350 ms vắng mã.
- `RemoteScannerButton.tsx`: mở QR/WebSocket; trong phiếu nhập desktop chuyển event barcode tới form đang mở. Sản phẩm không dùng nút pairing.
- `ScannerConnectionDialog.tsx`: tạo/đóng session, nonce QR xoay trước khi hết hạn, WebSocket nhận event; bảng trạng thái inline không che form, nút ẩn không đóng session, nút **Ngắt kết nối** mới đóng phiên chủ động. `RemoteScannerButton` giữ receiver mounted khi bảng bị ẩn để xử lý scan trong lúc desktop sửa sản phẩm.
- `ScannerMobilePage.tsx`: giao diện mobile-first, camera sau ưu tiên, quét liên tục với re-arm 350 ms, pause/resume, chọn camera, flash/zoom/focus theo capability, nhập tay, feedback rung/âm thanh tùy browser. Sự kiện chưa ACK được giữ trong outbox bộ nhớ và tự retry cùng `eventId` khi kết nối phục hồi; reload/đóng tab vẫn làm mất outbox chưa xác nhận.
- `ScannerBasketContext.tsx`: danh sách thao tác tạm trên máy tính; không lưu localStorage và không tự ghi tồn kho.

## Hợp đồng API

- `POST /api/v1/scanner/sessions` — tạo phiên, trả session ID, owner token và `expiresAt`.
- `POST /api/v1/scanner/sessions/{sessionId}/qr` — owner bearer phát nonce QR dùng một lần và `expiresAt`; frontend tự ghép session ID/nonce vào `/scanner/mobile` dưới `VITE_SCANNER_MOBILE_BASE_URL` (hoặc origin hiện tại trong development), rồi dùng thư viện `qrcode` để render. Modal chỉ gọi route này khi origin HTTPS hợp lệ; HTTP/localhost hoặc thiếu production origin sẽ chặn QR và thông báo lý do.
- `POST /api/v1/scanner/sessions/{sessionId}/join` — mobile gửi QR nonce và tên thiết bị; trả device bearer.
- `GET /api/v1/scanner/sessions/{sessionId}` — owner bearer đọc trạng thái phiên/thiết bị.
- `WS /api/v1/ws/scanner/sessions/{sessionId}/device` — device token qua subprotocol; mobile gửi scan message, backend ACK và persist idempotent theo `eventId`.
- `POST /api/v1/scanner/sessions/{sessionId}/scans` — REST ingestion tương thích cũ, device bearer và `eventId` idempotency.
- `GET /api/v1/scanner/sessions/{sessionId}/scans` — owner bearer đọc event đã nhận.
- `POST /api/v1/scanner/sessions/{sessionId}/close` — owner bearer kết thúc phiên.
- `POST /api/v1/scanner/sessions/{sessionId}/leave` — device bearer thu hồi và kết thúc phiên từ điện thoại.
- `WS /api/v1/ws/scanner/sessions/{sessionId}` — subprotocol `scanner.v1` và owner token; phát event cho máy tính đã xác thực.

Backend lookup barcode riêng bằng `GET /api/v1/products/lookup?barcode=...`, không nhầm barcode với SKU; lookup `?code=...` cũ vẫn tìm cả hai để tương thích. Scanner owner/device token dạng capability được hash ở DB; nonce QR dùng một lần, `eventId` idempotent, `/leave` thu hồi device token. Backend lưu/broadcast nhiều scan event trong cùng session; mỗi event không tự đóng phiên. Desktop lookup sản phẩm rồi cập nhật state của form nhập đang mở. Chi tiết phiếu chưa được ghi PostgreSQL sau từng scan: form persist thành phiếu nháp khi người dùng bấm lưu; đây là giới hạn hiện tại. Scanner session chưa có liên kết DB tới document ID; callback chỉ ràng buộc phiên với form phía frontend. Hiện chưa có authentication/authorization người dùng. Rate limiter và WebSocket registry process-local; nhiều worker cần shared store/pub-sub. PostgreSQL integration tests chỉ chạy khi `RUN_POSTGRES_INTEGRATION_TESTS=1` và DB sẵn sàng. Camera/WebSocket hai thiết bị thật chưa được xác minh.

## Triển khai frontend trên Vercel

- Frontend Vite nằm tại thư mục gốc repository (cùng cấp `package.json`, `vite.config.ts`, `index.html`); Vercel Project nên đặt **Root Directory** là `.` và Build Output Directory là `dist`.
- `vercel.json` rewrite các đường dẫn SPA về `/index.html`, để URL QR `/scanner/mobile?...` tải ứng dụng trước khi React Router xử lý route.
- Trong Vercel Project Settings → Environment Variables, cấu hình `VITE_API_BASE_URL` bằng URL HTTPS của backend Render kèm prefix `/api/v1` (không dùng `localhost` hoặc `/api/v1` tương đối cho production). Bắt buộc cấu hình `VITE_SCANNER_MOBILE_BASE_URL` ở **Production scope** bằng origin HTTPS công khai/canonical của frontend (không kèm path/query và không phải URL Preview). Production build sẽ không tạo QR nếu thiếu biến này; local development vẫn có thể fallback về origin đang mở.
- Vercel Deployment Protection không được điều khiển bởi React Router hoặc `vercel.json` này. Giữ Preview Deployment Protection; kiểm tra Production domain/deployment có đặt Vercel Authentication/Password Protection hay không. Không có cách loại trừ riêng `/scanner/mobile` khỏi protection bằng SPA rewrite. Nếu Production được bảo vệ, điện thoại sẽ cần Vercel login trước khi React chạy; chỉ thay đổi protection sau khi đánh giá quyền truy cập toàn ứng dụng, vì frontend hiện không có đăng nhập người dùng riêng.
- Các biến `VITE_*` được nhúng lúc build; sau khi thay đổi cần redeploy frontend. Không thay đổi xác thực phiên: backend vẫn kiểm tra owner/device token, nonce dùng một lần và hạn phiên/QR.

## Checklist xác minh thiết bị thật

- Android (Chrome): cấp quyền camera, pair QR, kiểm tra rear/front camera, focus, zoom/flash khi có, giữ barcode trong khung, đưa mã ra/vào lại, quét nhiều mã nhanh, tắt/bật Wi-Fi và xác nhận retry không tăng trùng.
- iPhone (Safari): lặp lại các bước trên qua HTTPS có certificate trusted; kiểm tra tự bật camera sau, chọn camera, quyền khi quay lại trang và trạng thái WebSocket sau khóa/mở màn hình.
- Hiện chưa có kết quả phần cứng cho hai checklist; 1280×720, TRY_HARDER và 350 ms chỉ là cấu hình source, không phải số đo benchmark.



