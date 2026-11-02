# Triển khai backend trên Render và CORS với Vercel

Trong Render Dashboard, mở **Foundation warehouse API → Environment** và cấu hình các biến sau:

| Biến | Giá trị |
|---|---|
| `CORS_ORIGINS` | `https://foundation-wheat-tau.vercel.app` |
| `CORS_ORIGIN_REGEX` | `^https://foundation-[a-z0-9-]+-kthp-s-projects\.vercel\.app$` |

`CORS_ORIGINS` là danh sách origin phân tách bằng dấu phẩy và dùng cho Production hoặc origin cố định khác. `CORS_ORIGIN_REGEX` mở quyền cho deployment Preview theo đúng tên project `foundation` và team `kthp-s-projects`; không dùng wildcard `*.vercel.app`. Sau khi lưu biến, Render cần deploy/restart service để tiến trình FastAPI nạp cấu hình mới.

Backend đọc hai biến bằng Pydantic Settings (tên biến môi trường tương ứng với `cors_origins` và `cors_origin_regex`, không phân biệt hoa thường). Local mặc định giữ nguyên whitelist localhost; regex mặc định rỗng/`None`, do đó Preview không được mở trong local nếu chưa chủ động cấu hình. Compose truyền tiếp `CORS_ORIGIN_REGEX` từ `.env` khi cần kiểm tra cục bộ.

Middleware giữ `allow_credentials=False` và methods/headers hiện tại. Regex chỉ chấp nhận HTTPS host kết thúc chính xác bằng `.vercel.app` với cấu trúc Preview nêu trên; không chấp nhận domain thêm suffix như `.evil.com`, HTTP, hoặc project Vercel khác.

## Xác minh sau deploy

Thử `OPTIONS https://foundation-warehouse-api.onrender.com/api/v1/bootstrap` với header `Origin` là từng origin Production/Preview và các header preflight `Access-Control-Request-Method: GET`, `Access-Control-Request-Headers: authorization,content-type`. Origin hợp lệ phải nhận `Access-Control-Allow-Origin` đúng origin; origin khác phải không có header này. Sau đó gọi `GET /api/v1/bootstrap` từ từng deployment Vercel thật để xác nhận cả CORS lẫn truy cập API/Database. TestClient trong repository chỉ xác minh middleware trong ứng dụng test, không thay thế xác minh deployment Render.
