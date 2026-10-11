# Product Context

## Người dùng và nhu cầu
Ứng dụng hướng tới người quản lý và nhân viên kho cần xem nhanh tình hình tồn, quản lý danh mục hàng hóa, tạo phiếu nhập/xuất và tra cứu giao dịch. Quản lý kho từ điện thoại hỗ trợ quét mã vạch bằng camera hoặc dùng điện thoại làm scanner từ xa cho giao diện desktop.

## Luồng chính
1. Xem dashboard/báo cáo được tính từ snapshot dữ liệu.
2. Quản lý sản phẩm, kho, danh mục và nhà cung cấp.
3. Tạo phiếu nhập/xuất nháp; xác nhận phiếu mới ghi movement và cập nhật tồn. Phiếu xuất không được vượt số lượng hiện có.
4. Điều chỉnh tồn kèm lý do, xem audit và lịch sử.
5. Tra cứu barcode/SKU. Quét mã không tự thay đổi tồn; cần thao tác nghiệp vụ phù hợp.

## Hành vi theo cấu hình
- Có `VITE_API_BASE_URL` (ví dụ `http://localhost:8000/api/v1`): dữ liệu nghiệp vụ đọc/ghi qua API. Khi API lỗi, ứng dụng báo lỗi và không tự chuyển sang localStorage.
- Không có biến trên: dùng dữ liệu seed và `localStorage` cho chế độ demo.
- Scanner QR từ xa chỉ hoạt động qua backend; chế độ demo được nhận diện rõ, không giả lập đồng bộ giữa thiết bị.

## Trải nghiệm hiện có
Giao diện responsive, có tìm kiếm/lọc/sắp xếp/phân trang phía client, xuất CSV, giao diện sáng/tối và camera ZXing. Một số giới hạn tích hợp và kiểm thử được liệt kê trong `docs/integration-audit.md`.
