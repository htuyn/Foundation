# install_k6.ps1 - Cài đặt k6 trên Windows bằng winget hoặc Chocolatey
$ErrorActionPreference = "Continue"

Write-Host "==> Đang kiểm tra công cụ cài đặt gói trên Windows..." -ForegroundColor Cyan

if (Get-Command k6 -ErrorAction SilentlyContinue) {
    Write-Host "✓ k6 đã được cài đặt: $(k6 version)" -ForegroundColor Green
    exit 0
}

if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "==> Cài đặt k6 qua winget..." -ForegroundColor Cyan
    winget install k6 --source winget --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ k6 cài đặt thành công! Khởi động lại terminal để nhận lệnh 'k6'." -ForegroundColor Green
        exit 0
    }
}

if (Get-Command choco -ErrorAction SilentlyContinue) {
    Write-Host "==> Cài đặt k6 qua Chocolatey..." -ForegroundColor Cyan
    choco install k6 -y
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ k6 cài đặt thành công qua Chocolatey!" -ForegroundColor Green
        exit 0
    }
}

Write-Host "WARN: Không tìm thấy winget hoặc choco. Bạn có thể:" -ForegroundColor Yellow
Write-Host "  1. Tải file zip/msi k6 trực tiếp từ: https://github.com/grafana/k6/releases" -ForegroundColor White
Write-Host "  2. Hoặc chạy k6 qua Docker mà không cần cài:" -ForegroundColor White
Write-Host "     docker run --rm -i --network=host grafana/k6 run - < scripts/k6_load_test.js" -ForegroundColor White
