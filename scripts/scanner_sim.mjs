/**
 * scanner_sim.mjs – Trình giả lập thiết bị biên (Edge Device Simulator)
 *
 * CV01 · SV2 – Giả lập 2 điểm quét VLAN 30 trên /barcode:
 *   GATE_A  → Cổng Nhập    (Phiếu Nhập kho · IN)
 *   GATE_B  → Cổng Xuất    (Phiếu Xuất kho · OUT)
 *
 * Gói tin chuẩn hóa gửi API:
 *   idempotency_key  : UUID v4 – sinh ngay lúc quét, GIỮ NGUYÊN khi retry
 *   barcode          : mã EAN-13 hợp lệ
 *   quantity         : số lượng nguyên dương
 *   type             : 'IN' | 'OUT'   (map → 'Nhập kho' | 'Xuất kho' phía backend)
 *   scan_point       : 'GATE_A' | 'GATE_B'
 *   client_timestamp : ISO 8601 với timezone – GIỜ QUÉT TẠI KHO
 *   user_id          : UUID của nhân viên kho đã xác thực
 *
 * Chú thích thuật ngữ:
 *   client_timestamp = thời điểm quét được ghi tại thiết bị biên (đồng hồ kho)
 *   server_timestamp = thời điểm SV3 ghi vào PostgreSQL (createdAt trong response)
 *   → server_timestamp là chuẩn pháp lý; client_timestamp dùng để trace độ trễ mạng.
 *
 * Sử dụng:
 *   node scripts/scanner_sim.mjs [--gate A|B] [--count N] [--dry-run]
 *   node scripts/scanner_sim.mjs --gate A --count 5 --dry-run
 *   node scripts/scanner_sim.mjs --gate B --barcode 8938514907573 --quantity 2 \
 *        --api http://localhost:8000/api/v1 --token <access_token>
 */

import { randomUUID } from 'node:crypto'
import { argv } from 'node:process'

// ─── Tập mã EAN-13 mẫu (hàng thực trong kho An Phát) ───────────────────────
const SAMPLE_BARCODES_IN = [
  '8938514907572', // Mì Hảo Hảo tôm chua cay 75g
  '8936036091069', // Dầu ăn Neptune 1L
  '8936040101082', // Nước mắm Chin-su 500ml
  '8934588012044', // Sữa Vinamilk hộp 180ml
  '8934604000086', // Bánh quy Oreo 133g
]
const SAMPLE_BARCODES_OUT = [
  '8938514907572',
  '8936036091069',
  '8934588012044',
]

// ─── EAN-13 checksum helper ──────────────────────────────────────────────────
function ean13CheckDigit(digits12) {
  const sum = digits12
    .split('')
    .reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0)
  return String((10 - (sum % 10)) % 10)
}

function validEan13(code) {
  if (!/^\d{13}$/.test(code)) return false
  return code[12] === ean13CheckDigit(code.slice(0, 12))
}

// ─── Parse CLI args ──────────────────────────────────────────────────────────
function parseArgs(args) {
  const flags = {}
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2)
      flags[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true
    }
  }
  return flags
}

const flags = parseArgs(argv.slice(2))
const gateArg  = (flags.gate ?? 'A').toString().toUpperCase()
const countArg = Math.max(1, Math.min(50, Number(flags.count ?? 3)))
const dryRun   = Boolean(flags['dry-run'])
const apiBase  = (flags.api ?? 'http://localhost:8000/api/v1').toString().replace(/\/$/, '')
const token    = (flags.token ?? '').toString()
const fixedBarcode = flags.barcode?.toString() ?? null
const fixedQty     = flags.quantity ? Math.max(1, Number(flags.quantity)) : null

if (!['A', 'B'].includes(gateArg)) {
  console.error('[scanner_sim] --gate phải là A hoặc B')
  process.exit(1)
}
if (fixedBarcode && !validEan13(fixedBarcode)) {
  console.error(`[scanner_sim] Barcode ${fixedBarcode} không phải EAN-13 hợp lệ`)
  process.exit(1)
}

const GATE      = `GATE_${gateArg}`
const TYPE      = gateArg === 'A' ? 'IN' : 'OUT'
const API_TYPE  = gateArg === 'A' ? 'Nhập kho' : 'Xuất kho'
const BARCODES  = gateArg === 'A' ? SAMPLE_BARCODES_IN : SAMPLE_BARCODES_OUT

// ─── Sinh gói tin chuẩn hóa ─────────────────────────────────────────────────
/**
 * Tạo một gói tin quét theo đúng hợp đồng SV2.
 *
 * @param barcode  - Mã EAN-13
 * @param userId   - UUID người dùng đã xác thực
 * @param forcedKey - Nếu cung cấp, dùng lại key này (kịch bản retry)
 */
function createScanPacket(barcode, userId, forcedKey = null) {
  const idempotency_key = forcedKey ?? randomUUID() // ← sinh NGAY LÚC QUÉT
  const scan_event_id   = randomUUID()              // ← ID sự kiện quét riêng biệt
  const client_timestamp = new Date().toISOString() // ← GIỜ QUÉT TẠI KHO

  return {
    // ── Trường định danh khóa chống trùng ──
    idempotency_key,  // UUID v4; bất biến khi retry/double-submit/resync
    scan_event_id,    // UUID v4; ID của sự kiện quét tại thiết bị

    // ── Dữ liệu hàng hóa ──
    barcode,
    quantity: fixedQty ?? 1,
    type: TYPE,       // 'IN' | 'OUT'  (compact, dễ đọc tại thiết bị biên)
    scan_point: GATE, // 'GATE_A' | 'GATE_B'

    // ── Thời gian ──
    client_timestamp,  // Giờ quét tại kho – do đồng hồ thiết bị biên ghi
    // server_timestamp sẽ có trong response (createdAt) – do PostgreSQL ghi
    // → server_timestamp là chuẩn pháp lý; client_timestamp trace độ trễ

    // ── Người dùng ──
    user_id: userId,
  }
}

