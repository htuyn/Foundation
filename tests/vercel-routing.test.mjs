import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const readProjectFile = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const vercelConfig = JSON.parse(readProjectFile('../vercel.json'))
const appSource = readProjectFile('../src/App.tsx')
const mobilePageSource = readProjectFile('../src/features/scanner/ScannerMobilePage.tsx')
const scannerServiceSource = readProjectFile('../src/features/scanner/scannerService.ts')
const connectionDialogSource = readProjectFile('../src/features/scanner/ScannerConnectionDialog.tsx')
const remoteScannerButtonSource = readProjectFile('../src/features/scanner/RemoteScannerButton.tsx')

test('Vercel rewrites direct SPA requests to the Vite entry document', () => {
  assert.deepEqual(vercelConfig.rewrites, [
    { source: '/(.*)', destination: '/index.html' },
  ])
})

test('React Router keeps the mobile scanner route registered', () => {
  assert.match(appSource, /<Route path="\/scanner\/mobile" element={<ScannerMobilePage\s*\/>} \/>/)
  assert.ok(appSource.indexOf('<Route path="/scanner/mobile"') < appSource.indexOf('<Route element={<Layout />}>'))
})

test('production QR requires an explicit configured frontend origin', () => {
  assert.match(connectionDialogSource, /import\.meta\.env\.VITE_SCANNER_MOBILE_BASE_URL\?\.trim\(\) \?\? ''/)
  assert.match(connectionDialogSource, /import\.meta\.env\.PROD && !configuredMobileBaseUrl/)
  assert.match(connectionDialogSource, /configuredMobileBaseUrl \|\| window\.location\.origin/)
})

test('mobile scanner reads and validates session and QR expiry parameters', () => {
  for (const parameter of ['mode', 'sessionId', 'expiresAt']) {
    assert.ok(mobilePageSource.includes(`searchParams.get('${parameter}')`))
  }
  for (const parameter of ['qrNonce', 'qrExpiresAt']) {
    assert.ok(mobilePageSource.includes(`fragmentParams.get('${parameter}')`))
  }
  assert.match(mobilePageSource, /Date\.now\(\) < qrExpiresAt/)
  assert.match(mobilePageSource, /scannerSessionService\.joinSession\(sessionId, 'Điện thoại', qrNonce\)/)
})

test('scanner continues to use the configured API and secure WebSocket protocol', () => {
  assert.match(scannerServiceSource, /import\.meta\.env\.VITE_API_BASE_URL/)
  assert.match(scannerServiceSource, /window\.location\.protocol === 'https:' \? 'wss:' : 'ws:'/)
  assert.match(scannerServiceSource, /\{ method: 'POST', body: JSON\.stringify\(\{ qrNonce, deviceName \}\) \}/)
  assert.match(scannerServiceSource, /configured\.origin !== window\.location\.origin && localApi && !localPage/)
})

test('mobile camera auto-starts only after API authentication and cleans up safely', () => {
  assert.match(mobilePageSource, /mode !== 'api' \|\| !canScan \|\| autoCameraAttemptedRef\.current/)
  assert.match(mobilePageSource, /cameraStartingRef\.current\) return/)
  assert.match(mobilePageSource, /cameraAttemptRef\.current !== cameraAttempt/)
  assert.match(mobilePageSource, /stream\?\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/)
  assert.match(mobilePageSource, /decodeFromConstraints\(/)
  assert.match(mobilePageSource, /facingMode: \{ ideal: 'environment' \}/)
  assert.match(mobilePageSource, /mountedRef\.current = false[\s\S]*?stopCamera\(\)/)
  assert.match(mobilePageSource, /NotAllowedError[\s\S]*CAMERA_PERMISSION_DENIED/)
  assert.match(mobilePageSource, /NotFoundError[\s\S]*CAMERA_NOT_FOUND/)
  assert.match(mobilePageSource, /Cho phép camera \/ Bật camera/)
  assert.match(mobilePageSource, /Thử kết nối lại/)
})

test('hiding the desktop scanner dialog keeps its session receiver mounted', () => {
  assert.match(remoteScannerButtonSource, /<ScannerConnectionDialog open=\{open\}/)
  assert.match(connectionDialogSource, /if \(!open\) return null/)
  assert.match(connectionDialogSource, /useEffect\(\(\) => \{\s*if \(!session\) return\s*const unsubscribe = scanEventService\.subscribe/)
  assert.doesNotMatch(connectionDialogSource, /return \(\) => \{ void scannerSessionService\.closeSession/)
  assert.doesNotMatch(connectionDialogSource, /const dismiss = \(\) => \{[\s\S]*?closeSession\(/)
  assert.match(connectionDialogSource, /onClick=\{closeSession\}><Unplug[\s\S]*?Ngắt kết nối/)
  assert.match(connectionDialogSource, /await scannerSessionService\.closeSession\(session\.sessionId\)/)
})
