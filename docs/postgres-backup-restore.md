# PostgreSQL backup và restore

Hai script trong `scripts/` dùng PostgreSQL client tools, không cần cài thư viện Python:

- `backup_postgres.sh`: tạo custom-format dump (`pg_dump -Fc`) và file SHA-256 cạnh dump.
- `restore_postgres.sh`: xác minh SHA-256 trước, sau đó restore bằng `pg_restore` trong một transaction.

## Chạy thủ công

Đặt `DATABASE_URL` trong môi trường shell; không ghi connection string vào Git hoặc log. Script chấp nhận URI libpq `postgresql://...` và URI SQLAlchemy `postgresql+psycopg://...`. Có thể chọn thư mục backup bằng `BACKUP_DIR`.

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require'
export BACKUP_DIR="$HOME/backups/warehouse"
bash scripts/backup_postgres.sh

# Cách an toàn mặc định: restore vào database staging rỗng.
export DATABASE_URL='postgresql://STAGING_USER:PASSWORD@STAGING_HOST:5432/STAGING_DATABASE?sslmode=require'
bash scripts/restore_postgres.sh "$BACKUP_DIR/warehouse-YYYYMMDDTHHMMSSZ.dump"

# Chỉ khi staging đã có schema/dữ liệu cần thay bằng snapshot: xác nhận rõ thao tác clean.
RESTORE_ALLOW_CLEAN=YES bash scripts/restore_postgres.sh --clean "$BACKUP_DIR/warehouse-YYYYMMDDTHHMMSSZ.dump"
```

Mặc định script không xóa schema hoặc ghi đè object; hãy dùng database staging riêng, rỗng. Tùy chọn `--clean` yêu cầu thêm `RESTORE_ALLOW_CLEAN=YES` và xóa/thay các object có trong archive, nên chỉ dùng với staging đã xác nhận; không dùng với production. Backup role cần quyền đọc schema/dữ liệu/sequence; restore role cần quyền tạo object trong database đích. Với PostgreSQL managed, dùng URI và SSL mode do nhà cung cấp cấp; một số dịch vụ giới hạn quyền owner/extension nên phải chạy thử trên staging của đúng nhà cung cấp.

## Lịch sao lưu định kỳ

Trên Windows đã cấu hình thật qua Task Scheduler (2026-11-17):

- **Task**: `Foundation Postgres Backup` — chạy hằng ngày 02:00, `StartWhenAvailable` (chạy bù nếu máy tắt đúng giờ), chạy được khi dùng pin.
- **Script**: `scripts/backup_scheduled.ps1` — wrapper không cần Git Bash: copy `backup_postgres.sh` vào container postgres, strip CRLF, chạy pg_dump với `DATABASE_URL` build **bên trong container** từ env sẵn có (mật khẩu không xuất hiện trên dòng lệnh host), `docker cp` dump + `.sha256` về `backups/postgres/`, xác minh SHA-256 trên host, retention 30 ngày, log UTF-8 tại `backups/postgres/backup.log`.
- **Kết quả xác minh**: chạy thủ công qua `powershell -File` và qua scheduler đều exit 0, dump về host kèm checksum khớp.
- Yêu cầu khi chạy: Docker Desktop đang chạy, container `foundation-postgres-1` Up; máy user đăng nhập (task cấp user).

Trên Linux/managed, ví dụ cron chạy 02:00 UTC mỗi ngày (đặt biến môi trường an toàn qua secret manager hoặc file chỉ chủ sở hữu đọc được):

```cron
0 2 * * * . "$HOME/.config/warehouse-backup.env"; export DATABASE_URL BACKUP_DIR; cd /path/to/FOUNDATIONs && bash scripts/backup_postgres.sh >> "$HOME/warehouse-backup.log" 2>&1
```

Tạo file môi trường với quyền `600`; không đưa mật khẩu vào dòng cron. Trên Windows, có thể tạo tác vụ Task Scheduler chạy Git Bash với `bash.exe scripts/backup_postgres.sh`, cấu hình biến môi trường ở mức tài khoản dịch vụ và bật lưu lịch sử task. Cần giám sát mã thoát và dung lượng/lưu giữ backup; script hiện không tự xóa backup cũ.

## Kiểm thử khôi phục (staging)

1. Tạo dump và giữ cả file `.sha256`.
2. Tạo/chọn database staging rỗng và cấu hình `DATABASE_URL` trỏ đúng staging.
3. Chạy restore; nếu staging đã có schema, dùng `--clean` cùng xác nhận `RESTORE_ALLOW_CLEAN=YES`. Script dừng nếu checksum sai hoặc `pg_restore` thất bại.
4. Chạy `alembic current`/kiểm tra bảng và đối chiếu số lượng bản ghi, phiếu, tồn kho với nguồn phù hợp.
5. Ghi ngày, commit/hash backup, kết quả checksum, kết quả restore và người kiểm tra vào minh chứng MC03.

Việc chạy thử trên staging phụ thuộc quyền truy cập staging; không chạy restore lên database production.

## Trạng thái kiểm thử hiện tại

Trong workspace này đã tạo custom-format backup từ PostgreSQL Compose trước migration và đối chiếu SHA-256 thành công. Sau đó chạy cả hai script bên trong PostgreSQL container: `backup_postgres.sh` tạo dump/checksum; `restore_postgres.sh --clean` xác minh checksum và restore vào database local cô lập `warehouse_restore_validation_20261029`. Đây là xác minh luồng local pg_dump/pg_restore, chưa phải managed provider hay staging thật. Chưa có staging URI nên restore trên staging còn chưa xác minh.

### Diễn tập backup → restore trên staging Docker (2026-11-17)

Chạy đủ quy trình CV03 bằng hai script chính thức trong container `postgres` của stack staging đang chạy:

1. **Backup**: `backup_postgres.sh` tạo `warehouse-20261117T164915Z.dump` (775.182 byte) + `.sha256` (`b90202cd3f9c909eaf9deb0fe98b65001adc889e2c9e71983e0b116d7ebcaacc`).
2. **Restore**: tạo database validation cô lập `warehouse_restore_validation_20261117_164916`, chạy `restore_postgres.sh` (verify checksum OK trước khi `pg_restore`).
3. **Đối chiếu bản ghi**: 14/14 bảng khớp hoàn toàn — products 1000, suppliers 50, categories 30, warehouses 10, users 6, inventory 3000, stock_documents 600, stock_document_items 6000, stock_movements 8250, audit_logs 1178, auth_sessions 3, scanner_sessions 5, scan_events 200, idempotency_requests 0.
4. **Toàn vẹn file**: dump + checksum được `docker cp` về host `backups/postgres/`; `Get-FileHash` trên host trả cùng SHA-256 với trong container.

Trình tự đầy đủ nằm trong `scripts/staging_backup_evidence.sh` (chạy bên trong container). Giới hạn còn lại: đây là staging Docker Compose local, chưa phải PostgreSQL managed (Neon/Render); khi có staging URI managed cần lặp lại theo mục "Kiểm thử khôi phục (staging)".
