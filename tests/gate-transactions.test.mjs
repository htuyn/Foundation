import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildGateDocumentBody,
  createGateTransaction,
  isManualDoubleClick,
  isValidLegacyQueueRecord,
  nextFifoQueueItem,
  persistBeforeSync,
  prepareGateTransactionRetry,
  sortGateQueue,
  syncWhenReachable,
  validateNewGateTransaction,
} from '../src/features/scanner/gateTransactionCore.ts'

const userId = 'be8a0907-fb73-4b67-9af0-12d8734e2160'
const warehouseId = '2a80521c-e82e-4b63-a168-a779e1bed6db'
const supplierId = 'e8d9d5a2-6332-4a72-b53f-f339d98a3201'
const eventId = 'b8db8a39-5f5e-4db4-a098-08b0664d6b52'
const key1 = 'f172455a-ec9b-4741-8d9d-27150c93da90'
const key2 = '9899ed19-ea23-4d54-8c48-a660ad28773d'

function validInbound(overrides = {}) {
  return {
    scanEventId: eventId,
    barcode: ' 0123456789012 ',
    quantity: 3,
    type: 'Nhập kho',
    scanPoint: 'GATE_A',
    clientTimestamp: '2026-11-12T09:15:00.000Z',
    warehouseId,
    supplierId,
    partner: 'Nhà cung cấp A',
    userId,
    ...overrides,
  }
}

