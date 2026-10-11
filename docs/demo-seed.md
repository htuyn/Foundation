# Seed dữ liệu demo PostgreSQL

Chạy từ workspace bằng Docker Compose:

```powershell
docker compose exec -T backend python -m app.seed_demo
```

Backend dùng cấu hình Compose hiện có (`POSTGRES_HOST=postgres`, `POSTGRES_DB=warehouse_db`); không cần ghi đè `.env`, tạo database hay chạy migration.

## An toàn và chạy lại

- Toàn bộ dữ liệu nhận diện bằng prefix `DEMO-`/`DEMO |` và UUID ổn định.
- Script ghi trong một transaction, chia batch 500 dòng và dùng `ON CONFLICT DO NOTHING`; không cập nhật/xóa hàng có sẵn. Khi chạy lại, các bản ghi đã có được giữ nguyên.
- Nếu mã unique của demo xung đột với một hàng không thuộc seed, transaction sẽ lỗi/rollback thay vì xóa hoặc ghi đè dữ liệu đó.
- Phiếu nhập/xuất đã xác nhận có movement cho từng dòng; số dư đầu kỳ được biểu diễn bằng movement loại `Điều chỉnh`. Phiếu nháp/hủy không làm thay đổi tồn.
- Scanner chỉ có sự kiện hợp lệ trong schema hiện tại. Schema không có trạng thái cho lần quét thất bại; session demo đã kết thúc và không chứa token có thể sử dụng.
- Model Product hiện không có trường mô tả hoặc giá bán, nên seed chỉ ghi tên, SKU/barcode, category, unit, cost, min_stock và status theo schema.

## Quy mô được tạo

10 kho, 50 nhà cung cấp, 30 danh mục, 1.000 sản phẩm, 3.000 cặp tồn kho, 600 phiếu (540 xác nhận, 30 nháp, 30 hủy), 6.000 dòng, 8.250 movements, 1.175 audit logs, 1 scanner session đã kết thúc và 200 scan events.
