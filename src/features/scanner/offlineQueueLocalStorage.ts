/**
 * offlineQueueLocalStorage.ts
 * CV02 · SV2 – Offline Queue chịu lỗi phía client (LocalStorage FIFO)
 *
 * Mục đích: Cung cấp hàng đợi LocalStorage đơn giản để mô phỏng hành vi
 * của thiết bị biên cầm tay (barcode scanner handheld). IndexedDB là hướng
 * nâng cấp khi cần hàng đợi lớn hơn (xem CV02 cuối file).
 *
 * Hợp đồng gói tin (SV2 CV01):
 *   idempotency_key  : UUID v4 – sinh ngay lúc quét, bất biến khi retry
 *   barcode          : mã EAN-13 hợp lệ
 *   quantity         : số nguyên dương
 *   type             : 'IN' | 'OUT'
 *   scan_point       : 'GATE_A' | 'GATE_B'
 *   client_timestamp : ISO 8601 với timezone (giờ quét tại kho)
 *   user_id          : UUID người dùng đã xác thực
 *
 * Phân biệt timestamp:
 *   client_timestamp = đồng hồ thiết bị biên ghi ngay lúc quét
 *   server_timestamp = PostgreSQL ghi khi SV3 xử lý → là chuẩn pháp lý
 */

export const QUEUE_VERSION = 'sv2-edge-queue-v1'
export const DEAD_LETTER_KEY_SUFFIX = ':dead-letter'
export const CAPACITY_WARNING_RATIO = 0.8   // Cảnh báo khi đạt 80%

/** Kích thước LocalStorage ước tính (5 MB per origin, UTF-16 = 2 bytes/char) */
export const LOCAL_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024
/** Kích thước một bản ghi JSON (đo thực tế – xem bảng cuối file) */
export const RECORD_BYTES_ESTIMATE = 600  // bytes UTF-16 ~= 300 ký tự × 2

export interface EdgeScanPacket {
  idempotency_key: string    // UUID v4; bất biến khi retry
  scan_event_id: string      // UUID v4; ID sự kiện quét riêng
  barcode: string            // EAN-13 hợp lệ
  quantity: number           // Số nguyên > 0
  type: 'IN' | 'OUT'
  scan_point: 'GATE_A' | 'GATE_B'
  client_timestamp: string   // ISO 8601 + timezone; giờ quét tại kho
  user_id: string            // UUID người dùng
  queued_at: number          // Date.now() khi enqueue
  attempt_count: number      // Số lần đã thử
  status: EdgePacketStatus
  last_error?: string
  retry_at?: number          // Date.now() epoch cho lần retry tiếp theo
  server_timestamp?: string  // Từ response backend (createdAt)
  document_id?: string       // ID phiếu nháp từ response
}

export type EdgePacketStatus =
  | 'PENDING'       // Chờ gửi
  | 'SYNCING'       // Đang gửi
  | 'RETRY_WAIT'    // Chờ exponential backoff
  | 'SYNCED'        // Đã gửi thành công hoặc 409 DUPLICATE_KEY
  | 'PAUSED_AUTH'   // 401 – giữ hàng đợi, yêu cầu đăng nhập lại
  | 'DEAD_LETTER'   // 400/403 – lỗi terminal, cảnh báo thủ kho

/** Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 60s, 60s */
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function queueKey(userId: string): string {
  return `${QUEUE_VERSION}:${userId}:queue`
}

function deadLetterKey(userId: string): string {
  return `${QUEUE_VERSION}:${userId}${DEAD_LETTER_KEY_SUFFIX}`
}

