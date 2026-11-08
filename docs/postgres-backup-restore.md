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

Ví dụ cron chạy 02:00 UTC mỗi ngày (đặt biến môi trường an toàn qua secret manager hoặc file chỉ chủ sở hữu đọc được):

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