test('transaction có UUID v4 key riêng với event ID và barcode', () => {
  const transaction = createGateTransaction(validInbound(), () => key1)
  assert.equal(transaction.idempotencyKey, key1)
  assert.notEqual(transaction.idempotencyKey, transaction.scanEventId)
  assert.notEqual(transaction.idempotencyKey, transaction.barcode)
  assert.match(transaction.idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  assert.equal(transaction.status, 'PENDING')
  assert.throws(() => createGateTransaction(validInbound({ scanEventId: key1 }), () => key1), /key riêng/)
})

test('validation từ chối quantity, gate/type, user, barcode và timestamp sai', () => {
  assert.throws(() => validateNewGateTransaction(validInbound({ quantity: 0 })), /Số lượng/)
  assert.throws(() => validateNewGateTransaction(validInbound({ quantity: 1.5 })), /Số lượng/)
  assert.throws(() => validateNewGateTransaction(validInbound({ type: 'Xuất kho' })), /không khớp/)
  assert.throws(() => validateNewGateTransaction(validInbound({ userId: 'demo-admin' })), /user ID/)
  assert.throws(() => validateNewGateTransaction(validInbound({ barcode: ' '.repeat(2) })), /Barcode/)
  assert.throws(() => validateNewGateTransaction(validInbound({ barcode: 'x'.repeat(161) })), /Barcode/)
  assert.throws(() => validateNewGateTransaction(validInbound({ clientTimestamp: '2026-11-12T09:15:00' })), /timezone/)
  assert.throws(() => validateNewGateTransaction(validInbound({ supplierId: undefined })), /nhà cung cấp/)
  assert.throws(() => validateNewGateTransaction(validInbound({ scanEventId: 'not-a-uuid' })), /scanEventId/)
})

test('mỗi lần scan cùng barcode tạo transaction và idempotency key mới', () => {
  const first = createGateTransaction(validInbound(), () => key1)
  const second = createGateTransaction(validInbound({ scanEventId: key2 }), () => eventId)
  assert.equal(first.barcode, second.barcode)
  assert.notEqual(first.idempotencyKey, second.idempotencyKey)
  assert.notEqual(first.scanEventId, second.scanEventId)
})

test('Gate A tạo IN và Gate B tạo OUT với API fields hiện có', () => {
  const inbound = createGateTransaction(validInbound(), () => key1)
  const outbound = createGateTransaction(validInbound({
    scanEventId: key2,
    type: 'Xuất kho',
    scanPoint: 'GATE_B',
    supplierId: undefined,
    partner: 'SO-2026-10',
  }), () => eventId)
  const inboundBody = buildGateDocumentBody(inbound, { id: 'product-1', cost: 1250 })
  const outboundBody = buildGateDocumentBody(outbound, { id: 'product-2', cost: 500 })
  assert.equal(inboundBody.type, 'Nhập kho')
  assert.equal(inboundBody.scanPoint, 'GATE_A')
  assert.equal(inboundBody.supplierId, supplierId)
  assert.deepEqual(inboundBody.lines, [{ productId: 'product-1', quantity: 3, unitCost: 1250 }])
  assert.equal('barcode' in inboundBody, false)
  assert.equal(outboundBody.type, 'Xuất kho')
  assert.equal(outboundBody.scanPoint, 'GATE_B')
  assert.equal(outboundBody.partner, 'SO-2026-10')
  assert.equal('supplierId' in outboundBody, false)
})

test('persist phải resolve trước khi gọi sync; lỗi persistence không gửi API', async () => {
  const order = []
  await persistBeforeSync({ idempotencyKey: key1 }, async () => { order.push('persisted') }, async () => { order.push('sync') })
  assert.deepEqual(order, ['persisted', 'sync'])

  let sent = false
  await assert.rejects(
    persistBeforeSync({ idempotencyKey: key2 }, async () => { throw new Error('QuotaExceededError') }, async () => { sent = true }),
    /QuotaExceededError/,
  )
  assert.equal(sent, false)

})

test('retry giữ nguyên idempotency key và body đã đóng băng', () => {
  const transaction = {
    ...createGateTransaction(validInbound(), () => key1),
    status: 'RETRY_WAIT',
    retryAt: Date.now() + 1000,
    documentBody: buildGateDocumentBody(createGateTransaction(validInbound(), () => key2), { id: 'product-1', cost: 1250 }),
  }
  const retried = prepareGateTransactionRetry(transaction)
  assert.equal(retried.idempotencyKey, transaction.idempotencyKey)
  assert.deepEqual(retried.documentBody, transaction.documentBody)
  assert.equal(retried.status, 'PENDING')
  assert.equal(retried.retryAt, undefined)
})

test('double-click cùng thao tác bị chặn nhưng scan mới sau ngưỡng được nhận', () => {
  assert.equal(isManualDoubleClick(1000, 1200), true)
  assert.equal(isManualDoubleClick(1000, 1500), false)
})

test('queue ordering FIFO ổn định kể cả nhiều scan trong cùng millisecond', () => {
  const queued = [
    { idempotencyKey: key2, queuedAt: 1000, queueOrder: 2 },
    { idempotencyKey: key1, queuedAt: 1000, queueOrder: 1 },
    { idempotencyKey: eventId, queuedAt: 1001, queueOrder: 3 },
  ]
  assert.deepEqual(sortGateQueue(queued).map((item) => item.idempotencyKey), [key1, key2, eventId])
  assert.deepEqual(sortGateQueue(queued).map((item) => item.idempotencyKey), [key1, key2, eventId])
})

test('FIFO không bỏ qua transaction đầu đang chờ retry hoặc yêu cầu đăng nhập', () => {
  const queue = [
    { idempotencyKey: key1, status: 'RETRY_WAIT', retryAt: 5000 },
    { idempotencyKey: key2, status: 'PENDING' },
  ]
  assert.equal(nextFifoQueueItem(queue, 4000), null)
  assert.equal(nextFifoQueueItem(queue, 5000).idempotencyKey, key1)
  assert.equal(nextFifoQueueItem([{ ...queue[0], status: 'PAUSED_AUTH' }, queue[1]], 6000), null)
})

test('legacy migration validation giữ nguyên record hợp lệ và từ chối record hỏng', () => {
  const legacy = {
    ...createGateTransaction(validInbound(), () => key1),
    status: 'RETRY_WAIT',
    attemptCount: 1,
  }
  assert.equal(isValidLegacyQueueRecord(legacy, userId), true)
  assert.equal(isValidLegacyQueueRecord({ ...legacy, quantity: 0 }, userId), false)
  assert.equal(isValidLegacyQueueRecord({ ...legacy, idempotencyKey: 'bad' }, userId), false)
  assert.equal(isValidLegacyQueueRecord(legacy, key2), false)
})

test('offline check không chạy drain; API reconnect chạy lại drain', async () => {
  const runs = []
  const reachable = async () => false
  const first = await syncWhenReachable(reachable, async () => { runs.push('drain') })
  assert.equal(first, false)
  assert.deepEqual(runs, [])

  const reconnected = await syncWhenReachable(async () => true, async () => { runs.push('drain') })
  assert.equal(reconnected, true)
  assert.deepEqual(runs, ['drain'])
})
