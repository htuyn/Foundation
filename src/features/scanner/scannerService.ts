import type { ScanEvent, ScanEventService, ScannerQrTicket, ScannerSession, ScannerSessionService, ScannerSessionStatus } from './types'

const sessions = new Map<string, ScannerSession>()
const ownerTokens = new Map<string, string>()
const deviceTokens = new Map<string, string>()
const pendingJoins = new Map<string, Promise<{ joined: boolean; message: string }>>()
const deviceSockets = new Map<string, WebSocket>()
const pendingDeviceEvents = new Map<string, Map<string, { resolve: (result: { delivered: boolean; duplicate: boolean }) => void; reject: (error: Error) => void; timer: number }>>()
const createId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') ?? ''
const apiBaseUrl = (() => {
  if (!configuredApiBaseUrl) return ''
  try {
    const configured = new URL(configuredApiBaseUrl, window.location.origin)
    const localApi = ['localhost', '127.0.0.1', '::1'].includes(configured.hostname)
    const localPage = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
    if (configured.origin !== window.location.origin && localApi && !localPage) {
      return `${window.location.origin}${configured.pathname.replace(/\/$/, '')}`
    }
    return configured.href.replace(/\/$/, '')
  } catch {
    return configuredApiBaseUrl
  }
})()
export const scannerMode: 'demo' | 'api' = apiBaseUrl ? 'api' : 'demo'

function scannerWebSocketUrl(sessionId: string, device: boolean) {
  const base = new URL(apiBaseUrl, window.location.origin)
  base.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  base.pathname = `${base.pathname.replace(/\/$/, '')}/ws/scanner/sessions/${sessionId}${device ? '/device' : ''}`
  base.search = ''
  return base
}

export class ScannerApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
    this.name = 'ScannerApiError'
  }
}

async function apiRequest<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new Error('Không thể kết nối backend scanner. Hãy kiểm tra API và mạng.')
  }
  const result = response.status === 204 ? undefined : await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = result?.error?.message ?? 'Không thể kết nối backend scanner.'
    throw new ScannerApiError(message, response.status, result?.error?.code)
  }
  return result as T
}

function mapApiSession(raw: Record<string, unknown>): ScannerSession {
  return {
    sessionId: String(raw.sessionId),
    status: raw.status as ScannerSession['status'],
    mode: 'api',
    createdAt: String(raw.createdAt),
    expiresAt: String(raw.expiresAt),
    deviceName: typeof raw.deviceName === 'string' ? raw.deviceName : undefined,
    connectedAt: typeof raw.connectedAt === 'string' ? raw.connectedAt : undefined,
  }
}

export const scannerApiContract = {
  createSession: 'POST /api/v1/scanner/sessions',
  refreshQr: 'POST /api/v1/scanner/sessions/{sessionId}/qr',
  joinSession: 'POST /api/v1/scanner/sessions/{sessionId}/join',
  getSession: 'GET /api/v1/scanner/sessions/{sessionId}',
  sendScan: 'POST /api/v1/scanner/sessions/{sessionId}/scans',
  closeSession: 'POST /api/v1/scanner/sessions/{sessionId}/close',
  leaveSession: 'POST /api/v1/scanner/sessions/{sessionId}/leave',
  subscribe: 'WS /api/v1/ws/scanner/sessions/{sessionId}',
} as const

