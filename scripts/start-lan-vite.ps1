param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 5174
)

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

$mkcertCommand = Get-Command mkcert -ErrorAction SilentlyContinue
if ($mkcertCommand) {
  $mkcert = $mkcertCommand.Source
} else {
  $mkcert = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\FiloSottile.mkcert_Microsoft.Winget.Source_8wekyb3d8bbwe\mkcert.exe'
}

if (-not (Test-Path $mkcert)) {
  throw 'mkcert is required. Install it with: winget install --id FiloSottile.mkcert --exact --source winget'
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listener) {
  throw "Port $Port is already in use. Stop its server or rerun with -Port <free-port>."
}

try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health/ready' -TimeoutSec 5
  if ($health.status -ne 'ready') { throw 'Backend is not ready.' }
} catch {
  throw 'Backend is not reachable at http://127.0.0.1:8000. Start the backend before Vite.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$certificateDirectory = Join-Path $repoRoot 'certs'
New-Item -ItemType Directory -Force -Path $certificateDirectory | Out-Null
$certificate = Join-Path $certificateDirectory 'vite-lan.pem'
$privateKey = Join-Path $certificateDirectory 'vite-lan-key.pem'

& $mkcert -cert-file $certificate -key-file $privateKey $lanAddress.IPAddress localhost 127.0.0.1
if ($LASTEXITCODE -ne 0) { throw 'Could not create the HTTPS certificate for the LAN address.' }
$caRoot = (& $mkcert -CAROOT).Trim()

$env:VITE_API_BASE_URL = '/api/v1'
$env:VITE_DEV_API_TARGET = 'http://127.0.0.1:8000'
$env:VITE_SCANNER_MOBILE_BASE_URL = "https://$($lanAddress.IPAddress):$Port"
$env:DEV_HTTPS_CERT_FILE = $certificate
$env:DEV_HTTPS_KEY_FILE = $privateKey

Write-Host "Desktop: https://localhost:$Port"
Write-Host "Phone:   $env:VITE_SCANNER_MOBILE_BASE_URL"
Write-Host "Install and trust this CA on Windows and the phone: $(Join-Path $caRoot 'rootCA.pem')"
Write-Warning 'The CA is not installed automatically. Import rootCA.pem into the Current User Trusted Root Certification Authorities store on Windows and enable trust for it on the phone before opening the HTTPS URLs.'

$networkProfile = Get-NetConnectionProfile -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue
if ($networkProfile.NetworkCategory -ne 'Private') {
  Write-Warning "The current network is not Private. Windows Firewall may block phone access to TCP $Port; do not expose this development server on an untrusted network."
}

Push-Location $repoRoot
try {
  & npm run dev -- --port $Port
  if ($LASTEXITCODE -ne 0) { throw 'Vite stopped with an error.' }
} finally {
  Pop-Location
}
