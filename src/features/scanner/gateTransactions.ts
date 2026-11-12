import { authenticatedRequest, checkApiConnectivity } from '../auth/authClient'
import {
  buildGateDocumentBody,
  createGateTransaction as createTransaction,
  nextFifoQueueItem,
  prepareGateTransactionRetry,
  syncWhenReachable,
  type GateTransaction,
  type GateDocumentBody,
  type NewGateTransaction,
} from './gateTransactionCore'
import {
  claimSyncLease,
  estimateGateQueueStorage,
  listGateTransactions as listStoredTransactions,
  persistGateTransaction as persistStoredTransaction,
  releaseSyncLease,
  renewSyncLease,
  updateGateTransaction,
} from './gateQueueStore'

export type { GateTransaction, GateTransactionStatus, ScanPoint } from './gateTransactionCore'

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]
const listeners = new Map<string, Set<() => void>>()
const syncPromises = new Map<string, Promise<void>>()
const retryTimers = new Map<string, number>()
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('foundation-gate-queue-v1')

function notify(userId: string, synchronize = false) {
  listeners.get(userId)?.forEach((listener) => listener())
  channel?.postMessage({ type: synchronize ? 'queue-enqueued' : 'queue-updated', userId })
}

channel?.addEventListener('message', (event: MessageEvent<{ type?: string; userId?: string }>) => {
  const { type, userId } = event.data ?? {}
  if (!userId) return
  listeners.get(userId)?.forEach((listener) => listener())
  if (type === 'queue-enqueued') void syncGateTransactions(userId).catch(() => undefined)
})

export function createGateTransaction(input: NewGateTransaction) {
  return createTransaction(input)
}

export async function listGateTransactions(userId: string) {
  return listStoredTransactions(userId)
}

export async function persistGateTransaction(transaction: GateTransaction) {
  const result = await persistStoredTransaction(transaction)
  notify(transaction.userId, true)
  return result
}

function publishStatus(userId: string) {
  notify(userId)
}

async function update(userId: string, key: string, change: (item: GateTransaction) => GateTransaction) {
  await updateGateTransaction(userId, key, change)
  publishStatus(userId)
}

function isTerminal(error: unknown) {
  const status = (error as { status?: number })?.status
  return status === 400 || status === 403 || status === 404 || status === 409 || status === 422
}

async function submit(transaction: GateTransaction, persistBody: (body: GateDocumentBody) => Promise<void>) {
  let document = transaction.documentBody
  if (!document) {
    const product = await authenticatedRequest<{ id: string; cost: number }>(
      `/products/lookup?barcode=${encodeURIComponent(transaction.barcode)}`,
      { signal: AbortSignal.timeout(15000) },
    )
    document = buildGateDocumentBody(transaction, product)
    await persistBody(document)
  }
  return authenticatedRequest<{ id: string; createdAt?: string }>('/documents', {
    method: 'POST',
    headers: { 'Idempotency-Key': transaction.idempotencyKey },
    body: JSON.stringify(document),
    signal: AbortSignal.timeout(15000),
  })
}

async function runQueue(userId: string, resumePausedAuth: boolean, lostLease: () => boolean) {
  const initial = await listStoredTransactions(userId)
  for (const item of initial) {
    if (item.status === 'SYNCING' || (resumePausedAuth && (item.status === 'AUTH_REQUIRED' || item.status === 'PAUSED_AUTH'))) {
      await update(userId, item.idempotencyKey, (current) => ({ ...current, status: 'PENDING', error: undefined }))
    }
  }

  while (!lostLease()) {
    const now = Date.now()
    const next = nextFifoQueueItem(await listStoredTransactions(userId), now)
    if (!next) break
    await update(userId, next.idempotencyKey, (current) => ({ ...current, status: 'SYNCING', error: undefined }))
    try {
      const current = (await listStoredTransactions(userId)).find((item) => item.idempotencyKey === next.idempotencyKey) ?? next
      const result = await submit(current, (documentBody) => update(userId, current.idempotencyKey, (item) => ({ ...item, documentBody })))
      await update(userId, current.idempotencyKey, (item) => ({
        ...item,
        status: 'SYNCED',
        documentId: result.id,
        ...(result.createdAt ? { serverTimestamp: result.createdAt } : {}),
        retryAt: undefined,
        error: undefined,
      }))
    } catch (error) {
      const status = (error as { status?: number })?.status
      const code = (error as { code?: string })?.code
      if (status === 401 || code === 'SESSION_EXPIRED' || code === 'INVALID_ACCESS_TOKEN') {
        await update(userId, next.idempotencyKey, (item) => ({
          ...item,
          status: 'PAUSED_AUTH',
          error: error instanceof Error ? error.message : 'Cần đăng nhập lại.',
        }))
        break
      }
      if (isTerminal(error)) {
        await update(userId, next.idempotencyKey, (item) => ({
          ...item,
          status: 'DEAD_LETTER',
          error: error instanceof Error ? error.message : 'Giao dịch bị từ chối.',
        }))
        continue
      }
      const attemptCount = next.attemptCount + 1
      if (attemptCount > RETRY_DELAYS_MS.length) {
        await update(userId, next.idempotencyKey, (item) => ({
          ...item,
          status: 'DEAD_LETTER',
          attemptCount,
          error: error instanceof Error ? error.message : 'Đã hết số lần thử lại.',
        }))
        continue
      }
      const jitter = Math.floor(Math.random() * Math.min(1000, RETRY_DELAYS_MS[attemptCount - 1] / 4))
      await update(userId, next.idempotencyKey, (item) => ({
        ...item,
        status: 'RETRY_WAIT',
        attemptCount,
        retryAt: Date.now() + RETRY_DELAYS_MS[attemptCount - 1] + jitter,
        error: error instanceof Error ? error.message : 'Lỗi mạng hoặc backend.',
      }))
    }
  }
  scheduleGateTransactionRetry(userId)
}