export const scannerSessionService: ScannerSessionService = {
  async createSession() {
    if (scannerMode === 'api') {
      const raw = await apiRequest<Record<string, unknown>>('/scanner/sessions', { method: 'POST' })
      const session = mapApiSession(raw)
      if (typeof raw.ownerToken === 'string') ownerTokens.set(session.sessionId, raw.ownerToken)
      sessions.set(session.sessionId, session)
      return session
    }
    const now = new Date()
    const sessionId = `demo-${createId()}`
    const session: ScannerSession = {
      sessionId,
      status: 'waiting_for_device',
      mode: 'demo',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    }
    sessions.set(sessionId, session)
    return session
  },
  async refreshQr(sessionId, baseUrl) {
    if (scannerMode === 'api') {
      const ownerToken = ownerTokens.get(sessionId)
      if (!ownerToken) throw new Error('Không còn quyền làm mới QR; hãy tạo phiên mới.')
      const raw = await apiRequest<{ nonce: string; expiresAt: string }>(`/scanner/sessions/${sessionId}/qr`, { method: 'POST' }, ownerToken)
      const session = sessions.get(sessionId) ?? await this.getSession(sessionId)
      const mobileUrl = new URL('/scanner/mobile', baseUrl)
      mobileUrl.searchParams.set('mode', 'api')
      mobileUrl.searchParams.set('sessionId', sessionId)
      mobileUrl.searchParams.set('expiresAt', String(new Date(session.expiresAt).getTime()))
      mobileUrl.hash = new URLSearchParams({ qrNonce: raw.nonce, qrExpiresAt: String(new Date(raw.expiresAt).getTime()) }).toString()
      return { nonce: raw.nonce, expiresAt: raw.expiresAt, mobileUrl: mobileUrl.toString() }
    }
    const session = await this.getSession(sessionId)
    if (session.status === 'ended' || session.status === 'expired') throw new Error('Phiên đã kết thúc hoặc hết hạn; hãy tạo phiên mới.')
    const nonce = createId()
    const expiresAt = new Date(Date.now() + 5000).toISOString()
    const mobileUrl = new URL('/scanner/mobile', baseUrl)
    mobileUrl.searchParams.set('mode', 'demo')
    mobileUrl.searchParams.set('sessionId', sessionId)
    mobileUrl.searchParams.set('expiresAt', String(new Date(session.expiresAt).getTime()))
    mobileUrl.hash = new URLSearchParams({ qrNonce: nonce, qrExpiresAt: String(new Date(expiresAt).getTime()) }).toString()
    const ticket: ScannerQrTicket = { nonce, expiresAt, mobileUrl: mobileUrl.toString() }
    return ticket
  },
  async getSession(sessionId) {
    if (scannerMode === 'api') {
      const ownerToken = ownerTokens.get(sessionId)
      if (!ownerToken) throw new Error('Không còn quyền xác minh phiên scanner; hãy tạo phiên mới.')
      const raw = await apiRequest<Record<string, unknown>>(`/scanner/sessions/${sessionId}`, {}, ownerToken)
      const session = mapApiSession(raw)
      sessions.set(sessionId, session)
      return session
    }
    const session = sessions.get(sessionId)
    if (!session) throw new Error('Không thể xác minh phiên: backend chưa được tích hợp.')
    if (Date.now() >= new Date(session.expiresAt).getTime() && session.status !== 'ended') {
      const expired = { ...session, status: 'expired' as const }
      sessions.set(sessionId, expired)
      return expired
    }
    return session
  },
  async joinSession(sessionId, deviceName, qrNonce) {
    if (scannerMode === 'api') {
      const pending = pendingJoins.get(sessionId)
      if (pending) return pending
      const request = apiRequest<{ joined: boolean; message: string; deviceToken?: string }>(
        `/scanner/sessions/${sessionId}/join`,
        { method: 'POST', body: JSON.stringify({ qrNonce, deviceName }) },
      ).then((raw) => {
        if (raw.deviceToken) deviceTokens.set(sessionId, raw.deviceToken)
        return { joined: raw.joined, message: raw.message }
      })
      pendingJoins.set(sessionId, request)
      try { return await request } finally { pendingJoins.delete(sessionId) }
    }
    return { joined: false, message: 'Chế độ DEMO không có backend để xác thực hoặc xác nhận điện thoại đã tham gia.' }
  },
  async closeSession(sessionId) {
    if (scannerMode === 'api') {
      const ownerToken = ownerTokens.get(sessionId)
      if (!ownerToken) throw new Error('Không còn quyền kết thúc phiên scanner.')
      const raw = await apiRequest<Record<string, unknown>>(`/scanner/sessions/${sessionId}/close`, { method: 'POST' }, ownerToken)
      const session = mapApiSession(raw)
      sessions.set(sessionId, session)
      return session
    }
    const session = await this.getSession(sessionId)
    const ended = { ...session, status: 'ended' as const }
    sessions.set(sessionId, ended)
    return ended
  },
  async leaveSession(sessionId) {
    if (scannerMode === 'api') {
      const deviceToken = deviceTokens.get(sessionId)
      if (!deviceToken) throw new Error('Thiết bị không còn quyền kết thúc phiên scanner.')
      const raw = await apiRequest<Record<string, unknown>>(`/scanner/sessions/${sessionId}/leave`, { method: 'POST' }, deviceToken)
      deviceTokens.delete(sessionId)
      return mapApiSession(raw)
    }
    const session = await this.getSession(sessionId)
    const ended = { ...session, status: 'ended' as const }
    sessions.set(sessionId, ended)
    return ended
  },
  connectDevice(sessionId, onStatus) {
    if (scannerMode !== 'api') return () => undefined
    const deviceToken = deviceTokens.get(sessionId)
    if (!deviceToken) {
      onStatus('ended')
      return () => undefined
    }
    let stopped = false
    let socket: WebSocket | undefined
    let reconnectTimer: number | undefined
    let heartbeatTimer: number | undefined
    let stableTimer: number | undefined
    let retryDelay = 1000
    let reconnectAttempts = 0
    let connecting = false
    let terminalStatus: ScannerSessionStatus | undefined
    const connect = () => {
      if (stopped || connecting || (socket && socket.readyState <= WebSocket.OPEN)) return
      connecting = true
      const wsUrl = scannerWebSocketUrl(sessionId, true)
      try {
        socket = new WebSocket(wsUrl, ['scanner.device.v1', deviceToken])
      } catch {
        connecting = false
        scheduleReconnect()
        return
      }
      const activeSocket = socket
      activeSocket.onopen = () => {
        connecting = false
        window.clearTimeout(stableTimer)
        stableTimer = window.setTimeout(() => {
          reconnectAttempts = 0
          retryDelay = 1000
        }, 30000)
        deviceSockets.set(sessionId, activeSocket)
        onStatus('connected')
        window.clearInterval(heartbeatTimer)
        heartbeatTimer = window.setInterval(() => {
          if (activeSocket.readyState === WebSocket.OPEN) activeSocket.send('ping')
        }, 20000)
      }
      activeSocket.onmessage = (message) => {
        try {
          const payload = JSON.parse(message.data) as { type?: string; status?: ScannerSessionStatus }
          if (payload.type === 'scan_ack' && 'eventId' in payload) {
            const pending = pendingDeviceEvents.get(sessionId)?.get(String(payload.eventId))
            if (pending) {
              window.clearTimeout(pending.timer)
              pendingDeviceEvents.get(sessionId)?.delete(String(payload.eventId))
              if ('error' in payload) pending.reject(new ScannerApiError(String((payload as { error: string }).error), Number((payload as { status?: number }).status ?? 400), String((payload as { code?: string }).code ?? 'SCANNER_EVENT_REJECTED')))
              else pending.resolve({ delivered: Boolean((payload as { delivered?: boolean }).delivered), duplicate: Boolean((payload as { duplicate?: boolean }).duplicate) })
            }
            return
          }
          if (payload.type === 'session_status' && payload.status) {
            terminalStatus = payload.status === 'ended' || payload.status === 'expired' ? payload.status : terminalStatus
            onStatus(payload.status)
            if (terminalStatus) activeSocket.close(4410, 'Scanner session closed')
          }
        } catch {
          onStatus('disconnected')
        }
      }
      activeSocket.onclose = (event) => {
        connecting = false
        window.clearTimeout(stableTimer)
        if (deviceSockets.get(sessionId) === activeSocket) deviceSockets.delete(sessionId)
        window.clearInterval(heartbeatTimer)
        if (stopped) return
        if (terminalStatus || event.code === 4410 || event.code === 4403) {
          onStatus(terminalStatus ?? 'ended')
          stopped = true
          return
        }
        onStatus('disconnected')
        scheduleReconnect()
      }
    }
    const scheduleReconnect = () => {
      if (stopped || reconnectTimer !== undefined) return
      reconnectAttempts += 1
      if (reconnectAttempts > 8) {
        onStatus('retry_exhausted')
        return
      }
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined
        retryDelay = Math.min(retryDelay * 2, 15000)
        connect()
      }, retryDelay)
    }
    connect()
    return () => {
      stopped = true
      window.clearTimeout(reconnectTimer)
      window.clearTimeout(stableTimer)
      window.clearInterval(heartbeatTimer)
      if (socket && deviceSockets.get(sessionId) === socket) deviceSockets.delete(sessionId)
      for (const pending of pendingDeviceEvents.get(sessionId)?.values() ?? []) {
        window.clearTimeout(pending.timer)
        pending.reject(new Error('Kết nối đã đóng trước khi xác nhận sự kiện. Có thể thử lại cùng eventId sau khi kết nối lại.'))
      }
      pendingDeviceEvents.delete(sessionId)
      socket?.close()
    }
  },
}

