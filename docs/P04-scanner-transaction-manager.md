# P04 – Scanner & Transaction Manager Implementation Report

**Trạng thái:** Client implementation hoàn tất ở mức source/unit; **acceptance chưa hoàn tất**.  
**Phạm vi:** P04 triển khai client theo thiết kế P03 được user phê duyệt. Không sửa API/backend/database contract, không chạy migration và không kết nối DB.

## Thay đổi chính

- Gate A dùng chế độ nhập kho; Gate B dùng chế độ xuất kho. Giữ `BarcodeScannerDialog`, QR pairing/WebSocket và `RemoteScannerButton` hiện có; không tạo transport/camera scanner mới.
- Thêm `gateTransactionCore.ts`: UUID v4 `idempotencyKey`, validation command, map request body theo `/documents` hiện tại, retry giữ key/body và manual double-click guard. `scanEventId` tách biệt idempotency key; cùng barcode ở scan mới có event mới và được nhận là transaction khác.
- Thêm `gateQueueStore.ts`: IndexedDB là persistent queue; migrate record LocalStorage cũ theo user, chỉ xóa bản cũ sau transaction commit. Có lease atomic trong IndexedDB, queue read/write theo user, server-created `createdAt` lưu local thành `serverTimestamp`, và storage estimate.
- Refactor `gateTransactions.ts`: queue được persist trước khi gọi sync; Web Locks ưu tiên, fallback lease IndexedDB; BroadcastChannel thông báo enqueue; đồng bộ, retry và DLQ tiếp tục dùng `authenticatedRequest()` hiện có.
- `GateScannerDialog.tsx` chỉ báo accepted sau khi IndexedDB persist thành công. Nếu IndexedDB/persistence lỗi, sync callback không chạy. Không lưu access/refresh token trong queue.
- Không đổi endpoint/schema/API contract. Request vẫn dùng `/products/lookup` và `POST /documents`, header `Idempotency-Key`, metadata/body field đang có. Không gửi barcode/user ID/device ID thành field API mới.

## File thay đổi trong P04

| File | Thay đổi |
|---|---|
| `src/features/scanner/gateTransactionCore.ts` | Mới – validation, transaction/key, request mapping, retry preparation và double-click helper |
| `src/features/scanner/gateQueueStore.ts` | Mới – IndexedDB queue, LocalStorage migration, lease và quota estimate |
| `src/features/scanner/gateTransactions.ts` | Refactor – queue API, sync, retry, multi-tab coordination |
| `src/features/scanner/GateScannerDialog.tsx` | Await persistence trước accepted/sync; context timestamp từ QR event; storage warning và guard |
| `tests/gate-transactions.test.mjs` | Mới – unit tests transaction/core/persistence ordering |
| `tests/vercel-routing.test.mjs` | Cập nhật source-contract assertions cho IndexedDB/API mapping; giữ test scanner cũ |
| `package.json` | Thêm `test:gate-transactions` script (Node 22 type stripping) |
| `docs/P03-software-architecture.md` | Ghi nhận user phê duyệt thiết kế; blockers P02 vẫn còn |
| `docs/scanner-mobile.md` | Cập nhật storage/queue behavior |
| `.memory-bank/activeContext.md`, `.memory-bank/progress.md` | Ghi trạng thái P04 và giới hạn xác minh |
| `docs/P04-scanner-transaction-manager.md` | Báo cáo này |

Không sửa `DocumentsPage.tsx`, camera component, QR service/protocol, auth client, backend/API/schema/model/migration hoặc stock confirmation trong P04.

## Kiểm tra

- `npm run build`: đạt.
- `npm run test:gate-transactions`: **7/7 passed**.
- `npm run test:vercel-routing`: **10/10 passed**; gồm contract/source checks cho scanner cũ và gate path.
- Unit tests bao gồm UUIDv4 tách scan event/barcode, validation, IN/OUT mapping, scan barcode mới, retry giữ key/body, persistence reject không gọi sync và double-click guard.

## Acceptance còn mở

Không được coi P04 acceptance hoàn tất chỉ dựa trên build/unit/source tests:

1. Chưa chứng minh IndexedDB write/read/reload thành công trên browser thật; persistence failure unit test kiểm tra thứ tự orchestration và nhánh môi trường không có IndexedDB, không thay thế browser IndexedDB/quota test.
2. Chưa chạy POST thật, server commit/timeout/replay, auth/RBAC runtime hoặc xác minh phiếu/audit DB. P02 báo DB `localhost:5432/warehouse_db` chưa được xác nhận là test/staging; backend runtime hiện không sẵn sàng. Không tự kết nối theo giới hạn P02.
3. Chưa chạy browser multi-tab, tab crash, Web Locks/fallback lease hay BroadcastChannel E2E.
4. Chưa chạy camera/browser/device E2E. Routing tests chỉ kiểm tra source contract, không mở camera.
5. P02 chưa xác nhận contract với SV3/SV4 và còn blocker scope idempotency theo principal ở backend. P04 không tự thay contract nên blocker này chưa được giải quyết.

**Kết luận:** P04 client source và unit-level acceptance đã triển khai; hệ thống **chưa đủ bằng chứng để tuyên bố P04 hoàn tất**. Cần DB test/staging được owner xác nhận, SV3/SV4 contract/security decision và browser/API/camera verification trước khi nâng trạng thái.
