# System Patterns

## Kiến trúc
- Frontend SPA React/TypeScript: `src/App.tsx` định tuyến; `src/pages/` chứa màn hình; `src/data/WarehouseContext.tsx` quản lý snapshot và lựa chọn API/local mode.
- Scanner là feature riêng trong `src/features/scanner/`, có service API riêng.
- Backend FastAPI: router v1 tại `backend/app/api/v1/`; schemas Pydantic; service serialization/scanner; SQLAlchemy models và DB session riêng.
- PostgreSQL là nguồn dữ liệu bền vững ở API mode; Alembic quản lý migration.

## Quy tắc dữ liệu/nghiệp vụ
- API trả dữ liệu camelCase phù hợp frontend; DB dùng snake_case. Adapter serialization nằm ở backend.
- UUID được trả thành chuỗi, thời gian ISO 8601 UTC; số lượng là số nguyên và giá được lưu `NUMERIC(14,2)`.
- Xác nhận phiếu là thao tác cập nhật tồn, movement và audit trong transaction; tạo nháp không cập nhật tồn.
- Adjustment ghi delta có dấu; movement nhập/xuất biểu diễn quantity dương theo hợp đồng frontend.
- Barcode/SKU unique được kiểm tra bởi DB; frontend preflight chỉ giúp UX, không thay thế constraint DB.
- Scanner event không cập nhật tồn; event có idempotency key. Token/session scanner không phải cơ chế đăng nhập người dùng.

## Quy ước tích hợp
- Chỉ dùng API mode khi `VITE_API_BASE_URL` được cấu hình; lỗi API không fallback local.
- Bootstrap hiện tải snapshot đầy đủ; lọc/sắp xếp/phân trang UI chủ yếu thực hiện ở client.
- Thay đổi contract cần đồng bộ `src/types.ts`, `WarehouseContext`, schemas/serializers/API và các tài liệu `docs/` liên quan.

## Rủi ro kiến trúc đã biết
- API chưa có xác thực/phân quyền.
- WebSocket scanner dùng registry trong bộ nhớ một tiến trình; nhiều worker cần pub/sub dùng chung.
- Các endpoint list phân trang/tìm kiếm chưa được UI khai thác đồng nhất với semantics lọc hiện có.
