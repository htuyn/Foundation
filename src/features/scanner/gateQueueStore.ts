import { isValidLegacyQueueRecord, sortGateQueue, type GateTransaction } from './gateTransactionCore'

const DATABASE_NAME = 'foundation-gate-transactions'
const DATABASE_VERSION = 2
const TRANSACTION_STORE = 'transactions'
const META_STORE = 'meta'
const LEGACY_STORAGE_PREFIX = 'foundation-sv2-gate-transactions-v1'
let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase() {
  if (databasePromise) return databasePromise
  if (!globalThis.indexedDB) return Promise.reject(new Error('Trình duyệt không hỗ trợ IndexedDB; giao dịch chưa được lưu.'))
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = (event) => {
      const database = request.result
      const transactions = database.objectStoreNames.contains(TRANSACTION_STORE)
        ? request.transaction!.objectStore(TRANSACTION_STORE)
        : database.createObjectStore(TRANSACTION_STORE, { keyPath: 'idempotencyKey' })
      if (!transactions.indexNames.contains('byUser')) transactions.createIndex('byUser', 'userId')
      if (!transactions.indexNames.contains('byUserAndQueuedAt')) transactions.createIndex('byUserAndQueuedAt', ['userId', 'queuedAt'])
      if (!transactions.indexNames.contains('byUserAndQueueOrder')) transactions.createIndex('byUserAndQueueOrder', ['userId', 'queueOrder'])
      if (!transactions.indexNames.contains('byUserAndScanEvent')) transactions.createIndex('byUserAndScanEvent', ['userId', 'scanEventId'])
      if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE, { keyPath: 'key' })
      if ((event as IDBVersionChangeEvent).oldVersion < 2) {
        const cursorRequest = transactions.openCursor()
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) return
          const record = cursor.value as GateTransaction
          if (typeof record.queueOrder !== 'number') cursor.update({ ...record, queueOrder: record.queuedAt })
          cursor.continue()
        }
      }
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error('Không thể mở IndexedDB.'))
    request.onblocked = () => reject(new Error('IndexedDB đang bị tab khác chặn nâng cấp; hãy tải lại các tab scanner.'))
  }).catch((error) => {
    databasePromise = null
    throw error
  })
  return databasePromise
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction bị hủy.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction thất bại.'))
  })
}

async function migrateLegacyQueue(userId: string) {
  if (typeof localStorage === 'undefined') return
  const prefix = `${LEGACY_STORAGE_PREFIX}:${userId}:`
  const legacy: Array<{ key: string; transaction: GateTransaction }> = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key?.startsWith(prefix) || key.endsWith('sync-lease')) continue
    const raw = localStorage.getItem(key)
    let value: unknown
    try {
      value = JSON.parse(raw ?? 'null')
    } catch {
      throw new Error('Hàng đợi scanner cũ bị lỗi định dạng; dữ liệu được giữ nguyên để khôi phục.')
    }
    if (!isValidLegacyQueueRecord(value, userId)) throw new Error('Bản ghi scanner cũ không hợp lệ; dữ liệu được giữ nguyên để khôi phục.')
    legacy.push({ key, transaction: value })
  }

  const database = await openDatabase()
  const markerKey = `legacy-migrated:${userId}`
  const transaction = database.transaction([TRANSACTION_STORE, META_STORE], 'readwrite')
  const done = transactionDone(transaction)
  const meta = transaction.objectStore(META_STORE)
  const markerRequest = meta.get(markerKey)
  const sequenceKey = `queue-sequence:${userId}`
  const sequenceRequest = meta.get(sequenceKey)
  const existingQueueRequest = transaction.objectStore(TRANSACTION_STORE).index('byUser').getAll(userId)
  let migrated = false
  let alreadyMigrated = false
  let markerChecked = false
  let sequenceChecked = false
  let queueChecked = false
  const commitMigration = () => {
    if (!markerChecked || !sequenceChecked || !queueChecked) return
    if (markerRequest.result) {
      alreadyMigrated = true
      return
    }
    const store = transaction.objectStore(TRANSACTION_STORE)
    const existing = existingQueueRequest.result as GateTransaction[]
    let sequence = existing.reduce(
      (max, record) => Math.max(max, record.queueOrder ?? record.queuedAt),
      (sequenceRequest.result?.value as number | undefined) ?? 0,
    )
    for (const { transaction: record } of legacy.sort((left, right) => left.transaction.queuedAt - right.transaction.queuedAt)) {
      sequence += 1
      store.put({ ...record, queueOrder: sequence })
    }
    meta.put({ key: sequenceKey, value: sequence })
    meta.put({ key: markerKey, migratedAt: new Date().toISOString() })
    migrated = true
  }
  markerRequest.onsuccess = () => { markerChecked = true; commitMigration() }
  sequenceRequest.onsuccess = () => { sequenceChecked = true; commitMigration() }
  existingQueueRequest.onsuccess = () => { queueChecked = true; commitMigration() }
  await done
  if (migrated || alreadyMigrated) legacy.forEach(({ key }) => localStorage.removeItem(key))
}

