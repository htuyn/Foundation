#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the PostgreSQL connection URI}"
backup_dir="${BACKUP_DIR:-./backups/postgres}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_file="$backup_dir/warehouse-$timestamp.dump"

database_url="$DATABASE_URL"
case "$database_url" in
  postgresql+psycopg://*) database_url="postgresql://${database_url#postgresql+psycopg://}" ;;
esac

command -v pg_dump >/dev/null 2>&1 || { echo "pg_dump is required" >&2; exit 127; }
mkdir -p "$backup_dir"
umask 077
temporary_file="$dump_file.tmp"
trap 'rm -f "$temporary_file"' EXIT

pg_dump --dbname="$database_url" --format=custom --no-owner --no-privileges --file="$temporary_file"
mv "$temporary_file" "$dump_file"
(
  cd "$backup_dir"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$(basename "$dump_file")" > "$(basename "$dump_file").sha256"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$(basename "$dump_file")" > "$(basename "$dump_file").sha256"
  else
    echo "sha256sum or shasum is required" >&2
    exit 127
  fi
)

echo "Backup created: $dump_file"
echo "SHA-256: $dump_file.sha256"