function safeParseArray(raw: string | null): EdgeScanPacket[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveQueue(userId: string, queue: EdgeScanPacket[]): void {
  try {
    localStorage.setItem(queueKey(userId), JSON.stringify(queue))
  } catch (error) {
    // QuotaExceededError – caller phải xử lý
    throw error
  }
}

function loadQueue(userId: string): EdgeScanPacket[] {
  return safeParseArray(localStorage.getItem(queueKey(userId)))
}

function loadDeadLetter(userId: string): EdgeScanPacket[] {
  return safeParseArray(localStorage.getItem(deadLetterKey(userId)))
}

function saveDeadLetter(userId: string, items: EdgeScanPacket[]): void {
  localStorage.setItem(deadLetterKey(userId), JSON.stringify(items))
}

/** Đọc danh sách Dead-Letter items (nhật ký lỗi terminal) */
export function loadDeadLetterItems(userId: string): EdgeScanPacket[] {
  return loadDeadLetter(userId)
}

// ─── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * Thêm gói tin vào FIFO queue.
 * Trả về false nếu idempotency_key đã tồn tại (double-submit protection).
 * Ném QuotaExceededError nếu LocalStorage đầy.
 */
export function enqueue(userId: string, packet: EdgeScanPacket): boolean {
  const queue = loadQueue(userId)
  if (queue.some((item) => item.idempotency_key === packet.idempotency_key)) {
    return false // Khóa đã tồn tại – bỏ qua (idempotency)
  }
  queue.push({ ...packet, status: 'PENDING', attempt_count: 0, queued_at: Date.now() })
  saveQueue(userId, queue) // ném nếu quota vượt
  return true
}

/** Đọc FIFO queue theo thứ tự enqueue */
export function peekQueue(userId: string): EdgeScanPacket[] {
  return loadQueue(userId)
}

/** Lấy phần tử đầu hàng đợi PENDING/RETRY_WAIT đến hạn */
export function nextPendingItem(userId: string, now = Date.now()): EdgeScanPacket | null {
  const queue = loadQueue(userId)
  const head = queue.find(
    (item) => item.status !== 'SYNCED' && item.status !== 'DEAD_LETTER',
  )
  if (!head) return null
  if (head.status === 'PAUSED_AUTH') return null
  if (head.status === 'RETRY_WAIT' && (head.retry_at ?? 0) > now) return null
  if (head.status === 'PENDING' || head.status === 'RETRY_WAIT') return head
  return null
}

function updateItem(
  userId: string,
  key: string,
  change: (item: EdgeScanPacket) => EdgeScanPacket,
): void {
  const queue = loadQueue(userId)
  const index = queue.findIndex((item) => item.idempotency_key === key)
  if (index === -1) return
  queue[index] = change(queue[index])
  saveQueue(userId, queue)
}

/** Xóa item khỏi hàng đợi (sau SYNCED hoặc 409 DUPLICATE_KEY) */
function removeFromQueue(userId: string, key: string): void {
  const queue = loadQueue(userId)
  const filtered = queue.filter((item) => item.idempotency_key !== key)
  saveQueue(userId, filtered)
}

/** Chuyển vào Dead-Letter và cảnh báo thủ kho */
function moveToDead(userId: string, key: string, error: string): void {
  const queue = loadQueue(userId)
  const item = queue.find((item) => item.idempotency_key === key)
  if (!item) return
  const dead = loadDeadLetter(userId)
  dead.push({ ...item, status: 'DEAD_LETTER', last_error: error })
  saveDeadLetter(userId, dead)
  removeFromQueue(userId, key)
}

// ─── Xử lý phản hồi API ──────────────────────────────────────────────────────

/**
 * Xử lý response từ POST /documents.
 *
 * Mã phản hồi theo CV02:
 *   2xx / 409 DUPLICATE_KEY → SYNCED, xóa khỏi hàng đợi
 *   400 / 403               → DEAD_LETTER, cảnh báo thủ kho, không retry
 *   401                     → PAUSED_AUTH, giữ hàng đợi, yêu cầu đăng nhập lại
 *   5xx / lỗi mạng          → RETRY_WAIT (exponential backoff)
 */
export function handleApiResponse(
  userId: string,
  key: string,
  status: number,
  errorCode?: string,
  serverResponse?: { id?: string; createdAt?: string },
): void {
  if (status >= 200 && status < 300) {
    // 2xx → thành công, xóa khỏi hàng đợi
    updateItem(userId, key, (item) => ({
      ...item,
      status: 'SYNCED',
      document_id: serverResponse?.id,
      server_timestamp: serverResponse?.createdAt,
      retry_at: undefined,
      last_error: undefined,
    }))
    removeFromQueue(userId, key)
    return
  }

  if (status === 409) {
    // 409 DUPLICATE_KEY → coi là đã xử lý (idempotent), xóa khỏi hàng đợi
    removeFromQueue(userId, key)
    return
  }

  if (status === 400 || status === 403) {
    // Terminal: xuất vượt tồn / dữ liệu sai / sai quyền → Dead-Letter
    // ⚠️ Cảnh báo thủ kho qua UI (caller đọc dead-letter và hiển thị)
    moveToDead(userId, key, `HTTP ${status}${errorCode ? ` · ${errorCode}` : ''}`)
    return
  }

  if (status === 401) {
    // Phiên hết hạn → giữ hàng đợi, yêu cầu đăng nhập lại
    updateItem(userId, key, (item) => ({
      ...item,
      status: 'PAUSED_AUTH',
      last_error: 'Phiên đăng nhập hết hạn; hãy đăng nhập lại.',
    }))
    return
  }

  // 5xx / 429 / lỗi mạng → RETRY_WAIT với exponential backoff
  updateItem(userId, key, (item) => {
    const attempt = item.attempt_count + 1
    if (attempt > RETRY_DELAYS_MS.length) {
      // Hết số lần retry → Dead-Letter
      moveToDead(userId, key, `Hết ${RETRY_DELAYS_MS.length} lần thử · HTTP ${status}`)
      return { ...item, status: 'DEAD_LETTER' }
    }
    const jitter = Math.floor(Math.random() * Math.min(1000, RETRY_DELAYS_MS[attempt - 1] / 4))
    return {
      ...item,
      status: 'RETRY_WAIT',
      attempt_count: attempt,
      retry_at: Date.now() + RETRY_DELAYS_MS[attempt - 1] + jitter,
      last_error: `HTTP ${status} · lần thử ${attempt}/${RETRY_DELAYS_MS.length}`,
    }
  })
}

/** Xử lý lỗi mạng (fetch throw) */
export function handleNetworkError(userId: string, key: string, message: string): void {
  handleApiResponse(userId, key, 503, message)
}

/** Resume PAUSED_AUTH sau khi người dùng đăng nhập lại */
export function resumeAfterAuth(userId: string): void {
  const queue = loadQueue(userId)
  const updated = queue.map((item) =>
    item.status === 'PAUSED_AUTH' ? { ...item, status: 'PENDING' as EdgePacketStatus, last_error: undefined } : item,
  )
  saveQueue(userId, updated)
}

// ─── Dung lượng và cảnh báo ───────────────────────────────────────────────────

/**
 * Đo kích thước thực tế của một bản ghi JSON trong LocalStorage.
 * LocalStorage lưu UTF-16 → 2 bytes/ký tự.
 * 5 MB quota = 5_242_880 bytes → tối đa 5_242_880 / 2 = 2_621_440 ký tự.
 */
export function measureRecordSizeBytes(record: EdgeScanPacket): number {
  const json = JSON.stringify(record)
  return json.length * 2 // UTF-16
}

/**
 * Trả về bảng dung lượng thực tế.
 * Dùng để ghi vào báo cáo (MC03).
 */
export function computeCapacityTable(userId: string): CapacityTable {
  const queue = loadQueue(userId)
  const sampleRecord = queue[0]

  // Đo kích thước thực nếu có bản ghi, ngược lại dùng ước tính
  const bytesPerRecord = sampleRecord
    ? measureRecordSizeBytes(sampleRecord)
    : RECORD_BYTES_ESTIMATE

  const quotaBytes = LOCAL_STORAGE_QUOTA_BYTES
  const quotaChars = quotaBytes / 2            // UTF-16
  const maxRecords = Math.floor(quotaChars / (bytesPerRecord / 2))
  const warningAt = Math.floor(maxRecords * CAPACITY_WARNING_RATIO)
  const currentCount = queue.length
  const usedBytes = queue.reduce((sum, r) => sum + measureRecordSizeBytes(r), 0)
  const remainingSlots = Math.max(0, maxRecords - currentCount)
  const fillRatio = usedBytes / quotaBytes

  return {
    quotaBytes,
    bytesPerRecord,
    maxRecordsEstimate: maxRecords,
    warningThreshold: warningAt,
    currentCount,
    usedBytes,
    remainingSlots,
    fillRatio,
    warningActive: fillRatio >= CAPACITY_WARNING_RATIO,
  }
}

export interface CapacityTable {
  quotaBytes: number   // 5_242_880 bytes
  bytesPerRecord: number   // thực đo (UTF-16)
  maxRecordsEstimate: number   // lượt quét tối đa khi mất mạng kéo dài
  warningThreshold: number   // ngưỡng cảnh báo 80%
  currentCount: number   // số bản ghi hiện tại
  usedBytes: number   // bytes đã dùng
  remainingSlots: number   // số lượt quét còn lại
  fillRatio: number   // 0.0 – 1.0
  warningActive: boolean  // true nếu ≥ 80%
}

// ─── Xuất khẩn cấp hàng đợi ──────────────────────────────────────────────────

/**
 * Xuất khẩn cấp hàng đợi ra file JSON hoặc CSV.
 * Dùng khi LocalStorage gần đầy hoặc khi cần sao lưu thủ công.
 */
export function exportQueueToJson(userId: string): string {
  const queue = loadQueue(userId)
  const deadLetter = loadDeadLetter(userId)
  const capacity = computeCapacityTable(userId)
  return JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      user_id: userId,
      queue_version: QUEUE_VERSION,
      capacity,
      queue,
      dead_letter: deadLetter,
    },
    null,
    2,
  )
}

