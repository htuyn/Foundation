# Triển khai backend trên Render và CORS với Vercel

Trong Render Dashboard, mở **Foundation warehouse API → Environment** và cấu hình các biến sau:

| Biến | Giá trị |
|---|---|
| `CORS_ORIGINS` | `https://foundation-wheat-tau.vercel.app` |
| `CORS_ORIGIN_REGEX` | `^https://foundation-[a-z0-9-]+-kthp-s-projects\.vercel\.app$` |
| `AUTH_SECRET_KEY` | Secret ngẫu nhiên tối thiểu 32 byte; lưu trong Render Environment, không commit |
| `APP_ENV` | `production` |
| `AUTH_COOKIE_DOMAIN` | Domain dùng chung nếu frontend/API dùng custom subdomain, ví dụ `.example.com`; để trống nếu không dùng |

`CORS_ORIGINS` là danh sách origin phân tách bằng dấu phẩy và dùng cho Production hoặc origin cố định khác. `CORS_ORIGIN_REGEX` mở quyền cho deployment Preview theo đúng tên project `foundation` và team `kthp-s-projects`; không dùng wildcard `*.vercel.app`. Sau khi lưu biến, Render cần deploy/restart service để tiến trình FastAPI nạp cấu hình mới.

Backend đọc hai biến bằng Pydantic Settings (tên biến môi trường tương ứng với `cors_origins` và `cors_origin_regex`, không phân biệt hoa thường). Local mặc định giữ nguyên whitelist localhost; regex mặc định rỗng/`None`, do đó Preview không được mở trong local nếu chưa chủ động cấu hình. Compose truyền tiếp `CORS_ORIGIN_REGEX` từ `.env` khi cần kiểm tra cục bộ.

Middleware bật `allow_credentials=True` để nhận refresh cookie; origins vẫn phải khớp allowlist/regex, không dùng wildcard. Methods/headers cho phép được giữ hẹp, trong đó có `Authorization` và `X-CSRF-Token`. Regex chỉ chấp nhận HTTPS host kết thúc chính xác bằng `.vercel.app` với cấu trúc Preview nêu trên; không chấp nhận domain thêm suffix như `.evil.com`, HTTP, hoặc project Vercel khác.

Auth dùng refresh cookie `HttpOnly; Secure; SameSite=None` production và CSRF token. Vercel/Render hostname mặc định có thể bị chính sách trình duyệt chặn third-party cookies; nên cấu hình frontend/API trên custom subdomain cùng registrable domain, đặt `AUTH_COOKIE_DOMAIN` thành domain cha và dùng HTTPS. Không mở wildcard CORS để né giới hạn này.

## Xác minh sau deploy

Thử `OPTIONS https://foundation-warehouse-api.onrender.com/api/v1/bootstrap` với header `Origin` là từng origin Production/Preview và các header preflight `Access-Control-Request-Method: GET`, `Access-Control-Request-Headers: authorization,content-type`. Origin hợp lệ phải nhận `Access-Control-Allow-Origin` đúng origin và `Access-Control-Allow-Credentials: true`; origin khác phải không có header này. Sau đó bootstrap tài khoản admin bằng lệnh CLI, đăng nhập từ deployment frontend, xác nhận refresh sau tải lại, logout, vô hiệu hóa user và RBAC. TestClient trong repository chỉ xác minh middleware trong ứng dụng test, không thay thế xác minh deployment Render/trình duyệt.
