#Requires -Version 5.1
# run_full_test.ps1 - Full test flow: staging -> seed -> login -> k6
# Run from project root: .\scripts\run_full_test.ps1
Set-StrictMode -Version Latest
# NOTE: ErrorActionPreference = Continue cho phép Docker và external tools
# ghi stderr (progress/info) mà không bị PowerShell ngắt nhầm là lỗi.
# Mỗi bước dùng $LASTEXITCODE để kiểm tra lỗi thực sự.
$ErrorActionPreference = "Continue"

# Force UTF-8 console output / HTTP body encoding
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding            = [System.Text.Encoding]::UTF8

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

function Write-Step { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "    OK: $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "    WARN: $m" -ForegroundColor Yellow }
function Fail       { param($m) Write-Host "    FAIL: $m" -ForegroundColor Red; exit 1 }

# ── Hàm tiện ích: gửi HTTP POST với body UTF-8, trả về hashtable { StatusCode, Body, Error } ──
# Dùng Invoke-WebRequest với body là byte[] UTF-8 để tránh PowerShell 5.1
# tự re-encode ký tự Unicode (tiếng Việt) sang default charset.
# Authorization header được đưa vào -Headers hashtable bình thường (không bị .NET chặn).
# Mọi HTTP status (kể cả 4xx/5xx) đều được return dưới dạng { StatusCode, Body, Error }
# chứ không ném exception, để caller tự so sánh code.
function Invoke-Utf8Post {
    param(
        [string]$Uri,
        [hashtable]$Headers,
        [string]$JsonBody
    )
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($JsonBody)
    # Dùng Invoke-WebRequest (cmdlet) thay vì HttpWebRequest trực tiếp.
    # Cmdlet xử lý Authorization header đúng cách qua -Headers parameter,
    # và -Body nhận byte[] nên không bị re-encode ký tự Unicode.
    try {
        $resp = Invoke-WebRequest -Method Post -Uri $Uri `
            -Headers $Headers `
            -ContentType "application/json; charset=utf-8" `
            -Body $bytes `
            -UseBasicParsing `
            -ErrorAction Stop
        return @{ StatusCode = [int]$resp.StatusCode; Body = $resp.Content; Error = $null }
    } catch {
        $errResp = $_.Exception.Response
        if ($errResp) {
            $code = [int]$errResp.StatusCode
            try {
                $reader = [System.IO.StreamReader]::new($errResp.GetResponseStream())
                $body   = $reader.ReadToEnd()
                $reader.Close()
            } catch { $body = "" }
            return @{ StatusCode = $code; Body = $body; Error = $_ }
        }
        return @{ StatusCode = 0; Body = ""; Error = $_ }
    }
}

# Vietnamese string constants
# "Nhập kho": UTF-8 bytes 4E 68 E1 BA AD 70 20 6B 68 6F  (ậ = U+1EAD)
# "Xuất kho": UTF-8 bytes 58 75 E1 BA A5 74 20 6B 68 6F  (ấ = U+1EA5)
# Dùng [char] cast từ codepoint - an toàn với PowerShell 5.1+
$NhapKho = 'Nh' + [char]0x1EAD + 'p kho'   # Nhập kho
$XuatKho = 'Xu' + [char]0x1EA5 + 't kho'   # Xuất kho
$NccTest = 'NCC Test KT2'
$NccKhac = 'NCC KHAC'

# ===========================================================================
# STEP 0 - Check .env
# ===========================================================================
Write-Step "STEP 0 - Check .env"
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Warn ".env missing - copied from .env.example. Set POSTGRES_PASSWORD then re-run."
    exit 1
}
Write-Ok ".env exists"

# ===========================================================================
# STEP 1 - Start Docker Compose
# ===========================================================================
Write-Step "STEP 1 - docker compose up"
# 2>&1 gộp stderr vào stdout để PowerShell không ngắt nhầm Docker progress là lỗi
docker compose up -d --build 2>&1 | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { Fail "docker compose up failed" }
Write-Ok "Compose started, waiting for backend /health/ready ..."

$maxWait = 120
$elapsed = 0
Write-Host "    Polling" -NoNewline
do {
    Start-Sleep -Seconds 5
    $elapsed += 5
    Write-Host "." -NoNewline
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:8000/health/ready" `
                               -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($r.StatusCode -eq 200) { break }
    } catch {}
} while ($elapsed -lt $maxWait)
Write-Host ""
if ($elapsed -ge $maxWait) { Fail "Backend not ready after $maxWait s" }
Write-Ok "Backend healthy"

# ===========================================================================
# STEP 2 - Alembic migration
# ===========================================================================
Write-Step "STEP 2 - alembic upgrade head"
docker compose exec backend alembic upgrade head 2>&1 | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { Fail "alembic upgrade head failed" }
Write-Ok "Migration applied"

# ===========================================================================
# STEP 3 - Seed demo data
# ===========================================================================
Write-Step "STEP 3 - python -m app.seed_demo"
docker compose exec backend python -m app.seed_demo 2>&1 | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { Fail "seed_demo failed" }
Write-Ok "Seed complete"

# ===========================================================================
# STEP 4 - Login admin@anphat.com  (password set by seed_demo: Admin123!)
# ===========================================================================
Write-Step "STEP 4 - Login admin@anphat.com"
$loginUri  = "http://localhost:8000/api/v1/auth/login"
$adminJson = '{"email":"admin@anphat.com","password":"Admin123!"}'
try {
    $resp = Invoke-RestMethod -Method Post -Uri $loginUri `
                              -ContentType "application/json" -Body $adminJson
    $ADMIN_TOKEN = $resp.accessToken
    Write-Ok "admin@anphat.com logged in"
} catch {
    Fail "admin login failed: $_"
}

# ===========================================================================
# STEP 5 - Login viewer@anphat.com
# ===========================================================================
Write-Step "STEP 5 - Login viewer@anphat.com"
$viewerJson = '{"email":"viewer@anphat.com","password":"Viewer123!"}'
try {
    $resp2 = Invoke-RestMethod -Method Post -Uri $loginUri `
                               -ContentType "application/json" -Body $viewerJson
    $VIEWER_TOKEN = $resp2.accessToken
    Write-Ok "viewer@anphat.com logged in"
} catch {
    Fail "viewer login failed: $_"
}

# ===========================================================================
# STEP 6 - Fetch real UUIDs (product / warehouse / supplier)
# ===========================================================================
Write-Step "STEP 6 - Fetch staging UUIDs"
$authHdr = @{ "Authorization" = "Bearer $ADMIN_TOKEN" }

$PRODUCT_ID = (Invoke-RestMethod `
    -Uri "http://localhost:8000/api/v1/products?pageSize=1" `
    -Headers $authHdr)[0].id
Write-Ok "PRODUCT_ID   = $PRODUCT_ID"

$WAREHOUSE_ID = (Invoke-RestMethod `
    -Uri "http://localhost:8000/api/v1/warehouses?pageSize=1" `
    -Headers $authHdr)[0].id
Write-Ok "WAREHOUSE_ID = $WAREHOUSE_ID"

$SUPPLIER_ID = (Invoke-RestMethod `
    -Uri "http://localhost:8000/api/v1/suppliers?pageSize=1" `
    -Headers $authHdr)[0].id
Write-Ok "SUPPLIER_ID  = $SUPPLIER_ID"

# ===========================================================================
# STEP 7 - KT1: RBAC 403 (viewer cannot POST /documents)
# ===========================================================================
Write-Step "STEP 7 - KT1: RBAC 403"

$kt1Json = "{`"type`":`"$NhapKho`",`"partner`":`"Test KT1`",`"warehouseId`":`"$WAREHOUSE_ID`",`"supplierId`":`"$SUPPLIER_ID`",`"note`":`"KT1 RBAC test`",`"lines`":[{`"productId`":`"$PRODUCT_ID`",`"quantity`":1,`"unitCost`":10000}]}"
$kt1Result = Invoke-Utf8Post -Uri "http://localhost:8000/api/v1/documents" `
    -Headers @{ "Authorization" = "Bearer $VIEWER_TOKEN" } `
    -JsonBody $kt1Json

if ($kt1Result.StatusCode -eq 403) {
    Write-Ok "KT1 PASS - viewer got 403 Forbidden"
} elseif ($kt1Result.StatusCode -eq 0) {
    Fail "KT1 FAILED - no response (network error): $($kt1Result.Error)"
} else {
    Fail "KT1 FAILED - got HTTP $($kt1Result.StatusCode) instead of 403"
}

# ===========================================================================
# STEP 8 - KT2: Idempotency (201 -> 200 replay -> 409 conflict)
# ===========================================================================
Write-Step "STEP 8 - KT2: Idempotency"

$thuKhoJson = '{"email":"thukho@anphat.com","password":"Thukho123!"}'
$thuKhoResp = Invoke-RestMethod -Method Post -Uri $loginUri `
                                -ContentType "application/json" -Body $thuKhoJson
$THUKHO_TOKEN = $thuKhoResp.accessToken
if (-not $THUKHO_TOKEN) { Fail "thukho token is null/empty - check login response" }
Write-Ok "thukho@anphat.com logged in (token len=$($THUKHO_TOKEN.Length))"

$IDEM_KEY = "kt2-$(Get-Date -Format 'yyyyMMddHHmmss')"
$idemHdrDict = @{
    "Authorization"   = "Bearer $THUKHO_TOKEN"
    "Idempotency-Key" = $IDEM_KEY
}
Write-Host "    [DEBUG] Authorization header = 'Bearer $($THUKHO_TOKEN.Substring(0, [Math]::Min(20,$THUKHO_TOKEN.Length)))...'" -ForegroundColor DarkGray

# Body gốc (round 1 & 2 dùng cùng body này)
$idemBodyJson = "{`"type`":`"$NhapKho`",`"partner`":`"$NccTest`",`"warehouseId`":`"$WAREHOUSE_ID`",`"supplierId`":`"$SUPPLIER_ID`",`"note`":`"KT2 idempotency lan 1`",`"lines`":[{`"productId`":`"$PRODUCT_ID`",`"quantity`":10,`"unitCost`":50000}]}"

# Round 1 -> 201
$r1 = Invoke-Utf8Post -Uri "http://localhost:8000/api/v1/documents" `
    -Headers $idemHdrDict -JsonBody $idemBodyJson
if ($r1.StatusCode -eq 201) { Write-Ok "KT2 round 1 -> 201 Created" }
else { Fail "KT2 round 1 FAILED - got HTTP $($r1.StatusCode) (expected 201). Body: $($r1.Body)" }

# Round 2 (same key, same body) -> 200 replay
$r2 = Invoke-Utf8Post -Uri "http://localhost:8000/api/v1/documents" `
    -Headers $idemHdrDict -JsonBody $idemBodyJson
if ($r2.StatusCode -eq 200) { Write-Ok "KT2 round 2 -> 200 replay" }
else { Fail "KT2 round 2 FAILED - got HTTP $($r2.StatusCode) (expected 200). Body: $($r2.Body)" }

# Round 3 (same key, different body) -> 409 Conflict
$idemBodyDiffJson = "{`"type`":`"$NhapKho`",`"partner`":`"$NccKhac`",`"warehouseId`":`"$WAREHOUSE_ID`",`"supplierId`":`"$SUPPLIER_ID`",`"note`":`"KT2 payload khac`",`"lines`":[{`"productId`":`"$PRODUCT_ID`",`"quantity`":99,`"unitCost`":1}]}"
$r3 = Invoke-Utf8Post -Uri "http://localhost:8000/api/v1/documents" `
    -Headers $idemHdrDict -JsonBody $idemBodyDiffJson
if ($r3.StatusCode -eq 409) { Write-Ok "KT2 round 3 -> 409 Conflict" }
else { Fail "KT2 round 3 FAILED - got HTTP $($r3.StatusCode) instead of 409. Error: $($r3.Error)" }

# ===========================================================================
# STEP 9 - KT3: Audit log has rejected entries
# ===========================================================================
Write-Step "STEP 9 - KT3: Audit log"
$auditResp = Invoke-RestMethod `
    -Uri "http://localhost:8000/api/v1/audit-logs?pageSize=50" `
    -Headers $authHdr
$rejectedCount = @($auditResp | Where-Object { $_.PSObject.Properties['outcome'] -and $_.outcome -eq "rejected" }).Count
if ($rejectedCount -gt 0) {
    Write-Ok "KT3 PASS - $rejectedCount rejected audit log entries found"
} else {
    Write-Warn "KT3 - No rejected audit logs found; check audit middleware config"
}

# ===========================================================================
# STEP 10 - k6 load test (2 VU, 60s)
# ===========================================================================
Write-Step "STEP 10 - k6 load test (2 VU, 60s)"
if (Get-Command k6 -ErrorAction SilentlyContinue) {
    k6 run `
        --vus 2 --duration 60s `
        -e "PRODUCT_ID=$PRODUCT_ID" `
        -e "WAREHOUSE_ID=$WAREHOUSE_ID" `
        -e "SUPPLIER_ID=$SUPPLIER_ID" `
        -e "AUTH_TOKEN=$THUKHO_TOKEN" `
        -e "BASE_URL=http://localhost:8000" `
        scripts/k6_load_test.js 2>&1 | ForEach-Object { Write-Host $_ }
    Write-Ok "k6 2-VU done"
} else {
    Write-Warn "k6 chưa được cài trên host. Thử chạy k6 thông qua Docker container (grafana/k6)..."
    $dockerRunSuccess = $false
    try {
        docker run --rm -v "${ProjectRoot}/scripts:/scripts" `
            --add-host=host.docker.internal:host-gateway `
            grafana/k6 run `
            --vus 2 --duration 60s `
            -e "PRODUCT_ID=$PRODUCT_ID" `
            -e "WAREHOUSE_ID=$WAREHOUSE_ID" `
            -e "SUPPLIER_ID=$SUPPLIER_ID" `
            -e "AUTH_TOKEN=$THUKHO_TOKEN" `
            -e "BASE_URL=http://host.docker.internal:8000" `
            /scripts/k6_load_test.js
        if ($LASTEXITCODE -eq 0) {
            $dockerRunSuccess = $true
            Write-Ok "k6 2-VU hoàn tất qua Docker container!"
        }
    } catch {}

    if (-not $dockerRunSuccess) {
        Write-Warn "Chưa thể chạy k6. Vui lòng cài đặt k6 theo một trong các cách sau:"
        Write-Host "    PowerShell (Admin) : .\scripts\install_k6.ps1" -ForegroundColor Yellow
        Write-Host "    Winget             : winget install k6 --source winget" -ForegroundColor Yellow
        Write-Host "    Ubuntu/Bash        : bash scripts/install_k6.sh" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "    Sau khi cài, bạn có thể chạy k6 độc lập bằng lệnh:" -ForegroundColor Yellow
        Write-Host ("    k6 run --vus 2 --duration 60s " +
                    "-e PRODUCT_ID=$PRODUCT_ID " +
                    "-e WAREHOUSE_ID=$WAREHOUSE_ID " +
                    "-e SUPPLIER_ID=$SUPPLIER_ID " +
                    "-e AUTH_TOKEN=$THUKHO_TOKEN " +
                    "-e BASE_URL=http://localhost:8000 " +
                    "scripts/k6_load_test.js") -ForegroundColor Yellow
    }
}

# ===========================================================================
# SUMMARY
# ===========================================================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  All steps done!" -ForegroundColor Green
Write-Host "  Admin token for manual use:" -ForegroundColor Cyan
Write-Host "  `$TOKEN = `"$ADMIN_TOKEN`"" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
