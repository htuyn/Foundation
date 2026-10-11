# Mapping Frontend → API → PostgreSQL

Mapping này dựa trên `src/types.ts`, `src/data/seed.ts`, `src/data/WarehouseContext.tsx`, router `src/App.tsx`, các trang `src/pages/` và scanner trong `src/features/scanner/`. Frontend là React 18 + TypeScript + Vite, React Router 7. Khi `VITE_API_BASE_URL` được cấu hình, snapshot và các mutation nghiệp vụ đi qua FastAPI; nếu không, app dùng React Context cùng seed/localStorage demo. PostgreSQL/Alembic hiện đã được khởi tạo; tích hợp scanner API có endpoint tests nhưng chưa được kiểm chứng bằng hai thiết bị thật. `docs/erd/` là ERD tham khảo.

| Chức năng frontend | Dữ liệu cần / trường frontend | API cần có | Bảng database |
|---|---|---|---|
| Bootstrap dashboard và toàn ứng dụng | `WarehouseState`: products, categories, warehouses, inventory, documents, transactions, suppliers, users, auditLogs | `GET /api/v1/bootstrap` trả snapshot JSON cùng tên/enum camelCase của frontend; dữ liệu rỗng hợp lệ | Các bảng domain; projection từ `stock_movements` sang `transactions` |
| Sản phẩm (`ProductsPage`) | `Product`: id, sku, barcode, name, category (tên), unit, cost, minStock, status, createdAt | `GET/POST /products`, `GET /products/next-sku`, `GET/PUT/DELETE /products/{id}`, `GET /products/lookup?code=` | `products`, `categories`; camera chỉ đọc barcode, frontend preflight lookup trước lưu, PostgreSQL unique index là chốt cuối; khi sửa barcode hiện có cần xác nhận |
| Danh mục (`CategoriesPage`) | `string[]`; tạo, đổi tên, xóa | `POST /categories`, `PATCH/DELETE /categories/by-name/{name}` | `categories`; `products.category_id` FK; không xóa danh mục đang dùng |
| Kho (`WarehousesPage`) | id, code, name, address, manager, status | `GET/POST /warehouses`, `PUT/DELETE /warehouses/{id}` | `warehouses`; `manager` là text, không phải FK tới user; không xóa kho đã được tham chiếu trong tồn kho/phiếu/giao dịch |
| Nhà cung cấp (`SuppliersPage`) | id, code, name, phone, email, address, active | `GET/POST /suppliers`, `PUT/DELETE /suppliers/{id}` | `suppliers`; phiếu nhập gửi `supplierId` và backend kiểm tra trạng thái/quan hệ |
| Người dùng mô phỏng (`UsersPage`) | id, name, email, role, active, createdAt | `GET/POST /users`, `PUT /users/{id}` | `users`; chưa có mật khẩu, đăng nhập hoặc phân quyền backend |
| Tồn kho (`InventoryPage`) | productId, warehouseId, quantity, location; bộ lọc kho/trạng thái/tìm kiếm | `GET /inventory`; `POST /inventory/adjust` với productId, warehouseId, quantity delta, reason | `inventory` PK `(product_id, warehouse_id)`; `stock_movements` cho điều chỉnh |
| Phiếu nhập/xuất (`DocumentsPage`) | `WarehouseDocument`: id, code, type, warehouseId, supplierId?, partner, createdAt, status, note, lines; `DocumentLine`: productId, quantity, unitCost | `GET/POST /documents`, `POST /documents/{id}/confirm`, `POST /documents/{id}/cancel` | `stock_documents.supplier_id` FK tới `suppliers`; phiếu xuất tiếp tục dùng `partner`; cùng `stock_document_items`, `inventory`, `stock_movements`, `audit_logs` |
| Lịch sử giao dịch (`TransactionsPage`) | id, code, type, productId, warehouseId, quantity, actor, createdAt, source | `GET /transactions` với filter type, query, pagination tùy chọn | `stock_movements`; quantity API được chiếu đúng theo quy ước frontend |
| Dashboard/báo cáo | Tổng sản phẩm/tồn/giá trị/low stock; phiếu xác nhận; movement theo ngày; lọc thời gian | Hiện tính client-side từ bootstrap; không cần bảng KPI riêng | `products`, `inventory`, `stock_documents`, `stock_movements`, `categories`, `warehouses` |
| Tra cứu barcode/SKU | Barcode/SKU string, product, tổng tồn và tồn từng kho | `GET /products/lookup?code=`; việc tra cứu không cập nhật tồn | `products`, `inventory`, `warehouses` |
| Scanner từ xa qua QR | Session, mode, status, createdAt/expiresAt; QR nonce; eventId, sessionId, barcode, format, scannedAt, deviceId | `POST /scanner/sessions`; `POST /scanner/sessions/{id}/qr`; `GET /scanner/sessions/{id}`; `POST /scanner/sessions/{id}/join`; `POST /scanner/sessions/{id}/scans`; `POST /scanner/sessions/{id}/close`; `WS /ws/scanner/sessions/{id}` | `scanner_sessions`, `scanner_qr_tickets`, `scan_events`; chỉ API mode, không còn demo event simulator |
| Nhật ký hoạt động | id, message, createdAt, actor | Đọc qua bootstrap, phát sinh trong transaction CRUD/nghiệp vụ | `audit_logs`; actor hiện là snapshot text, chưa gắn FK user |
| Cài đặt và basket scanner | Alert threshold trong localStorage; basket React state tạm | Không có API nghiệp vụ tương ứng hiện tại | Không tạo bảng; không persist basket hoặc cài đặt local |