export async function listGateTransactions(userId: string): Promise<GateTransaction[]> {
  await migrateLegacyQueue(userId)
  const database = await openDatabase()
  const transaction = database.transaction(TRANSACTION_STORE, 'readonly')
  const done = transactionDone(transaction)
  const request = transaction.objectStore(TRANSACTION_STORE).index('byUserAndQueueOrder').getAll(IDBKeyRange.bound([userId, 0], [userId, Number.MAX_SAFE_INTEGER]))
  const records = await new Promise<GateTransaction[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as GateTransaction[])
    request.onerror = () => reject(request.error ?? new Error('Không thể đọc hàng đợi scanner.'))
  })
  await done
  return sortGateQueue(records)
}

function sameScan(left: GateTransaction, right: GateTransaction) {
  return left.userId === right.userId
    && left.scanEventId === right.scanEventId
    && left.barcode === right.barcode
    && left.quantity === right.quantity
    && left.type === right.type
    && left.scanPoint === right.scanPoint
    && left.warehouseId === right.warehouseId
    && left.supplierId === right.supplierId
    && left.partner === right.partner
    && left.clientTimestamp === right.clientTimestamp
}

export async function persistGateTransaction(record: GateTransaction) {
  await migrateLegacyQueue(record.userId)
  const database = await openDatabase()
  const transaction = database.transaction(TRANSACTION_STORE, 'readwrite')
  const done = transactionDone(transaction)
  const store = transaction.objectStore(TRANSACTION_STORE)
  const meta = transaction.objectStore(META_STORE)
  const existingRequest = store.index('byUserAndScanEvent').getAll(IDBKeyRange.only([record.userId, record.scanEventId]))
  const sequenceKey = `queue-sequence:${record.userId}`
  const sequenceRequest = meta.get(sequenceKey)
  const queueRequest = store.index('byUserAndQueueOrder').getAll(IDBKeyRange.bound([record.userId, 0], [record.userId, Number.MAX_SAFE_INTEGER]))
  let duplicate = false
  let existingChecked = false
  let sequenceChecked = false
  let queueChecked = false
  const commitRecord = () => {
    if (!existingChecked || !sequenceChecked || !queueChecked) return
    const existing = existingRequest.result as GateTransaction[]
    if (existing.length) {
      if (!existing.some((item) => sameScan(item, record))) {
        transaction.abort()
        return
      }
      duplicate = true
      return
    }
    const queuedRecords = queueRequest.result as GateTransaction[]
    const maxQueueOrder = queuedRecords.reduce((max, item) => Math.max(max, item.queueOrder ?? item.queuedAt), 0)
    const sequence = Math.max((sequenceRequest.result?.value as number | undefined) ?? 0, maxQueueOrder) + 1
    meta.put({ key: sequenceKey, value: sequence })
    store.add({ ...record, queueOrder: sequence })
  }
  existingRequest.onsuccess = () => { existingChecked = true; commitRecord() }
  sequenceRequest.onsuccess = () => { sequenceChecked = true; commitRecord() }
  queueRequest.onsuccess = () => { queueChecked = true; commitRecord() }
  try {
    await done
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('scanEventId đã được dùng cho một giao dịch khác.')
    }
    throw error
  }
  return { inserted: !duplicate }
}

export async function updateGateTransaction(userId: string, idempotencyKey: string, change: (record: GateTransaction) => GateTransaction) {
  const database = await openDatabase()
  const transaction = database.transaction(TRANSACTION_STORE, 'readwrite')
  const done = transactionDone(transaction)
  const store = transaction.objectStore(TRANSACTION_STORE)
  const request = store.get(idempotencyKey)
  request.onsuccess = () => {
    const record = request.result as GateTransaction | undefined
    if (record?.userId === userId) store.put(change(record))
  }
  await done
}

interface SyncLease {
  key: string
  owner: string
  expiresAt: number
}

export async function claimSyncLease(userId: string, owner: string, now = Date.now(), ttlMs = 30000) {
  const database = await openDatabase()
  const transaction = database.transaction(META_STORE, 'readwrite')
  const done = transactionDone(transaction)
  const store = transaction.objectStore(META_STORE)
  const key = `sync-lease:${userId}`
  const request = store.get(key)
  let claimed = false
  request.onsuccess = () => {
    const current = request.result as SyncLease | undefined
    if (current && current.expiresAt > now && current.owner !== owner) return
    store.put({ key, owner, expiresAt: now + ttlMs })
    claimed = true
  }
  await done
  return claimed
}

export async function renewSyncLease(userId: string, owner: string, now = Date.now(), ttlMs = 30000) {
  const database = await openDatabase()
  const transaction = database.transaction(META_STORE, 'readwrite')
  const done = transactionDone(transaction)
  const store = transaction.objectStore(META_STORE)
  const key = `sync-lease:${userId}`
  const request = store.get(key)
  let renewed = false
  request.onsuccess = () => {
    const current = request.result as SyncLease | undefined
    if (current?.owner !== owner) return
    store.put({ key, owner, expiresAt: now + ttlMs })
    renewed = true
  }
  await done
  return renewed
}

export async function releaseSyncLease(userId: string, owner: string) {
  const database = await openDatabase()
  const transaction = database.transaction(META_STORE, 'readwrite')
  const done = transactionDone(transaction)
  const store = transaction.objectStore(META_STORE)
  const key = `sync-lease:${userId}`
  const request = store.get(key)
  request.onsuccess = () => {
    const current = request.result as SyncLease | undefined
    if (current?.owner === owner) store.delete(key)
  }
  await done
}

export async function estimateGateQueueStorage() {
  if (!navigator.storage?.estimate) return null
  const estimate = await navigator.storage.estimate()
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
}
