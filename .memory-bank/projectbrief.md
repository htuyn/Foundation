# Project Brief

## Sản phẩm
Smart Warehouse là ứng dụng quản lý kho gồm frontend React và backend FastAPI, lưu trữ PostgreSQL. Dự án phục vụ theo dõi sản phẩm, kho, tồn, nhà cung cấp, phiếu nhập/xuất, lịch sử và báo cáo.

## Mục tiêu
- Hỗ trợ quy trình quản lý kho trên desktop và thiết bị di động.
- Đảm bảo xác nhận phiếu nhập/xuất cập nhật tồn kho và lịch sử giao dịch nhất quán.
- Cho phép tra cứu mã vạch, bao gồm scanner điện thoại kết nối từ xa khi backend hoạt động.
- Duy trì chế độ demo local khi chưa cấu hình backend.

## Phạm vi hiện tại
- Frontend: dashboard, quản lý sản phẩm/danh mục/kho/nhà cung cấp/người dùng, tồn kho, phiếu, giao dịch, báo cáo, audit, đăng nhập và scanner.
- Backend: REST API `/api/v1`, xác thực access/refresh token, RBAC, kiểm tra health/readiness, nghiệp vụ PostgreSQL và API scanner/WebSocket.
- Lược đồ DB được quản lý bằng SQLAlchemy và Alembic.

## Giới hạn quan trọng
- API mode có xác thực/RBAC; chế độ localStorage vẫn là demo và không có bảo mật tài khoản. Cần HTTPS, secret/CORS đúng cấu hình và rate limiting tại ingress trước khi công khai API.
- Chế độ localStorage không đồng bộ giữa thiết bị. Scanner từ xa thực sự yêu cầu API mode.
- Khả năng camera, WebSocket nhiều thiết bị và triển khai production cần kiểm thử thực tế.

## Tài liệu nguồn
Xem `README.md`, `docs/api-contract.md`, `docs/database-design.md`, `docs/frontend-backend-mapping.md` và `docs/integration-audit.md` để biết hướng dẫn/cấu hình/contract chi tiết.
