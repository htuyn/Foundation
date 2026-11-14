#Requires -Version 5.1
# run_full_test.ps1 - Full test flow: staging -> seed -> login -> k6
# Run from project root: .\scripts\run_full_test.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

function Write-Step { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "    OK: $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "    WARN: $m" -ForegroundColor Yellow }
function Fail       { param($m) Write-Host "    FAIL: $m" -ForegroundColor Red; exit 1 }

# Vietnamese strings built with [char] codes to avoid encoding issues
$NhapKho  = 'Nh' + [char]0x1EAD + 'p kho'    # "Nhap kho"  = Nhap kho
$NccTest  = 'NCC Test KT2'
$NccKhac  = 'NCC KHAC'

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
docker compose up -d --build
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
docker compose exec backend alembic upgrade head
if ($LASTEXITCODE -ne 0) { Fail "alembic upgrade head failed" }
Write-Ok "Migration applied"

# ===========================================================================
# STEP 3 - Seed demo data
# ===========================================================================
Write-Step "STEP 3 - python -m app.seed_demo"
docker compose exec backend python -m app.seed_demo
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
$kt1Body = (@{
    type        = $NhapKho
    partner     = "Test KT1"
    warehouseId = $WAREHOUSE_ID
    supplierId  = $SUPPLIER_ID
    note        = "KT1 RBAC test"
    lines       = @(@{ productId = $PRODUCT_ID; quantity = 1; unitCost = 10000 })
} | ConvertTo-Json -Depth 3)

$viewerHdr = @{
    "Authorization" = "Bearer $VIEWER_TOKEN"
    "Content-Type"  = "application/json"
}
try {
    Invoke-RestMethod -Method Post `
        -Uri "http://localhost:8000/api/v1/documents" `
        -Headers $viewerHdr -Body $kt1Body | Out-Null
    Fail "KT1 FAILED - viewer should have received 403"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 403) {
        Write-Ok "KT1 PASS - viewer got 403 Forbidden"
    } else {
        Fail "KT1 FAILED - got HTTP $code instead of 403"
    }
}

# ===========================================================================
# STEP 8 - KT2: Idempotency (201 -> 200 replay -> 409 conflict)
# ===========================================================================
Write-Step "STEP 8 - KT2: Idempotency"

$thuKhoJson = '{"email":"thukho@anphat.com","password":"Thukho123!"}'
$thuKhoResp = Invoke-RestMethod -Method Post -Uri $loginUri `
                                -ContentType "application/json" -Body $thuKhoJson
$THUKHO_TOKEN = $thuKhoResp.accessToken
Write-Ok "thukho@anphat.com logged in"

$IDEM_KEY = "kt2-$(Get-Date -Format 'yyyyMMddHHmmss')"
$idemHdr  = @{
    "Authorization"   = "Bearer $THUKHO_TOKEN"
    "Content-Type"    = "application/json"
    "Idempotency-Key" = $IDEM_KEY
}
$idemBody = (@{
    type        = $NhapKho
    partner     = $NccTest
    warehouseId = $WAREHOUSE_ID
    supplierId  = $SUPPLIER_ID
    note        = "KT2 idempotency lan 1"
    lines       = @(@{ productId = $PRODUCT_ID; quantity = 10; unitCost = 50000 })
} | ConvertTo-Json -Depth 3)

# Round 1 -> 201
try {
    $r1 = Invoke-WebRequest -Method Post `
        -Uri "http://localhost:8000/api/v1/documents" `
        -Headers $idemHdr -Body $idemBody -UseBasicParsing
    if ($r1.StatusCode -eq 201) { Write-Ok "KT2 round 1 -> 201 Created" }
    else { Write-Warn "KT2 round 1 -> $($r1.StatusCode) (expected 201)" }
} catch { Fail "KT2 round 1 error: $_" }

# Round 2 (same key, same body) -> 200 replay
try {
    $r2 = Invoke-WebRequest -Method Post `
        -Uri "http://localhost:8000/api/v1/documents" `
        -Headers $idemHdr -Body $idemBody -UseBasicParsing
    if ($r2.StatusCode -eq 200) { Write-Ok "KT2 round 2 -> 200 replay" }
    else { Write-Warn "KT2 round 2 -> $($r2.StatusCode) (expected 200)" }
} catch { Fail "KT2 round 2 error: $_" }

# Round 3 (same key, different body) -> 409
$idemBodyDiff = (@{
    type        = $NhapKho
    partner     = $NccKhac
    warehouseId = $WAREHOUSE_ID
    supplierId  = $SUPPLIER_ID
    note        = "KT2 payload khac"
    lines       = @(@{ productId = $PRODUCT_ID; quantity = 99; unitCost = 1 })
} | ConvertTo-Json -Depth 3)

try {
    Invoke-RestMethod -Method Post `
        -Uri "http://localhost:8000/api/v1/documents" `
        -Headers $idemHdr -Body $idemBodyDiff | Out-Null
    Fail "KT2 round 3 FAILED - should have received 409"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 409) { Write-Ok "KT2 round 3 -> 409 Conflict" }
    else { Fail "KT2 round 3 FAILED - got HTTP $code instead of 409" }
}

# ===========================================================================
# STEP 9 - KT3: Audit log has rejected entries
# ===========================================================================
Write-Step "STEP 9 - KT3: Audit log"
$auditResp = Invoke-RestMethod `
    -Uri "http://localhost:8000/api/v1/audit-logs?pageSize=50" `
    -Headers $authHdr
$rejectedCount = ($auditResp | Where-Object { $_.outcome -eq "rejected" }).Count
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
        scripts/k6_load_test.js
    Write-Ok "k6 2-VU done"
} else {
    Write-Warn "k6 not installed. Run one of these first:"
    Write-Host "    Windows : winget install k6 --source winget" -ForegroundColor Yellow
    Write-Host "    Ubuntu  : sudo snap install k6" -ForegroundColor Yellow
    Write-Host "    Script  : bash scripts/install_k6.sh" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    Then run k6 manually:" -ForegroundColor Yellow
    Write-Host ("    k6 run --vus 2 --duration 60s " +
                "-e PRODUCT_ID=$PRODUCT_ID " +
                "-e WAREHOUSE_ID=$WAREHOUSE_ID " +
                "-e SUPPLIER_ID=$SUPPLIER_ID " +
                "-e AUTH_TOKEN=$THUKHO_TOKEN " +
                "-e BASE_URL=http://localhost:8000 " +
                "scripts/k6_load_test.js") -ForegroundColor Yellow
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