export async function syncGateTransactions(userId: string, resumePausedAuth = false) {
  const existing = syncPromises.get(userId)
  if (existing) return existing

  const task = (async () => {
    const connected = await syncWhenReachable(checkApiConnectivity, async () => {
      if (navigator.locks?.request) {
        await navigator.locks.request(`foundation-gate-sync:${userId}`, { mode: 'exclusive' }, async () => {
          await runQueue(userId, resumePausedAuth, () => false)
        })
        return
      }

      const owner = globalThis.crypto?.randomUUID?.()
      if (!owner) throw new Error('Không thể tạo khóa đồng bộ scanner an toàn.')
      if (!await claimSyncLease(userId, owner)) {
        window.clearTimeout(retryTimers.get(userId))
        retryTimers.set(userId, window.setTimeout(() => {
          void syncGateTransactions(userId).catch(() => undefined)
        }, 1000))
        return
      }
      let leaseLost = false
      const heartbeat = window.setInterval(() => {
        void renewSyncLease(userId, owner).then((renewed) => { if (!renewed) leaseLost = true }).catch(() => { leaseLost = true })
      }, 10000)
      try {
        await runQueue(userId, resumePausedAuth, () => leaseLost)
      } finally {
        window.clearInterval(heartbeat)
        await releaseSyncLease(userId, owner)
      }
    })
    if (!connected) {
      scheduleGateTransactionRetry(userId)
    }
  })().finally(() => { syncPromises.delete(userId) })
  syncPromises.set(userId, task)
  return task
}

export function subscribeGateTransactions(userId: string, listener: () => void) {
  const userListeners = listeners.get(userId) ?? new Set<() => void>()
  userListeners.add(listener)
  listeners.set(userId, userListeners)
  return () => {
    userListeners.delete(listener)
    if (!userListeners.size) listeners.delete(userId)
  }
}

export async function retryGateTransaction(userId: string, idempotencyKey: string) {
  await update(userId, idempotencyKey, prepareGateTransactionRetry)
  return syncGateTransactions(userId)
}

export async function getGateQueueStorageStatus() {
  try {
    return await estimateGateQueueStorage()
  } catch {
    return null
  }
}

export function startGateTransactionSync(userId: string) {
  const sync = (resumePausedAuth = false) => { void syncGateTransactions(userId, resumePausedAuth).catch(() => undefined) }
  const onOnline = () => sync()
  const onOffline = () => publishStatus(userId)
  const onVisible = () => { if (document.visibilityState === 'visible') sync() }
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisible)
  sync(true)
  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearTimeout(retryTimers.get(userId))
    retryTimers.delete(userId)
  }
}

function scheduleGateTransactionRetry(userId: string) {
  window.clearTimeout(retryTimers.get(userId))
  void listStoredTransactions(userId).then((items) => {
    const next = items.filter((item) => item.status === 'PENDING' || (item.status === 'RETRY_WAIT' && item.retryAt))
      .sort((left, right) => (left.retryAt ?? 0) - (right.retryAt ?? 0))[0]
    if (!next) return
    const nextAttemptAt = next.status === 'RETRY_WAIT' ? next.retryAt ?? Date.now() : Date.now() + 5000
    retryTimers.set(userId, window.setTimeout(() => {
      void syncGateTransactions(userId).catch(() => undefined)
    }, Math.max(0, nextAttemptAt - Date.now())))
  }).catch(() => undefined)
}