/**
 * Map gói tin thiết bị biên → body POST /documents theo API contract backend.
 * Trường type phía backend dùng tiếng Việt; scan_point, scanEventId,
 * clientTimestamp là metadata tùy chọn.
 */
function toDocumentBody(packet, { warehouseId, supplierId, partner }) {
  const body = {
    type: API_TYPE,     // 'Nhập kho' | 'Xuất kho'
    warehouseId,
    note: `Scanner ${packet.scan_point} · EAN-13 · ${packet.barcode}`,
    scanPoint: packet.scan_point,
    scanEventId: packet.scan_event_id,
    clientTimestamp: packet.client_timestamp,
    lines: [{ productId: '__lookup__', quantity: packet.quantity, unitCost: 0 }],
  }
  if (gateArg === 'A') {
    body.supplierId = supplierId ?? 'default-supplier'
  } else {
    body.partner = partner ?? 'KH-DEMO'
  }
  return body
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────
async function postDocument(packet, context) {
  const body = toDocumentBody(packet, context)
  const headers = {
    'Content-Type': 'application/json',
    'Idempotency-Key': packet.idempotency_key,
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const response = await fetch(`${apiBase}/documents`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })

  const payload = await response.json().catch(() => null)
  return { status: response.status, payload }
}

// ─── Hàm giả lập chính ───────────────────────────────────────────────────────
async function runSimulation() {
  const userId = flags['user-id']?.toString() ?? '00000000-0000-4000-8000-000000000001'

  console.log('╔══════════════════════════════════════════════════════════════')
  console.log(`║  scanner_sim · ${GATE} · ${TYPE} · ${countArg} gói tin`)
  console.log(`║  API: ${apiBase}  |  dry-run: ${dryRun}`)
  console.log('╚══════════════════════════════════════════════════════════════\n')

  const context = {
    warehouseId: flags['warehouse-id']?.toString() ?? 'wh-demo-01',
    supplierId:  flags['supplier-id']?.toString()  ?? 'sup-demo-01',
    partner:     flags.partner?.toString()          ?? 'KH-DEMO',
  }

  const results = []

  for (let index = 0; index < countArg; index += 1) {
    const barcode = fixedBarcode ?? BARCODES[index % BARCODES.length]
    if (!validEan13(barcode)) {
      console.warn(`[SKIP] ${barcode} không phải EAN-13 hợp lệ`)
      continue
    }

    const packet = createScanPacket(barcode, userId)

    console.log(`─── [${index + 1}/${countArg}] Gói tin mới ────────────────────────`)
    console.log(JSON.stringify(packet, null, 2))

    if (dryRun) {
      console.log('→ [DRY-RUN] Không gửi API\n')
      results.push({ packet, dryRun: true })
      continue
    }

    // ── Gửi lần đầu ──
    let response
    try {
      response = await postDocument(packet, context)
      console.log(`→ HTTP ${response.status}`, JSON.stringify(response.payload ?? {}, null, 2))
    } catch (error) {
      console.error(`→ [LỖI MẠNG] ${error.message}; giữ nguyên idempotency_key để retry`)
      results.push({ packet, networkError: error.message })
      continue
    }

    // ── Giả lập retry (bấm đúp) với CÙNG idempotency_key ──
    if (flags.retry) {
      console.log('\n  [KT2] Giả lập bấm đúp – gửi lại với idempotency_key không đổi')
      await new Promise((resolve) => setTimeout(resolve, 300))
      try {
        const retry = await postDocument(packet, context) // key KHÔNG đổi
        console.log(`  → HTTP ${retry.status}`, retry.status === 200 ? '✓ Idempotent replay' : '✓ Khóa chống trùng')
      } catch (retryError) {
        console.error(`  → [LỖI RETRY] ${retryError.message}`)
      }
    }

    // ── Lưu server_timestamp từ response ──
    const serverTimestamp = response.payload?.createdAt ?? null
    if (serverTimestamp) {
      const latencyMs = Date.now() - new Date(packet.client_timestamp).getTime()
      console.log(`\n  ⏱  client_timestamp : ${packet.client_timestamp}`)
      console.log(`  ⏱  server_timestamp : ${serverTimestamp}`)
      console.log(`  ⏱  độ trễ ước tính  : ${latencyMs} ms\n`)
    }

    results.push({ packet, status: response.status, serverTimestamp })

    // Giãn cách 400ms giữa các lần quét
    if (index < countArg - 1) await new Promise((resolve) => setTimeout(resolve, 400))
  }

  // ─── Tổng kết ───────────────────────────────────────────────────────────
  console.log('\n══════════════════════ KẾT QUẢ ══════════════════════')
  console.log(`Tổng: ${results.length} gói tin`)
  if (!dryRun) {
    const success = results.filter((r) => r.status >= 200 && r.status < 300).length
    const idempotent = results.filter((r) => r.status === 409).length
    const errors = results.filter((r) => r.networkError).length
    console.log(`  Thành công   : ${success}`)
    console.log(`  Idempotent   : ${idempotent}  (409 = khóa chống trùng hoạt động)`)
    console.log(`  Lỗi mạng     : ${errors}`)
  }
  console.log('\nMẫu gói tin JSON thực tế (bản ghi đầu tiên):')
  if (results[0]?.packet) console.log(JSON.stringify(results[0].packet, null, 2))
  console.log('══════════════════════════════════════════════════════')
}

runSimulation().catch((error) => {
  console.error('[scanner_sim] Lỗi nghiêm trọng:', error)
  process.exit(1)
})
