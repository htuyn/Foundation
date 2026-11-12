import type { UserRecord } from '../../types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') ?? ''
let accessToken = ''
let csrfToken = ''
let refreshHandler: (() => Promise<boolean>) | null = null
let refreshPromise: Promise<boolean> | null = null

export interface AuthResponse {
  accessToken: string
  csrfToken: string
  user: UserRecord
}

export function setAccessToken(token: string) {
  accessToken = token
}

export function setCsrfToken(token: string) {
  csrfToken = token
}

export function getCsrfToken() {
  return csrfToken
}

export function registerRefreshHandler(handler: (() => Promise<boolean>) | null) {
  refreshHandler = handler
}

async function request<T>(path: string, init: RequestInit, retry: boolean): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, credentials: 'include' })
  if (response.status === 401 && retry && refreshHandler && !path.startsWith('/auth/')) {
    refreshPromise ??= refreshHandler().finally(() => { refreshPromise = null })
    if (await refreshPromise) return request<T>(path, init, false)
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined)
    const error = new Error(payload?.error?.message ?? `Backend trả về lỗi HTTP ${response.status}.`)
    Object.assign(error, { code: payload?.error?.code, status: response.status })
    throw error
  }
  return (response.status === 204 ? undefined : await response.json()) as T
}

export function authenticatedRequest<T>(path: string, init: RequestInit = {}) {
  return request<T>(path, init, true)
}

export async function checkApiConnectivity(timeoutMs = 5000) {
  if (!API_BASE_URL) return false
  try {
    const apiUrl = new URL(API_BASE_URL, globalThis.location?.origin ?? 'http://localhost')
    const healthUrl = new URL('/health', apiUrl.origin)
    const response = await fetch(healthUrl, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
    return response.ok
  } catch {
    return false
  }
}

export async function refreshAuth(): Promise<AuthResponse> {
  if (!csrfToken) {
    const response = await fetch(`${API_BASE_URL}/auth/csrf`, { credentials: 'include' })
    if (!response.ok) throw new Error('Phiên đăng nhập đã hết hạn.')
    const payload = await response.json() as { csrfToken: string }
    csrfToken = payload.csrfToken
  }
  return request<AuthResponse>('/auth/refresh', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken },
  }, false)
}