## Trạng thái kết nối

- `WarehouseContext` chọn API khi có `VITE_API_BASE_URL`; các thao tác mutation tải lại bootstrap sau khi ghi. Không có API base URL thì dùng seed/localStorage demo.
- Camera trực tiếp dùng component ZXing trong product form và trang tra cứu; hỗ trợ EAN-13/EAN-8/UPC-A/UPC-E/Code 128. Trang tra cứu gọi `/products/lookup`; scanner QR là remote device→backend→desktop, chỉ bật khi có API. HTTPS/WSS và CORS production phải được cấu hình ở reverse proxy/domain.
- Không cấu hình API base URL nghĩa là scanner dùng DEMO và ứng dụng tiếp tục local demo. Không có fallback local cho các thao tác backend hiện chưa được đấu nối.
- Chi tiết request/response, mã lỗi, bảo mật và giới hạn xem [`api-contract.md`](api-contract.md); schema xem [`database-design.md`](database-design.md).

## Quy tắc tương thích

- Response bootstrap giữ field camelCase đúng với `WarehouseState`; DB dùng snake_case và adapter serialize giữa hai lớp.
- ID PostgreSQL `UUID` trả về chuỗi; thời gian trả ISO 8601 UTC (`Z`). Giá dùng số thập phân JSON/`NUMERIC(14,2)`; số lượng là integer.
- `Product.category` trả tên danh mục, nhưng request cũng nhận tên như form hiện tại; backend resolve tên sang `category_id`.
- `WarehouseDocument.partner` giữ nguyên chuỗi để tương thích nhập/xuất; không ánh xạ sai thành nhà cung cấp.
- `Transaction.quantity` trả dương cho nhập/xuất và giữ dấu cho điều chỉnh như UI hiện đang hiển thị; DB ghi `quantity_delta` có dấu.
- Frontend không được coi session scanner là đã kết nối cho tới khi backend xác nhận join. QR barcode/event không sửa tồn; chỉ confirm phiếu tạo movement và cập nhật số dư atomically.
- Khi `VITE_API_BASE_URL` chưa được cấu hình, UI có thể tiếp tục chế độ local demo hiện có. Khi biến này được cấu hình, lỗi API/DB phải hiển thị lỗi và không âm thầm rơi về localStorage.