export function exportQueueToCsv(userId: string): string {
  const queue = loadQueue(userId)
  const headers = [
    'idempotency_key', 'scan_event_id', 'barcode', 'quantity', 'type',
    'scan_point', 'client_timestamp', 'server_timestamp', 'status',
    'attempt_count', 'last_error', 'document_id', 'queued_at',
  ]
  const csvRows = [
    headers.join(','),
    ...queue.map((r) =>
      headers.map((h) => {
        const value = (r as unknown as Record<string, unknown>)[h] ?? ''
        const str = String(value).replace(/"/g, '""')
        return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str
      }).join(','),
    ),
  ]
  return csvRows.join('\r\n')
}

/** Tải file download trong browser */
export function downloadQueueBackup(userId: string, format: 'json' | 'csv' = 'json'): void {
  const content = format === 'json' ? exportQueueToJson(userId) : exportQueueToCsv(userId)
  const mimeType = format === 'json' ? 'application/json' : 'text/csv'
  const filename = `sv2-queue-backup-${userId.slice(0, 8)}-${Date.now()}.${format}`
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// ─── Vòng lặp đồng bộ (online/offline) ───────────────────────────────────────

export interface SyncOptions {
  userId: string
  onStatusChange?: () => void
  onWarning?: (capacity: CapacityTable) => void
  onDeadLetter?: (items: EdgeScanPacket[]) => void
  postDocument: (packet: EdgeScanPacket) => Promise<{ status: number; id?: string; createdAt?: string; errorCode?: string }>
}

/**
 * Khởi động vòng lặp đồng bộ:
 *   – Lắng nghe sự kiện online/offline
 *   – Tự đồng bộ khi có mạng (exponential backoff)
 *   – Cảnh báo khi đạt 80% dung lượng
 *
 * Trả về hàm cleanup để gọi khi component unmount.
 */
export function startOfflineQueueSync(options: SyncOptions): () => void {
  const { userId, onStatusChange, onWarning, onDeadLetter, postDocument } = options

  let syncing = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const checkCapacity = () => {
    const capacity = computeCapacityTable(userId)
    if (capacity.warningActive) onWarning?.(capacity)
  }

  const notifyDeadLetter = () => {
    const dead = loadDeadLetter(userId)
    if (dead.length) onDeadLetter?.(dead)
  }

  const sync = async () => {
    if (syncing || !navigator.onLine) return
    syncing = true
    checkCapacity()

    try {
      while (true) {
        const item = nextPendingItem(userId)
        if (!item) break

        updateItem(userId, item.idempotency_key, (r) => ({ ...r, status: 'SYNCING' }))
        onStatusChange?.()

        try {
          const response = await postDocument(item)
          handleApiResponse(userId, item.idempotency_key, response.status, response.errorCode, response)
          if (response.status === 401) break // PAUSED_AUTH – dừng vòng lặp
        } catch {
          handleNetworkError(userId, item.idempotency_key, 'Lỗi mạng')
        }

        onStatusChange?.()
        notifyDeadLetter()
        await new Promise<void>((resolve) => setTimeout(resolve, 100))
      }
    } finally {
      syncing = false
    }

    // Schedule retry cho RETRY_WAIT items
    const queue = loadQueue(userId)
    const nextRetry = queue
      .filter((r) => r.status === 'RETRY_WAIT' && r.retry_at)
      .map((r) => r.retry_at!)
      .sort((a, b) => a - b)[0]

    if (nextRetry) {
      retryTimer = setTimeout(() => { void sync() }, Math.max(0, nextRetry - Date.now()))
    }
  }

  const onOnline = () => { void sync() }
  const onOffline = () => { onStatusChange?.() }

  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)

  // Khởi động ngay nếu online
  if (navigator.onLine) void sync()

  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    if (retryTimer !== null) clearTimeout(retryTimer)
  }
}

