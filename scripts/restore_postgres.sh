#!/usr/bin/env bash
set -Eeuo pipefail

clean_restore=false
if [[ ${1:-} == "--clean" ]]; then
  clean_restore=true
  shift
fi
if [[ $# -ne 1 ]]; then
  echo "Usage: DATABASE_URL=postgresql://... $0 [--clean] path/to/backup.dump" >&2
  exit 2
fi
: "${DATABASE_URL:?Set DATABASE_URL to the PostgreSQL restore target URI}"
if [[ "$clean_restore" == true && "${RESTORE_ALLOW_CLEAN:-}" != "YES" ]]; then
  echo "Refusing to drop restored objects without RESTORE_ALLOW_CLEAN=YES" >&2
  exit 2
fi

dump_file="$1"
[[ -f "$dump_file" ]] || { echo "Backup file not found: $dump_file" >&2; exit 2; }
checksum_file="$dump_file.sha256"
[[ -f "$checksum_file" ]] || { echo "SHA-256 file not found: $checksum_file" >&2; exit 2; }
command -v pg_restore >/dev/null 2>&1 || { echo "pg_restore is required" >&2; exit 127; }

database_url="$DATABASE_URL"
case "$database_url" in
  postgresql+psycopg://*) database_url="postgresql://${database_url#postgresql+psycopg://}" ;;
esac

dump_dir="$(cd "$(dirname "$dump_file")" && pwd)"
dump_name="$(basename "$dump_file")"
checksum_name="$(basename "$checksum_file")"
(
  cd "$dump_dir"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$checksum_name"
  elif command -v shasum >/dev/null 2>&1; then
    expected="$(awk 'NR == 1 { print $1 }' "$checksum_name")"
    actual="$(shasum -a 256 "$dump_name" | awk '{ print $1 }')"
    [[ "$expected" == "$actual" ]] || { echo "SHA-256 verification failed" >&2; exit 1; }
    echo "$dump_name: OK"
  else
    echo "sha256sum or shasum is required" >&2
    exit 127
  fi
)

if [[ "$clean_restore" == true ]]; then
  echo "Restoring and replacing objects contained in the dump at the DATABASE_URL target."
  pg_restore --dbname="$database_url" --clean --if-exists --single-transaction --exit-on-error --no-owner --no-privileges "$dump_file"
else
  echo "Restoring into the database selected by DATABASE_URL. Use an empty staging database/schema."
  pg_restore --dbname="$database_url" --single-transaction --exit-on-error --no-owner --no-privileges "$dump_file"
fi
echo "Restore completed: $dump_file"