export const scanEventService: ScanEventService = {
  async sendFromMobile(event: ScanEvent) {
    if (scannerMode === 'api') {
      const socket = deviceSockets.get(event.sessionId)
      if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('Điện thoại đang mất kết nối scanner. Sự kiện chưa được xác nhận; kết nối lại rồi gửi lại cùng eventId.')
      const pendingByEvent = pendingDeviceEvents.get(event.sessionId) ?? new Map()
      if (pendingByEvent.has(event.eventId)) throw new Error('Sự kiện này đang chờ backend xác nhận.')
      pendingDeviceEvents.set(event.sessionId, pendingByEvent)
      return new Promise<{ delivered: boolean; duplicate: boolean }>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pendingByEvent.delete(event.eventId)
          reject(new Error('Backend chưa xác nhận sự kiện trong thời gian chờ. Có thể thử lại cùng eventId.'))
        }, 12000)
        pendingByEvent.set(event.eventId, { resolve, reject, timer })
        try {
          socket.send(JSON.stringify({ type: 'scan', event }))
        } catch {
          window.clearTimeout(timer)
          pendingByEvent.delete(event.eventId)
          reject(new Error('Không thể gửi scan qua WebSocket. Sự kiện chưa được xác nhận.'))
        }
      }).then((result) => ({
        delivered: result.delivered,
        message: result.duplicate ? 'Backend đã nhận sự kiện trước đó; không cộng lặp.' : 'Đã gửi sự kiện tới backend qua WebSocket.',
      }))
    }
    return { delivered: false, message: 'Chưa gửi: backend/WebSocket chưa được tích hợp. Sự kiện vẫn được giữ trên thiết bị.' }
  },
  subscribe(sessionId, listener, onError, onSessionStatus, onTransportState) {
    if (scannerMode === 'api') {
      let stopped = false
      let socket: WebSocket | undefined
      let reconnectTimer: number | undefined
      let heartbeatTimer: number | undefined
      let stableTimer: number | undefined
      let retryDelay = 1000
      let reconnectAttempts = 0
      let connecting = false
      const seenEventIds = new Set<string>()
      const ownerToken = ownerTokens.get(sessionId)
      if (!ownerToken) {
        onError?.('Không còn quyền theo dõi phiên scanner; hãy tạo phiên mới.')
        return () => undefined
      }
      const receive = (event: ScanEvent) => {
        if (seenEventIds.has(event.eventId)) return
        seenEventIds.add(event.eventId)
        listener(event)
      }
      const syncSession = async () => {
        const [events, rawSession] = await Promise.all([
          apiRequest<ScanEvent[]>(`/scanner/sessions/${sessionId}/scans`, {}, ownerToken),
          apiRequest<Record<string, unknown>>(`/scanner/sessions/${sessionId}`, {}, ownerToken),
        ])
        if (stopped) return
        events.forEach(receive)
        const nextStatus = rawSession.status
        if (nextStatus === 'waiting_for_device' || nextStatus === 'connected' || nextStatus === 'ended' || nextStatus === 'expired') {
          onSessionStatus?.(nextStatus as ScannerSessionStatus)
        }
        if (nextStatus === 'ended' || nextStatus === 'expired') {
          stopped = true
          onTransportState?.(false)
          return false
        }
        return true
      }
      const connect = async () => {
        if (stopped || connecting || (socket && socket.readyState <= WebSocket.OPEN)) return
        connecting = true
        try {
          const initial = await apiRequest<ScanEvent[]>(`/scanner/sessions/${sessionId}/scans`, {}, ownerToken)
          if (stopped) { connecting = false; return }
          initial.forEach(receive)
          const wsUrl = scannerWebSocketUrl(sessionId, false)
          socket = new WebSocket(wsUrl, ['scanner.v1', ownerToken])
          const activeSocket = socket
          activeSocket.onopen = () => {
            connecting = false
            window.clearTimeout(stableTimer)
            stableTimer = window.setTimeout(() => {
              reconnectAttempts = 0
              retryDelay = 1000
            }, 30000)
            onTransportState?.(true)
            window.clearInterval(heartbeatTimer)
            heartbeatTimer = window.setInterval(() => {
              if (activeSocket.readyState === WebSocket.OPEN) activeSocket.send('ping')
            }, 20000)
            void syncSession().catch((error) => onError?.(error instanceof Error ? error.message : 'Không thể đồng bộ phiên scanner.'))
          }
          socket.onmessage = (message) => {
            try {
              const payload = JSON.parse(message.data) as ScanEvent | { type: string; status?: ScannerSessionStatus }
              if ('type' in payload && payload.type === 'session_status' && payload.status) {
                onSessionStatus?.(payload.status)
                if (payload.status === 'connected') void syncSession().catch((error) => onError?.(error instanceof Error ? error.message : 'Không thể đồng bộ phiên scanner.'))
              }
              else if ('eventId' in payload && 'sessionId' in payload && 'barcode' in payload) receive(payload)
              else onError?.('Nhận được sự kiện scanner không hợp lệ.')
            } catch { onError?.('Nhận được sự kiện scanner không hợp lệ.') }
          }
          socket.onerror = () => onTransportState?.(false)
          socket.onclose = () => {
            connecting = false
            window.clearTimeout(stableTimer)
            window.clearInterval(heartbeatTimer)
            if (stopped || socket !== activeSocket) return
            onTransportState?.(false)
            void syncSession().then((active) => { if (active) scheduleReconnect() }).catch((error) => {
              if (error instanceof ScannerApiError && [403, 404, 410].includes(error.status)) {
                stopped = true
                onError?.(error.message)
                return
              }
              scheduleReconnect()
              onError?.(error instanceof Error ? error.message : 'Không thể xác minh phiên scanner.')
            })
          }
        } catch (error) {
          connecting = false
          if (stopped) return
          onTransportState?.(false)
          if (error instanceof ScannerApiError && [403, 404, 410].includes(error.status)) {
            stopped = true
            onError?.(error.message)
            return
          }
          scheduleReconnect()
          onError?.(error instanceof Error ? error.message : 'Không thể kết nối scanner.')
        }
      }
      const scheduleReconnect = () => {
        if (stopped || reconnectTimer !== undefined) return
        reconnectAttempts += 1
        if (reconnectAttempts > 8) {
          onTransportState?.(false)
          onError?.('Đã dừng thử kết nối WebSocket sau 8 lần. Kiểm tra URL/backend rồi tạo phiên mới để thử lại.')
          return
        }
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = undefined
          retryDelay = Math.min(retryDelay * 2, 15000)
          void connect()
        }, retryDelay)
      }
      void connect()
      return () => {
        stopped = true
        window.clearTimeout(reconnectTimer)
        window.clearTimeout(stableTimer)
        window.clearInterval(heartbeatTimer)
        socket?.close()
      }
    }
    onError?.('Scanner từ xa cần backend API; không có đồng bộ trong chế độ demo.')
    return () => undefined
  },
}

export function isValidDemoSessionId(sessionId: string) {
  return /^demo-[\w-]{8,80}$/.test(sessionId)
}

export function isValidDemoQrNonce(nonce: string) {
  return /^[\w-]{16,100}$/.test(nonce)
}
