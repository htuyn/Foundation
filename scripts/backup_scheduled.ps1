# =============================================================================
# backup_scheduled.ps1 – Wrapper cho Windows Task Scheduler (SV3-CV03)
# =============================================================================
# Chạy định kỳ hằng ngày qua Task Scheduler; thực hiện:
#   1. Copy backup_postgres.sh vào container postgres (strip CRLF -> LF)
#   2. Chạy pg_dump custom + sinh SHA-256 (DATABASE_URL build trong container,
#      mật khẩu KHÔNG xuất hiện trên dòng lệnh host hay trong log)
#   3. docker cp dump + .sha256 về host backups/postgres/
#   4. Dọn backup cũ hơn RETENTION_DAYS ngày
#   5. Ghi log có timestamp vào backups/postgres/backup.log
# =============================================================================
# Yêu cầu: Docker Desktop đang chạy, container postgres của stack đang Up.
# Đăng ký lịch: xem hướng dẫn trong docs/postgres-backup-restore.md
# =============================================================================
# Lưu ý PowerShell 5.1: không dùng $ErrorActionPreference='Stop' với native
# command vì stderr (vd. "Successfully copied...") bị coi là lỗi kết thúc
# tiến trình; mọi lệnh native được kiểm tra bằng $LASTEXITCODE thay thế.
# =============================================================================

$ErrorActionPreference = 'Continue'
$ProjectDir = Split-Path -Parent $PSScriptRoot
$BackupDir = Join-Path $ProjectDir 'backups\postgres'
$RetentionDays = 30
$LogPath = Join-Path $BackupDir 'backup.log'

function Write-Log {
    param([string]$Message)
    if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null }
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    # .NET UTF8 (không BOM) tránh lỗi encoding tiếng Việt của Add-Content trong PS 5.1
    [System.IO.File]::AppendAllText($LogPath, "[$stamp] $Message`r`n", [System.Text.UTF8Encoding]::new($false))
}

function Invoke-Step {
    param([string]$Name, [scriptblock]$Block)
    & $Block | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "$Name thất bại (exit code $LASTEXITCODE)."
    }
}

try {
    # 0. Kiểm tra container postgres đang chạy
    $running = docker inspect -f '{{.State.Running}}' foundation-postgres-1 2>&1
    if ($LASTEXITCODE -ne 0 -or "$running".Trim() -ne 'true') {
        throw "Container postgres không chạy (inspect: $running)."
    }

    # 1. Copy script backup vào container, strip CRLF
    Invoke-Step 'docker cp backup_postgres.sh' { docker cp (Join-Path $PSScriptRoot 'backup_postgres.sh') foundation-postgres-1:/tmp/backup_postgres.sh }
    Invoke-Step 'strip CRLF' { docker exec foundation-postgres-1 bash -c "sed -i 's/\r//' /tmp/backup_postgres.sh" }

    # 2. Chạy backup trong container (env POSTGRES_* có sẵn trong container)
    $execOut = docker exec foundation-postgres-1 bash -c 'mkdir -p /tmp/backups && DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}" BACKUP_DIR=/tmp/backups bash /tmp/backup_postgres.sh' 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Backup trong container thất bại: $($execOut -join ' | ')" }
    Write-Log (($execOut | Where-Object { $_ -is [string] }) -join ' | ').Trim()

    # 3. Tìm dump mới nhất và copy về host
    $dumpName = (docker exec foundation-postgres-1 bash -c 'ls -t /tmp/backups/warehouse-*.dump 2>/dev/null | head -n 1') -join ''
    $dumpName = "$dumpName".Trim()
    if (-not $dumpName) { throw 'Không tìm thấy dump file sau backup.' }
    $base = Split-Path -Leaf $dumpName
    Invoke-Step "docker cp dump ($base)" { docker cp "foundation-postgres-1:$dumpName" (Join-Path $BackupDir $base) }
    Invoke-Step 'docker cp sha256' { docker cp "foundation-postgres-1:${dumpName}.sha256" (Join-Path $BackupDir "$base.sha256") }

    # Xác minh SHA-256 trên host khớp file .sha256
    $expected = (Get-Content (Join-Path $BackupDir "$base.sha256") | Select-Object -First 1).Split(' ')[0]
    $actual = (Get-FileHash (Join-Path $BackupDir $base) -Algorithm SHA256).Hash.ToLower()
    if ($expected -ne $actual) { throw "SHA-256 không khớp trên host (expected=$expected actual=$actual)." }
    Write-Log "OK: $base (SHA-256 khớp)"

    # 4. Dọn backup cũ hơn $RetentionDays
    $cutoff = (Get-Date).AddDays(-$RetentionDays)
    Get-ChildItem -Path $BackupDir -Include *.dump, *.sha256 -File -Recurse |
        Where-Object { $_.LastWriteTime -lt $cutoff } |
        ForEach-Object { Remove-Item $_.FullName -Force; Write-Log "Đã xóa backup cũ: $($_.Name)" }

    exit 0
}
catch {
    Write-Log "LOI: $($_.Exception.Message)"
    exit 1
}
