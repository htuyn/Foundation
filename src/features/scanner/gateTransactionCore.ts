export type ScanPoint = 'GATE_A' | 'GATE_B'
export type GateDocumentType = 'Nhập kho' | 'Xuất kho'
export type GateTransactionStatus = 'PENDING' | 'SYNCING' | 'RETRY_WAIT' | 'SYNCED' | 'PAUSED_AUTH' | 'AUTH_REQUIRED' | 'DEAD_LETTER'

export interface GateDocumentBody {
  type: GateDocumentType
  warehouseId: string
  scanPoint: ScanPoint
  scanEventId: string
  clientTimestamp: string
  supplierId?: string
  partner: string
  note: string
  lines: Array<{ productId: string; quantity: number; unitCost: number }>
}

export interface GateTransaction {
  idempotencyKey: string
  scanEventId: string
  barcode: string
  quantity: number
  type: GateDocumentType
  scanPoint: ScanPoint
  clientTimestamp: string
  serverTimestamp?: string
  queuedAt: number
  queueOrder?: number
  warehouseId: string
  supplierId?: string
  partner: string
  userId: string
  status: GateTransactionStatus
  attemptCount: number
  retryAt?: number
  documentId?: string
  error?: string
  documentBody?: GateDocumentBody
}

export interface NewGateTransaction {
  scanEventId: string
  barcode: string
  quantity: number
  type: GateDocumentType
  scanPoint: ScanPoint
  clientTimestamp: string
  warehouseId: string
  supplierId?: string
  partner: string
  userId: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function validateNewGateTransaction(input: NewGateTransaction) {
  if (!UUID_PATTERN.test(input.scanEventId)) throw new Error('scanEventId phải là UUID hợp lệ.')
  if (!input.barcode.trim() || input.barcode.trim().length > 160) throw new Error('Barcode phải có từ 1 đến 160 ký tự.')
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new Error('Số lượng phải là số nguyên lớn hơn 0.')
  if ((input.scanPoint === 'GATE_A') !== (input.type === 'Nhập kho')) throw new Error('Điểm quét không khớp loại phiếu.')
  if (!input.warehouseId.trim()) throw new Error('Hãy chọn kho trước khi quét.')
  if (!UUID_V4_PATTERN.test(input.userId)) throw new Error('Không tìm thấy user ID hợp lệ đã xác thực.')
  if (!Number.isFinite(Date.parse(input.clientTimestamp)) || !/(Z|[+-]\d{2}:\d{2})$/i.test(input.clientTimestamp)) {
    throw new Error('clientTimestamp phải là ISO 8601 có timezone.')
  }
  if (input.type === 'Nhập kho' && !input.supplierId?.trim()) throw new Error('Hãy chọn nhà cung cấp.')
  if (input.type === 'Xuất kho' && !input.partner.trim()) throw new Error('Hãy nhập người nhận hoặc mã đơn hàng.')
}

export function createGateTransaction(input: NewGateTransaction, randomUUID?: () => string) {
  validateNewGateTransaction(input)
  const makeUUID = randomUUID ?? globalThis.crypto?.randomUUID?.bind(globalThis.crypto)
  if (!makeUUID) {
    throw new Error('Thiết bị không hỗ trợ UUID v4 an toàn; giao dịch chưa được tạo.')
  }
  const idempotencyKey = makeUUID()
  if (!UUID_V4_PATTERN.test(idempotencyKey) || idempotencyKey === input.scanEventId) {
    throw new Error('Không thể tạo UUID v4 idempotency key riêng cho giao dịch.')
  }
  return {
    ...input,
    barcode: input.barcode.trim(),
    partner: input.partner.trim(),
    queuedAt: Date.now(),
    idempotencyKey,
    status: 'PENDING' as const,
    attemptCount: 0,
  }
}

export function buildGateDocumentBody(transaction: GateTransaction, product: { id: string; cost: number }): GateDocumentBody {
  return {
    type: transaction.type,
    warehouseId: transaction.warehouseId,
    scanPoint: transaction.scanPoint,
    scanEventId: transaction.scanEventId,
    clientTimestamp: transaction.clientTimestamp,
    ...(transaction.supplierId ? { supplierId: transaction.supplierId } : {}),
    partner: transaction.partner,
    note: `Tạo từ scanner ${transaction.scanPoint}`,
    lines: [{ productId: product.id, quantity: transaction.quantity, unitCost: product.cost }],
  }
}

export async function persistBeforeSync<T>(transaction: T, persist: (transaction: T) => Promise<void>, sync: () => Promise<void>) {
  await persist(transaction)
  await sync()
}

export function isManualDoubleClick(lastAcceptedAt: number, now: number, windowMs = 500) {
  return now - lastAcceptedAt >= 0 && now - lastAcceptedAt < windowMs
}

export function prepareGateTransactionRetry(transaction: GateTransaction): GateTransaction {
  return { ...transaction, status: 'PENDING', retryAt: undefined, error: undefined }
}

export function sortGateQueue<T extends { queuedAt: number; queueOrder?: number; idempotencyKey: string }>(items: T[]) {
  return [...items].sort((left, right) =>
    (left.queueOrder ?? left.queuedAt) - (right.queueOrder ?? right.queuedAt)
    || left.queuedAt - right.queuedAt
    || left.idempotencyKey.localeCompare(right.idempotencyKey),
  )
}

export function nextFifoQueueItem<T extends { status: string; retryAt?: number }>(items: T[], now: number) {
  const head = items.find((item) => !['SYNCED', 'DEAD_LETTER'].includes(item.status))
  if (!head || head.status === 'PAUSED_AUTH' || head.status === 'AUTH_REQUIRED') return null
  if (head.status === 'RETRY_WAIT' && (head.retryAt ?? 0) > now) return null
  return head.status === 'PENDING' || head.status === 'RETRY_WAIT' ? head : null
}

export function isValidLegacyQueueRecord(value: unknown, userId: string): value is GateTransaction {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<GateTransaction>
  return record.userId === userId
    && typeof record.idempotencyKey === 'string'
    && UUID_V4_PATTERN.test(record.idempotencyKey)
    && typeof record.scanEventId === 'string'
    && UUID_PATTERN.test(record.scanEventId)
    && typeof record.barcode === 'string'
    && record.barcode.trim().length > 0
    && Number.isInteger(record.quantity)
    && (record.quantity ?? 0) > 0
    && typeof record.queuedAt === 'number'
    && Number.isFinite(record.queuedAt)
    && ['PENDING', 'SYNCING', 'RETRY_WAIT', 'SYNCED', 'AUTH_REQUIRED', 'PAUSED_AUTH', 'DEAD_LETTER'].includes(record.status ?? '')
}

export async function syncWhenReachable(checkConnectivity: () => Promise<boolean>, sync: () => Promise<void>) {
  if (!await checkConnectivity()) return false
  await sync()
  return true
}
