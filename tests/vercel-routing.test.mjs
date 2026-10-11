import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const readProjectFile = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const vercelConfig = JSON.parse(readProjectFile('../vercel.json'))
const appSource = readProjectFile('../src/App.tsx')
const mobilePageSource = readProjectFile('../src/features/scanner/ScannerMobilePage.tsx')
const scannerServiceSource = readProjectFile('../src/features/scanner/scannerService.ts')

test('Vercel rewrites direct SPA requests to the Vite entry document', () => {
  assert.deepEqual(vercelConfig.rewrites, [
    { source: '/(.*)', destination: '/index.html' },
  ])
})

test('React Router keeps the mobile scanner route registered', () => {
  assert.match(appSource, /<Route path="\/scanner\/mobile" element={<ScannerMobilePage\s*\/>} \/>/)
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
