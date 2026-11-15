#Requires -Version 5.1
# Script kiểm tra nhanh: Authorization header có được gửi đúng không?
# Chạy trong PowerShell local: .\scripts\test_auth_header.ps1
# Yêu cầu: staging đang chạy (docker compose up đã thực hiện)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$BASE = "http://localhost:8000"

Write-Host "`n==> TEST 1: Login admin" -ForegroundColor Cyan
$loginResp = Invoke-RestMethod -Method Post -Uri "$BASE/api/v1/auth/login" `
    -ContentType "application/json" -Body '{"email":"admin@anphat.com","password":"Admin123!"}'
$TOKEN = $loginResp.accessToken
Write-Host "    Token: $($TOKEN.Substring(0,20))..." -ForegroundColor Green

Write-Host "`n==> TEST 2: Dùng indexer Headers['Authorization']" -ForegroundColor Cyan
$req = [System.Net.HttpWebRequest]::Create("$BASE/api/v1/bootstrap")
$req.Method = "GET"
$req.Headers["Authorization"] = "Bearer $TOKEN"
try {
    $resp = $req.GetResponse()
    Write-Host "    GET /bootstrap -> $([int]$resp.StatusCode) OK - Authorization indexer WORKS" -ForegroundColor Green
    $resp.Close()
} catch [System.Net.WebException] {
    $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    Write-Host "    GET /bootstrap -> $code FAIL" -ForegroundColor Red
}

Write-Host "`n==> TEST 3: Login thukho" -ForegroundColor Cyan
$r2 = Invoke-RestMethod -Method Post -Uri "$BASE/api/v1/auth/login" `
    -ContentType "application/json" -Body '{"email":"thukho@anphat.com","password":"Thukho123!"}'
$THUKHO_TOKEN = $r2.accessToken
Write-Host "    thukho token: $($THUKHO_TOKEN.Substring(0,20))..." -ForegroundColor Green

Write-Host "`n==> TEST 4: POST /documents voi thukho token (indexer)" -ForegroundColor Cyan

# Lấy UUID thực từ staging
$authHdr = @{ Authorization = "Bearer $TOKEN" }
$prod = (Invoke-RestMethod -Uri "$BASE/api/v1/products?pageSize=1" -Headers $authHdr)[0]
$wh   = (Invoke-RestMethod -Uri "$BASE/api/v1/warehouses?pageSize=1" -Headers $authHdr)[0]
$sup  = (Invoke-RestMethod -Uri "$BASE/api/v1/suppliers?pageSize=1" -Headers $authHdr)[0]

$NhapKho = 'Nh' + [char]0x1EAD + 'p kho'
$body = "{`"type`":`"$NhapKho`",`"partner`":`"Test`",`"warehouseId`":`"$($wh.id)`",`"supplierId`":`"$($sup.id)`",`"note`":`"test auth header`",`"lines`":[{`"productId`":`"$($prod.id)`",`"quantity`":1,`"unitCost`":1000}]}"
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)

$req2 = [System.Net.HttpWebRequest]::Create("$BASE/api/v1/documents")
$req2.Method = "POST"
$req2.ContentType = "application/json; charset=utf-8"
$req2.ContentLength = $bytes.Length
$req2.Headers["Authorization"] = "Bearer $THUKHO_TOKEN"
$req2.Headers["Idempotency-Key"] = "test-auth-$(Get-Date -Format 'yyyyMMddHHmmss')"

$stream = $req2.GetRequestStream()
$stream.Write($bytes, 0, $bytes.Length)
$stream.Close()

try {
    $resp2 = $req2.GetResponse()
    Write-Host "    POST /documents -> $([int]$resp2.StatusCode) - Authorization qua indexer WORKS!" -ForegroundColor Green
    $resp2.Close()
} catch [System.Net.WebException] {
    $errResp = $_.Exception.Response
    $code2 = if ($errResp) { [int]$errResp.StatusCode } else { 0 }
    if ($code2 -eq 201 -or $code2 -eq 200) {
        Write-Host "    POST /documents -> $code2 OK" -ForegroundColor Green
    } else {
        try {
            $reader = [System.IO.StreamReader]::new($errResp.GetResponseStream())
            $errBody = $reader.ReadToEnd()
            $reader.Close()
        } catch { $errBody = "" }
        Write-Host "    POST /documents -> $code2 FAIL: $errBody" -ForegroundColor Red
    }
}

Write-Host "`n==> Xong. Nếu TEST 4 trả 201 thi fix đã work, chạy run_full_test.ps1" -ForegroundColor Cyan
