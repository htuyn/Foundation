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
const documentsPageSource = readProjectFile('../src/pages/DocumentsPage.tsx')
const directScannerSource = readProjectFile('../src/components/BarcodeScannerDialog.tsx')
const gateScannerSource = readProjectFile('../src/features/scanner/GateScannerDialog.tsx')
const gateTransactionsSource = readProjectFile('../src/features/scanner/gateTransactions.ts')
const gateTransactionCoreSource = readProjectFile('../src/features/scanner/gateTransactionCore.ts')
const gateQueueStoreSource = readProjectFile('../src/features/scanner/gateQueueStore.ts')
const offlineQueueSource = readProjectFile('../src/features/scanner/offlineQueueLocalStorage.ts')
const scannerSimSource = readProjectFile('../scripts/scanner_sim.mjs')

test('Vercel rewrites direct SPA requests to the Vite entry document', () => {
  assert.deepEqual(vercelConfig.rewrites, [
    { source: '/(.*)', destination: '/index.html' },
  ])
})

test('React Router keeps the mobile scanner route registered', () => {
  assert.match(appSource, /<Route path="\/scanner\/mobile" element={<ScannerMobilePage\s*\/>} \/>/)
  assert.ok(appSource.indexOf('<Route path="/scanner/mobile"') < appSource.indexOf('<Route element={<AuthenticatedLayout />}>'))
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

test('draft document scan events are deduplicated by eventId and looked up sequentially', () => {
  assert.match(documentsPageSource, /processedScanEventIdsRef\.current\.has\(event\.eventId\)/)
  assert.match(documentsPageSource, /const task = scanQueueRef\.current\.then\(\(\) => addScannedProduct\(event\.barcode, event\.format, fromCamera\)\)/)
  assert.match(documentsPageSource, /scanEventTasksRef\.current\.set\(event\.eventId, task\)/)
  assert.match(documentsPageSource, /onScan=\{handleScanEvent\}/)
  assert.match(documentsPageSource, /line\.quantity \+ 1/)
})

test('draft line quantities are editable and camera scans rearm only after barcode leaves view', () => {
  assert.match(documentsPageSource, /aria-label=\{`Số lượng \$\{product\?\.name \?\? ''\}`\} type="number" min="1" step="1"/)
  assert.match(documentsPageSource, /Number\.isInteger\(nextQuantity\) \|\| nextQuantity < 1/)
  assert.match(directScannerSource, /rearmAfterMissingMs = 350/)
  assert.match(directScannerSource, /activeBarcodeRef\.current\.lastSeenAt >= rearmAfterMissingMs/)
  assert.match(mobilePageSource, /lastScanRef\.current\.lastSeenAt >= rearmAfterMissingMs/)
  assert.match(mobilePageSource, /outboxRef\.current\.set\(event\.eventId, event\)/)
  assert.match(mobilePageSource, /outboxRef\.current\.has\(event\.eventId\)[\s\S]*?deliver\(event\)/)
  assert.match(connectionDialogSource, /scanner-connection-console/)
  assert.match(connectionDialogSource, /Promise\.resolve\(\)\.then\(\(\) => onScanRef\.current\(event\)\)\.then\(finishScan, finishScan\)/)
  assert.doesNotMatch(directScannerSource, /now - lastScanAt < 1800/)
})

test('gate scanners map inbound/outbound, validate EAN-13 and keep scan and transaction identifiers separate', () => {
  assert.match(documentsPageSource, /type === 'Nhập kho' \? 'GATE_A' : 'GATE_B'/)
  assert.match(gateScannerSource, /type === 'Nhập kho' \? 'GATE_A' : 'GATE_B'/)
  assert.match(gateScannerSource, /validEan13\(barcode\)/)
  assert.match(gateScannerSource, /scanEventId,/)
  assert.match(gateTransactionCoreSource, /randomUUID \?\? globalThis\.crypto\?\.randomUUID/)
  assert.match(gateTransactionsSource, /Idempotency-Key/)
  assert.match(gateQueueStoreSource, /store\.add\(\{ \.\.\.record, queueOrder: sequence \}\)/)
  assert.match(gateScannerSource, /persistBeforeSync\([\s\S]*syncGateTransactions/)
  assert.match(gateTransactionsSource, /navigator\.locks\?\.request/)
  assert.match(gateTransactionsSource, /status: 'SYNCED',[\s\S]*documentId: result\.id/)
})

test('gate queue uses durable IndexedDB migration, FIFO lifecycle and API reachability checks', () => {
  assert.match(gateQueueStoreSource, /DATABASE_VERSION = 2/)
  assert.match(gateQueueStoreSource, /openCursor\(\)/)
  assert.match(gateQueueStoreSource, /await done[\s\S]*if \(migrated \|\| alreadyMigrated\) legacy\.forEach/)
  assert.match(gateQueueStoreSource, /store\.add\(\{ \.\.\.record, queueOrder: sequence \}\)/)
  assert.match(gateTransactionsSource, /nextFifoQueueItem\(await listStoredTransactions\(userId\), now\)/)
  assert.match(gateTransactionsSource, /status: 'PAUSED_AUTH'/)
  assert.match(gateTransactionsSource, /window\.addEventListener\('offline'/)
  assert.match(gateTransactionsSource, /checkApiConnectivity/)
  assert.match(gateTransactionsSource, /Date\.now\(\) \+ 5000/)
})

// ── SV2 CV01: Scanner sim packet contract ─────────────────────────────────────
test('CV01: scanner_sim produces normalized packet with idempotency_key, client_timestamp and type IN/OUT', () => {
  // idempotency_key phải là UUID v4 độc lập với scan_event_id
  assert.match(scannerSimSource, /idempotency_key = forcedKey \?\? randomUUID\(\)/)
  assert.match(scannerSimSource, /scan_event_id\s*=\s*randomUUID\(\)/)
  assert.match(scannerSimSource, /client_timestamp = new Date\(\)\.toISOString\(\)/)
  // Phân biệt client_timestamp (đồng hồ kho) vs server_timestamp (PostgreSQL)
  assert.match(scannerSimSource, /client_timestamp.*giờ quét tại kho/is)
  assert.match(scannerSimSource, /server_timestamp.*PostgreSQL/is)
  // type IN/OUT được map sang backend Vietnamese
  assert.match(scannerSimSource, /gateArg === 'A' \? 'IN' : 'OUT'/)
  assert.match(scannerSimSource, /gateArg === 'A' \? 'Nhập kho' : 'Xuất kho'/)
  // EAN-13 validation
  assert.match(scannerSimSource, /ean13CheckDigit/)
  assert.match(scannerSimSource, /validEan13/)
  // Giữ nguyên idempotency_key khi retry
  assert.match(scannerSimSource, /forcedKey.*retry/is)
  // Idempotency-Key header bất biến
  assert.match(scannerSimSource, /'Idempotency-Key': packet\.idempotency_key/)
})

// ── SV2 CV02: LocalStorage offline queue ─────────────────────────────────────
test('CV02: LocalStorage offline queue has FIFO enqueue, exponential backoff and dead-letter routing', () => {
  // FIFO enqueue
  assert.match(offlineQueueSource, /queue\.push\(/)
  assert.match(offlineQueueSource, /status: 'PENDING'/)
  // Idempotency – không enqueue key đã tồn tại
  assert.match(offlineQueueSource, /idempotency_key === packet\.idempotency_key/)
  // Exponential backoff delays
  assert.match(offlineQueueSource, /RETRY_DELAYS_MS = \[1000, 2000, 4000/)
  // HTTP response handling: 2xx/409 → remove; 400/403 → dead-letter; 401 → paused; 5xx → retry
  assert.match(offlineQueueSource, /status >= 200 && status < 300/)
  assert.match(offlineQueueSource, /status === 409/)
  assert.match(offlineQueueSource, /status === 400 \|\| status === 403/)
  assert.match(offlineQueueSource, /DEAD_LETTER/)
  assert.match(offlineQueueSource, /status === 401/)
  assert.match(offlineQueueSource, /PAUSED_AUTH/)
  // Capacity warning 80%
  assert.match(offlineQueueSource, /CAPACITY_WARNING_RATIO\s*=\s*0\.8/)
  assert.match(offlineQueueSource, /warningActive/)
  // Export emergency backup
  assert.match(offlineQueueSource, /exportQueueToJson/)
  assert.match(offlineQueueSource, /exportQueueToCsv/)
  assert.match(offlineQueueSource, /downloadQueueBackup/)
  // online/offline events
  assert.match(offlineQueueSource, /window\.addEventListener\('online'/)
  assert.match(offlineQueueSource, /window\.addEventListener\('offline'/)
  // Capacity table
  assert.match(offlineQueueSource, /computeCapacityTable/)
  assert.match(offlineQueueSource, /LOCAL_STORAGE_QUOTA_BYTES/)
  assert.match(offlineQueueSource, /measureRecordSizeBytes/)
})

// ── SV2 CV02: Bảng dung lượng thực đo ────────────────────────────────────────
test('CV02: capacity table documents UTF-16 storage limit and max offline scan count', () => {
  // 5 MB quota được khai báo
  assert.match(offlineQueueSource, /5 \* 1024 \* 1024/)
  // UTF-16: 2 bytes per char được giải thích
  assert.match(offlineQueueSource, /UTF-16/)
  // Phép tính kích thước thực
  assert.match(offlineQueueSource, /json\.length \* 2/)
  // IndexedDB là hướng nâng cấp
  assert.match(offlineQueueSource, /IndexedDB/)
})

// ── SV2 CV03: KT1 / KT2 artifacts ────────────────────────────────────────────
test('CV03 KT1: gate scanner dialog has camera and manual EAN-13 input for real scan test', () => {
  // Camera button (KT1 – quét thật bằng Camera)
  assert.match(gateScannerSource, /Mở camera \(KT1\)/)
  // Manual EAN-13 input với pattern
  assert.match(gateScannerSource, /pattern="\[\\\\d\]\{13\}"/)
  assert.match(gateScannerSource, /Nhập EAN-13 thủ công/)
  // client_timestamp ghi nhận tại scan event
  assert.match(gateScannerSource, /clientTimestamp: scannedAt/)
  assert.match(gateScannerSource, /client_timestamp.*giờ kho/is)
  // server_timestamp từ response
  assert.match(gateScannerSource, /serverTimestamp.*server_timestamp/is)
})

test('CV03 KT2: double-submit guard blocks duplicate; idempotency_key unchanged on retry', () => {
  // Double-click guard
  assert.match(gateScannerSource, /isManualDoubleClick/)
  assert.match(gateScannerSource, /enqueueBusy/)
  // in-flight guard cho camera scan
  assert.match(gateScannerSource, /inFlightEventsRef\.current\.has\(scanEventId\)/)
  // Retry button giữ nguyên idempotencyKey
  assert.match(gateScannerSource, /retryGateTransaction\(user\.id, item\.idempotencyKey\)/)
  assert.match(gateTransactionCoreSource, /prepareGateTransactionRetry/)
  assert.match(gateTransactionCoreSource, /status: 'PENDING'.*retryAt: undefined/is)
})

test('CV03: offline indicator, dead-letter panel and emergency export present in dialog', () => {
  // Trạng thái offline hiển thị rõ
  assert.match(gateScannerSource, /Mất kết nối mạng/)
  assert.match(gateScannerSource, /isOnline/)
  // Cảnh báo 80%
  assert.match(gateScannerSource, /Cảnh báo dung lượng/)
  // Xuất khẩn cấp
  assert.match(gateScannerSource, /Xuất khẩn cấp \(\.json\)/)
  assert.match(gateScannerSource, /downloadQueueBackup/)
  // Dead-letter panel
  assert.match(gateScannerSource, /Dead-Letter/)
  assert.match(gateScannerSource, /loadDeadLetterItems/)
  // Bảng dung lượng
  assert.match(gateScannerSource, /computeCapacityTable/)
  assert.match(gateScannerSource, /maxRecordsEstimate/)
})

