$ErrorActionPreference = 'Stop'

$route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' |
  Sort-Object RouteMetric, InterfaceMetric |
  Select-Object -First 1

if (-not $route) {
  throw 'No default IPv4 route. Connect this PC to Wi-Fi/LAN and retry.'
}

$lanAddress = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -AddressState Preferred |
  Where-Object {
    $octets = $_.IPAddress.Split('.')
    $private10 = $octets[0] -eq '10'
    $private172 = $octets[0] -eq '172' -and [int]$octets[1] -ge 16 -and [int]$octets[1] -le 31
    $private192 = $octets[0] -eq '192' -and $octets[1] -eq '168'
    $private10 -or $private172 -or $private192
  } |
  Select-Object -First 1

if (-not $lanAddress) {
  throw 'No private IPv4 address on the default network adapter. Check the Wi-Fi/LAN connection and retry.'
}

if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
  throw 'mkcert is required. Install it from a trusted package manager, then rerun this script.'
}

$certificateDirectory = Join-Path $PSScriptRoot '..\certs'
New-Item -ItemType Directory -Force -Path $certificateDirectory | Out-Null
$certificateDirectory = (Resolve-Path $certificateDirectory).Path
$certificate = Join-Path $certificateDirectory 'lan.pem'
$privateKey = Join-Path $certificateDirectory 'lan-key.pem'

& mkcert -install
if ($LASTEXITCODE -ne 0) { throw 'Could not install the mkcert CA into the Windows trust store.' }
& mkcert -cert-file $certificate -key-file $privateKey $lanAddress.IPAddress
if ($LASTEXITCODE -ne 0) { throw 'Could not create the HTTPS certificate for the LAN address.' }

$env:VITE_SCANNER_MOBILE_BASE_URL = "https://$($lanAddress.IPAddress):5173"
$env:DEV_HTTPS_CERT_FILE_DOCKER = '/certs/lan.pem'
$env:DEV_HTTPS_KEY_FILE_DOCKER = '/certs/lan-key.pem'

Write-Host "Frontend LAN: $env:VITE_SCANNER_MOBILE_BASE_URL"
Write-Host 'Install and trust the mkcert root CA on the phone before scanning the QR code.'
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose failed to start.' }
docker compose exec -T backend alembic upgrade head
if ($LASTEXITCODE -ne 0) { throw 'Database migrations failed. Check the backend/database logs and retry.' }

Write-Host 'Open the same HTTPS URL on the PC. PostgreSQL remains localhost-only; API traffic uses the frontend proxy.'