/*
 * ──────────────────────────────────────────────────────────────────────────────
 * BẢNG DUNG LƯỢNG BẢN GHI (MC03 · CV02)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Phương pháp đo:
 *   JSON.stringify(samplePacket).length × 2  (vì LocalStorage dùng UTF-16)
 *
 * Mẫu bản ghi thực tế (đo ngày 2026-11-16):
 * {
 *   "idempotency_key":  "f172455a-ec9b-4741-8d9d-27150c93da90",  // 36 chars
 *   "scan_event_id":    "b8db8a39-5f5e-4db4-a098-08b0664d6b52",  // 36 chars
 *   "barcode":          "8938514907573",                           // 13 chars
 *   "quantity":         1,
 *   "type":             "IN",
 *   "scan_point":       "GATE_A",
 *   "client_timestamp": "2026-11-16T07:30:00.000Z",               // 24 chars
 *   "user_id":          "be8a0907-fb73-4b67-9af0-12d8734e2160",  // 36 chars
 *   "queued_at":        1731731400000,
 *   "attempt_count":    0,
 *   "status":           "PENDING"
 * }
 *
 * JSON text ≈ 320 ký tự → 640 bytes UTF-16
 * Với overhead key LocalStorage (≈ 50 chars × 2 = 100 bytes): ~740 bytes/record
 *
 * BẢNG TÍNH:
 * ┌─────────────────────────────────────────────────────────┐
 * │  LocalStorage quota (per origin)         ≈ 5 MB         │
 * │  = 5,242,880 bytes                                      │
 * │  UTF-16: tối đa 2,621,440 ký tự                         │
 * │                                                         │
 * │  Kích thước 1 bản ghi (JSON text)        ≈ 320 ký tự   │
 * │  Kích thước 1 bản ghi (UTF-16 bytes)     ≈ 640 bytes    │
 * │  Với overhead key                        ≈ 740 bytes    │
 * │                                                         │
 * │  Lượt quét tối đa (5MB / 740 bytes)      ≈ 7,084 lượt  │
 * │  Ngưỡng cảnh báo 80%                     ≈ 5,667 lượt  │
 * │                                                         │
 * │  Nếu dùng IndexedDB (không giới hạn cứng):             │
 * │    → Hàng đợi có thể lên đến hàng trăm nghìn lượt     │
 * │    → Xem gateQueueStore.ts (IndexedDB P04/P05)         │
 * └─────────────────────────────────────────────────────────┘
 *
 * Hướng nâng cấp:
 *   LocalStorage: Đơn giản, đồng bộ, giới hạn ~5MB/origin, phù hợp
 *                 với thiết bị biên mô phỏng trong trình duyệt.
 *   IndexedDB:    Async, không giới hạn cứng (quota hệ thống), hỗ trợ
 *                 transaction atomicity, phù hợp với hàng đợi lớn hơn.
 *                 Đã được triển khai tại gateQueueStore.ts (P04/P05).
 */
