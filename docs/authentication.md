# Xác thực và phân quyền

## Tổng quan

- API mode yêu cầu đăng nhập trước khi tải dữ liệu kho. Danh tính không còn được nhận từ `X-User-Id`.
- Access token HMAC-SHA-256 sống mặc định 15 phút, chỉ giữ trong bộ nhớ frontend; mỗi request nghiệp vụ gửi `Authorization: Bearer`.
- Refresh token ngẫu nhiên nằm trong cookie `HttpOnly`, chỉ lưu SHA-256 hash trong `auth_sessions`, xoay token mỗi lần refresh và thu hồi khi logout, vô hiệu hóa tài khoản hoặc đặt lại mật khẩu.
- Cookie CSRF riêng được kiểm tra cả header `X-CSRF-Token` lẫn origin cấu hình. Cookie production bật `Secure` và `SameSite=None`; local dùng `SameSite=Lax`.
- Mật khẩu được băm bằng scrypt (N=32768, r=8, p=1, salt ngẫu nhiên); API không trả hash/mật khẩu. Mật khẩu tối thiểu 6 ký tự, tối đa 128 ký tự. Mật khẩu ngắn dễ đoán kém an toàn; production nên dùng passphrase dài và riêng biệt.
- Role được lấy lại từ DB trên request, không tin role trong token. Quản lý tài khoản và đặt lại mật khẩu chỉ dành cho Quản trị viên; ít nhất một admin hoạt động phải được giữ lại.

## Khởi tạo và vận hành

Sau khi chạy `alembic upgrade head`, tạo admin đầu tiên từ thư mục `backend`:

```powershell
python -m app.create_admin --email admin@example.com --name "Quản trị viên"
```

Lệnh yêu cầu mật khẩu qua prompt ẩn (tối thiểu 6 ký tự). Tài khoản demo được tạo bởi `seed_demo` không có password hash và không thể đăng nhập. Admin có thể tạo user, gán một trong các vai trò `Quản trị viên`, `Quản lý kho`, `Nhân viên kho`, `Chỉ xem`, vô hiệu hóa tài khoản và đặt lại mật khẩu.

API auth:

- `POST /api/v1/auth/login`: email/password; trả access token, thông tin user và thiết lập refresh/CSRF cookies.
- `POST /api/v1/auth/refresh`: cần refresh cookie và CSRF header; xoay refresh token.
- `POST /api/v1/auth/logout`: thu hồi phiên và xóa cookies.
- `GET /api/v1/auth/csrf`: khôi phục CSRF token từ cookie khi tải lại frontend.
- `GET /api/v1/auth/me`: trả danh tính hiện tại.
- `PUT /api/v1/auth/users/{id}/password`: admin đặt lại mật khẩu và thu hồi các phiên của user.

`/health*` và `/api/v1/scanner/*` vẫn public có chủ đích; scanner dùng QR nonce/capability token độc lập, không phải phiên đăng nhập hệ thống. `/api/v1/bootstrap` và các API dữ liệu kho cần access token. User list chỉ trả cho admin; bootstrap trả `users: []` với vai trò khác.

## Cấu hình production

- Bắt buộc đặt `AUTH_SECRET_KEY` bằng ít nhất 32 byte entropy, ví dụ sinh qua secret manager hoặc `openssl rand -hex 32`. Không dùng giá trị mẫu, không commit secret. Production thiếu secret hoặc secret quá ngắn thì phát hành token sẽ thất bại.
- Đặt `APP_ENV=production`, CORS origin chính xác, và `AUTH_COOKIE_DOMAIN` nếu cần cookie dùng chung giữa các subdomain của cùng domain tổ chức.
- Vercel/Render hostname mặc định khác site; trình duyệt có thể chặn third-party cookies. Production nên dùng custom domain cùng registrable domain, ví dụ `app.example.com` và `api.example.com`, cấu hình frontend API URL, CORS và `AUTH_COOKIE_DOMAIN=.example.com`, đồng thời bắt buộc HTTPS.
- CORS bật credentials nhưng chỉ với origins/regex được allowlist; không cấu hình wildcard. Preview chỉ nên được cho phép bằng regex project cụ thể.
- Thiết lập rate limiting cho `/auth/login` ở ingress/API gateway trước khi mở công khai. API vẫn phải chạy sau HTTPS/TLS và không được mở trực tiếp không kiểm soát.

## Migration và kiểm thử

Migration `0007_user_auth_sessions` thêm `users.password_hash` nullable để giữ các user cũ ở trạng thái không thể đăng nhập cho tới khi admin bootstrap/đặt mật khẩu, đồng thời tạo bảng `auth_sessions`. Migration additive; chạy `alembic upgrade head` trước khi deploy backend/frontend.

Minimum hiện tại là 6 ký tự theo yêu cầu; mật khẩu ngắn dễ đoán, nên dùng passphrase dài và duy nhất trong môi trường thực tế.

Demo localStorage không có backend auth/RBAC và chỉ dành cho demo desktop. Chế độ đó được đánh dấu rõ trong UI; không dùng để bảo vệ production data.
