# =====================================================
# run_kt_all.ps1 - Chay KT1, KT2, KT3 va luu evidence
# Tac gia : SV4 - Nguyen Nhat Long
# Du an   : Smart Warehouse - Nhom 4 thanh vien
#
# Cach dung:
#   cd "C:\Users\long\OneDrive\Desktop\CNNT\Foundation"
#   .\scripts\run_kt_all.ps1
# =====================================================

$ErrorActionPreference = "Continue"

# Fix UTF-8 cho terminal va file output
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONUTF8        = "1"
$env:PYTHONIOENCODING  = "utf-8"

$outDir = "tests\kt_results"
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir | Out-Null
}

$startTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Write-Host "=================================================="
Write-Host " Smart Warehouse - SV4 | Bo kiem thu KT1-KT3"
Write-Host " Thoi gian bat dau: $startTime"
Write-Host "=================================================="

# --------------------------------------------------
# KT1 - Tao phieu nhap kho hop le
# --------------------------------------------------
Write-Host ""
Write-Host ">>> [KT1] Tao phieu nhap kho hop le..."
python -X utf8 scripts\kt1_create_document.py *>&1 | Out-String | Set-Content -Path "$outDir\KT1_evidence.txt" -Encoding UTF8
Get-Content "$outDir\KT1_evidence.txt" | Write-Host
Write-Host "    Da luu: $outDir\KT1_evidence.txt"

# --------------------------------------------------
# KT2 - Gui trung Idempotency-Key
# --------------------------------------------------
Write-Host ""
Write-Host ">>> [KT2] Kiem thu chong ghi trung (Idempotency)..."
python -X utf8 scripts\kt2_duplicate_key.py *>&1 | Out-String | Set-Content -Path "$outDir\KT2_evidence.txt" -Encoding UTF8
Get-Content "$outDir\KT2_evidence.txt" | Write-Host
Write-Host "    Da luu: $outDir\KT2_evidence.txt"

# --------------------------------------------------
# KT3 - Phan quyen RBAC (Chi xem -> 403)
# --------------------------------------------------
Write-Host ""
Write-Host ">>> [KT3] Kiem thu phan quyen RBAC..."
python -X utf8 scripts\kt3_rbac_403.py *>&1 | Out-String | Set-Content -Path "$outDir\KT3_evidence.txt" -Encoding UTF8
Get-Content "$outDir\KT3_evidence.txt" | Write-Host
Write-Host "    Da luu: $outDir\KT3_evidence.txt"

# --------------------------------------------------
# Tong ket
# --------------------------------------------------
$endTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Write-Host ""
Write-Host "=================================================="
Write-Host " Hoan thanh! Ket qua evidence:"
Get-ChildItem $outDir -File | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
Write-Host "=================================================="
Write-Host " Thoi gian ket thuc: $endTime"
Write-Host "=================================================="
