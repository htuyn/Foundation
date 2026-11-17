#!/usr/bin/env bash
# =============================================================================
# staging_backup_evidence.sh – Chạy backup + restore minh chứng SV3-CV03
# Chạy BÊN TRONG container postgres (docker cp vào /tmp rồi exec).
# Không in connection string/mật khẩu ra log.
# =============================================================================
set -Eeuo pipefail

echo "── Bước 1: Backup staging bằng backup_postgres.sh ──"
mkdir -p /tmp/backups
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}" \
  BACKUP_DIR=/tmp/backups bash /tmp/backup_postgres.sh

LATEST_DUMP="$(ls -t /tmp/backups/warehouse-*.dump | head -n 1)"
echo "Dump mới nhất: ${LATEST_DUMP}"
sha256sum "${LATEST_DUMP}" "${LATEST_DUMP}.sha256" 2>/dev/null || true
cat "${LATEST_DUMP}.sha256"

echo "── Bước 2: Tạo database validation cô lập ──"
VALID_DB="warehouse_restore_validation_$(date -u +%Y%m%d_%H%M%S)"
psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -c "CREATE DATABASE ${VALID_DB};"
echo "Validation DB: ${VALID_DB}"

echo "── Bước 3: Restore bằng restore_postgres.sh (verify SHA-256 trước) ──"
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${VALID_DB}" \
  bash /tmp/restore_postgres.sh "${LATEST_DUMP}"

echo "── Bước 4: Đối chiếu số bản ghi gốc vs restore ──"
TABLES="products suppliers categories warehouses users inventory stock_documents stock_document_items stock_movements audit_logs auth_sessions scanner_sessions scan_events idempotency_requests"
for t in ${TABLES}; do
  ORIG="$(psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Atc "SELECT count(*) FROM ${t};")" || ORIG="ERR"
  REST="$(psql -U "${POSTGRES_USER}" -d "${VALID_DB}" -Atc "SELECT count(*) FROM ${t};")" || REST="ERR"
  if [[ "${ORIG}" == "${REST}" ]]; then
    MATCH="OK"
  else
    MATCH="MISMATCH"
  fi
  printf '%-24s orig=%-8s restored=%-8s %s\n' "${t}" "${ORIG}" "${REST}" "${MATCH}"
done

echo "── Bước 5: Đối chiếu SHA-256 dump file ──"
( cd /tmp/backups && sha256sum -c "$(basename "${LATEST_DUMP}").sha256" )

echo "=== HOÀN TẤT: ${VALID_DB} ==="
