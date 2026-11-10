import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { UserRecord } from '../../types'
import { authenticatedRequest, getCsrfToken, refreshAuth, registerRefreshHandler, setAccessToken, setCsrfToken, type AuthResponse } from './authClient'

interface AuthContextValue {
  user: UserRecord | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<boolean>
}

const AuthContext = createContext<AuthContextValue | null>(null)
export const authApiEnabled = Boolean(import.meta.env.VITE_API_BASE_URL?.trim())
const apiEnabled = authApiEnabled
const demoUser: UserRecord = { id: 'demo-admin', name: 'Lê Hoàng Nam', email: 'demo@foundation.local', role: 'Quản trị viên', active: true, createdAt: new Date(0).toISOString() }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserRecord | null>(apiEnabled ? null : demoUser)
  const [loading, setLoading] = useState(apiEnabled)

  const accept = useCallback((result: AuthResponse) => {
    setAccessToken(result.accessToken)
    setCsrfToken(result.csrfToken)
    setUser(result.user)
  }, [])

  const refresh = useCallback(async () => {
    try {
      accept(await refreshAuth())
      return true
    } catch {
      setAccessToken('')
      setUser(null)
      return false
    }
  }, [accept])

  useEffect(() => {
    if (!apiEnabled) return
    registerRefreshHandler(refresh)
    void refresh().finally(() => setLoading(false))
    return () => registerRefreshHandler(null)
  }, [refresh])

  const login = useCallback(async (email: string, password: string) => {
    const result = await authenticatedRequest<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    accept(result)
  }, [accept])

  const logout = useCallback(async () => {
    if (!apiEnabled) {
      setUser(demoUser)
      return
    }
    try {
      await authenticatedRequest<void>('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': getCsrfToken() } })
    } catch {
      // Xóa trạng thái cục bộ dù API tạm thời không phản hồi.
    } finally {
      setAccessToken('')
      setCsrfToken('')
      setUser(null)
    }
  }, [])

  const value = useMemo(() => ({ user, loading, login, logout, refresh }), [user, loading, login, logout, refresh])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth cần được dùng bên trong AuthProvider.')
  return context
}
