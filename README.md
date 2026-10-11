# Smart Warehouse

Ứng dụng quản lý kho gồm frontend React/TypeScript/Vite, backend FastAPI, SQLAlchemy 2.x, Alembic và PostgreSQL. Frontend giữ chế độ seed/localStorage khi `VITE_API_BASE_URL` chưa cấu hình; khi cấu hình, dữ liệu nghiệp vụ được tải và ghi qua backend.

## Chạy ứng dụng

Yêu cầu Node.js 20 trở lên.

```bash
npm install
npm run dev
```

Mở URL Vite hiển thị trong terminal (mặc định `http://localhost:5173`). Kiểm tra bản production bằng:

```bash
npm run build
npm run preview
```

## Chạy backend và PostgreSQL (Windows 11)

Yêu cầu Docker Desktop đang chạy và Python 3.12+.

1. Tạo cấu hình local, không commit `.env`:

   ```powershell
   if (-not (Test-Path .env)) { Copy-Item .env.example .env }
   ```

   Sửa `POSTGRES_PASSWORD` trong `.env` thành mật khẩu local của bạn.
2. Khởi chạy PostgreSQL, backend và Vite frontend qua Docker Compose:

   ```powershell
   docker compose up -d --build
   ```
3. Chạy migration một lần:

   ```powershell
   docker compose exec backend alembic upgrade head
   ```
4. Mở `http://localhost:5173`; frontend proxy `/api/v1` và WebSocket tới backend Compose. API docs ở `http://localhost:8000/docs`, API chỉ bind loopback host; PostgreSQL bind `127.0.0.1:5433`.
5. Để quét bằng điện thoại trên LAN, cần secure context HTTPS và chứng chỉ CA mà thiết bị tin cậy. Cài `mkcert` bằng `winget install --id FiloSottile.mkcert --exact --source winget`. Với Compose, chạy `./scripts/start-lan-scanner.ps1`. Để giữ backend trên `127.0.0.1:8000` và chạy Vite trực tiếp trên máy, chạy `./scripts/start-lan-vite.ps1` (mặc định cổng `5174`, có thể chỉ định `-Port`). Script chọn IPv4 private, tạo HTTPS cert và cấu hình API/QR URL cho phiên Vite đó; nó in đường dẫn `rootCA.pem`, cần import và tin cậy trên Windows lẫn điện thoại trước khi truy cập HTTPS. Không bỏ qua cảnh báo TLS. Chi tiết ở [`docs/scanner-mobile.md`](docs/scanner-mobile.md).

Chạy frontend bằng Node ngoài Compose ở HTTP vẫn được hỗ trợ để phát triển desktop: đặt `VITE_API_BASE_URL=/api/v1`, `VITE_DEV_API_TARGET=http://127.0.0.1:8000` trong `.env`, rồi `npm run dev`. Để dùng camera điện thoại qua QR, dùng script HTTPS LAN ở trên.

Chạy backend trực tiếp ngoài Docker: cài `backend/requirements.txt`, chỉ sao chép `backend/.env.example` thành `backend/.env` nếu file này chưa tồn tại, đặt `POSTGRES_HOST=localhost`, khởi động PostgreSQL riêng, sau đó từ `backend/` chạy `alembic upgrade head` và `uvicorn app.main:app --reload`.

Kiểm thử backend (không cần DB cho contract/validation tests):

```powershell
cd backend
python -m pip install -r requirements.txt
python -m pytest -q
```

## Tính năng hiện có

- Dashboard với KPI và biểu đồ được tính từ cùng dữ liệu sản phẩm, tồn kho và giao dịch.
- Quản lý sản phẩm, danh mục, kho, nhà cung cấp và tài khoản mô phỏng.
- Tìm kiếm, lọc, sắp xếp, phân trang ở các danh sách chính; xuất CSV sản phẩm, tồn kho, giao dịch và báo cáo.
- Lập phiếu nhập/xuất nháp; xác nhận phiếu sẽ cập nhật tồn kho và tạo lịch sử giao dịch. Phiếu xuất không thể vượt tồn tại kho.
- Điều chỉnh tồn có lý do, kiểm tra số lượng âm và ghi nhật ký.
- Tra cứu bằng barcode/SKU, báo cáo, nhật ký hoạt động, giao diện sáng/tối và khôi phục dữ liệu demo.
- Thiết kế responsive cho desktop và thiết bị di động.
- Phiếu nhập hỗ trợ kết nối camera điện thoại bằng QR trên desktop, đồng thời có camera trực tiếp trên thiết bị đang mở form. Trang tra cứu vẫn giữ QR remote riêng.

## Trạng thái và giới hạn

Backend đã có CRUD tài nguyên, tra cứu SKU/barcode, tồn kho, điều chỉnh, phiếu nhập/xuất, lịch sử, audit và API scanner. Mặc định Compose dùng API same-origin `/api/v1`; scanner từ xa dùng WebSocket với capability owner/device, QR nonce một lần; backend lưu scan event, desktop tra cứu sản phẩm qua API và cập nhật dòng trong form phiếu nhập đang mở. Phiếu vẫn là dữ liệu form cho đến khi lưu nháp; tồn kho chỉ đổi sau xác nhận. Danh sách người dùng/role không có đăng nhập hay phân quyền; API không nên được công khai ra mạng không tin cậy.

## Quét mã bằng điện thoại

Không có backend/API: QR scanner từ xa không hoạt động; camera trực tiếp vẫn dùng được trong secure context. Dev server proxy cần `VITE_API_BASE_URL=/api/v1`; không cấu hình API thành localhost trong bundle đưa cho điện thoại. Scanner QR lấy origin từ frontend hiện tại, có thể đặt `VITE_SCANNER_MOBILE_BASE_URL` khi dùng hostname HTTPS đã cấu hình. Xem [`docs/scanner-mobile.md`](docs/scanner-mobile.md) và [`docs/api-contract.md`](docs/api-contract.md).

Chi tiết mapping: [`docs/frontend-backend-mapping.md`](docs/frontend-backend-mapping.md). Schema DB: [`docs/database-design.md`](docs/database-design.md).
