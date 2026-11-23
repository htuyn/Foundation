# =====================================================
# run_kt_all.ps1 - Chạy KT1, KT2, KT3 và lưu evidence
# Tác giả : SV4 – Nguyễn Nhật Long
# Dự án   : Smart Warehouse – Nhóm 4 thành viên
#
# Cách dùng (chạy trong terminal thông thường, KHÔNG sandbox):
#   cd "C:\Users\long\OneDrive\Desktop\CNNT\Foundation"
#   .\scripts\run_kt_all.ps1
# =====================================================

$ErrorActionPreference = "Continue"

# Fix UTF-8 cho terminal và file output
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONUTF8        = "1"
$env:PYTHONIOENCODING  = "utf-8"

$outDir = "tests\kt_results"
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir | Out-Null
}

Write-Host "=================================================="
Write-Host " Smart Warehouse – SV4 | Bộ kiểm thử KT1-KT3"
Write-Host " Thời gian bắt đầu: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "=================================================="

# --------------------------------------------------
# KT1 – Tạo phiếu nhập kho hợp lệ
# --------------------------------------------------
Write-Host ""
Write-Host ">>> [KT1] Tạo phiếu nhập kho hợp lệ..."
python -X utf8 scripts\kt1_create_document.py *>&1 | Tee-Object -FilePath "$outDir\KT1_evidence.txt" -Encoding utf8
Write-Host "    Đã lưu: $outDir\KT1_evidence.txt"

# --------------------------------------------------
# KT2 – Gửi trùng Idempotency-Key
# --------------------------------------------------
Write-Host ""
Write-Host ">>> [KT2] Kiểm thử chống ghi trùng (Idempotency)..."
python -X utf8 scripts\kt2_duplicate_key.py *>&1 | Tee-Object -FilePath "$outDir\KT2_evidence.txt" -Encoding utf8
Write-Host "    Đã lưu: $outDir\KT2_evidence.txt"

# --------------------------------------------------
# KT3 – Phân quyền RBAC (Chỉ xem → 403)
# --------------------------------------------------
Write-Host ""
Write-Host ">>> [KT3] Kiểm thử phân quyền RBAC..."
python -X utf8 scripts\kt3_rbac_403.py *>&1 | Tee-Object -FilePath "$outDir\KT3_evidence.txt" -Encoding utf8
Write-Host "    Đã lưu: $outDir\KT3_evidence.txt"

# --------------------------------------------------
# Tổng kết
# --------------------------------------------------
Write-Host ""
Write-Host "=================================================="
Write-Host " Hoàn thành! Kết quả evidence:"
Get-ChildItem $outDir -File | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
Write-Host "=================================================="
Write-Host " Thời gian kết thúc: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "=================================================="
