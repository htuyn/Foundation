# P05 – Offline-first Storage & Persistent Queue

**Trạng thái:** Đã triển khai source và unit/source tests; **acceptance persistent browser còn mở**.  
**Phạm vi:** Client scanner queue hiện có; không đổi backend/API contract hoặc database.

## Triển khai

- IndexedDB là nguồn lưu queue, DB version nâng lên 2. `queueOrder` được gán trong cùng readwrite transaction với transaction record và sequence metadata; queue được đọc theo thứ tự đó. Record đã có ở IndexedDB version 1 được backfill order lúc upgrade.
- Migration LocalStorage cũ theo user: parse và validate toàn bộ record trước khi mở giao dịch ghi; ghi record + sequence + migration marker trong một IndexedDB transaction; chỉ xóa LocalStorage sau khi IDB commit hoặc khi marker xác nhận migration trước đó đã commit. Parse/validation/IDB error giữ nguyên source. Có thể retry migration ở lần đọc sau.
- Không xóa record khi sync; chỉ đổi trạng thái thành `SYNCED` khi nhận response thành công từ `POST /documents`. Idempotency key và request body giữ nguyên cho retry.
- FIFO nghiêm ngặt: hàng đầu đang `RETRY_WAIT` (chưa đến hạn), `PAUSED_AUTH` hoặc `SYNCING` sẽ chặn xử lý các record tiếp theo. `SYNCED` và `DEAD_LETTER` được giữ nhưng không chặn hàng mới.
- Auth lifecycle dùng `PAUSED_AUTH`, đồng thời đọc giá trị legacy `AUTH_REQUIRED` để tương thích queue cũ.
- Connectivity: online/offline và visibility event, probe `GET /health` có timeout 5 giây, timeout request nghiệp vụ 15 giây, reconnect poll mỗi 5 giây nếu còn `PENDING`. Không dựa riêng vào `navigator.onLine`.
- Chống xử lý đồng thời tiếp tục dùng Web Locks; fallback claim/renew/release lease trong IndexedDB readwrite transaction và heartbeat.

## Kiểm thử

- `npm run build`: đạt.
- `npm run test:gate-transactions`: **11/11 passed**. Bổ sung kiểm thử pure-unit cho validation migration, FIFO/tie order, head-of-line retry/auth, và connectivity false→true/reconnect.
- `npm run test:vercel-routing`: **11/11 passed**, gồm source-contract kiểm tra IDB schema/migration, event lifecycle, API connectivity check và FIFO path.
- Các test trên không giả lập IndexedDB implementation thật. Persistence failure test chứng minh orchestration không gọi sync khi persist reject; migration validator và queue-order logic được test riêng.

## Acceptance chưa được chứng minh

Theo tiêu chí P05, chưa đánh dấu hoàn tất vì môi trường hiện tại không có browser automation/IndexedDB runtime test harness đã được phê duyệt:

1. Chưa thực hiện offline scan → nhiều transaction → reload khi offline → reconnect trên browser thật.
2. Chưa restart/đóng mở browser để xác minh IndexedDB tồn tại và không mất record.
3. Chưa chạy migration LocalStorage thành công/thất bại/rollback trên browser DB; chưa thử quota exceeded/eviction.
4. Chưa thử request timeout sau server commit, multi-tab, tab crash, Web Locks và fallback lease thực tế.
5. Chưa chạy API/camera E2E. P02 vẫn yêu cầu xác nhận môi trường test/staging/API contract; không kết nối DB/API runtime trong P05.

**Kết luận:** P05 implementation đã thêm FIFO, migration an toàn hơn, API connectivity/reconnect và lifecycle auth; build/unit/source-contract đều đạt. Tuy nhiên chưa có bằng chứng browser persistence qua reload/restart, nên **không kết luận P05 acceptance hoàn tất**. Cần chạy browser acceptance trên test/staging đã xác nhận trước khi đóng P05.

## File thay đổi trong P05

- `src/features/scanner/gateQueueStore.ts`
- `src/features/scanner/gateTransactions.ts`
- `src/features/scanner/gateTransactionCore.ts`
- `src/features/auth/authClient.ts`
- `src/features/scanner/GateScannerDialog.tsx`
- `tests/gate-transactions.test.mjs`
- `tests/vercel-routing.test.mjs`
- `docs/scanner-mobile.md`
- `.memory-bank/activeContext.md`
- `.memory-bank/progress.md`
- `docs/P05-offline-first-storage-queue.md`
