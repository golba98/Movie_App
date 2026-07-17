import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../api/client'
import type { ViewerAccount } from '../types/account'

interface AuthContextValue {
  account: ViewerAccount | null
  loading: boolean
  login: (username: string, password: string) => Promise<ViewerAccount>
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<ViewerAccount>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<ViewerAccount | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const response = await apiRequest<{ account: ViewerAccount }>('/api/auth/session')
      setAccount(response.account)
    } catch {
      setAccount(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const expire = () => setAccount(null)
    window.addEventListener('fedora:auth-expired', expire)
    return () => window.removeEventListener('fedora:auth-expired', expire)
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const response = await apiRequest<{ account: ViewerAccount }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    setAccount(response.account)
    return response.account
  }, [])

  const logout = useCallback(async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST', body: '{}' })
    } finally {
      setAccount(null)
    }
  }, [])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const response = await apiRequest<{ account: ViewerAccount }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    setAccount(response.account)
    return response.account
  }, [])

  const value = useMemo(
    () => ({ account, loading, login, logout, changePassword, refresh }),
    [account, changePassword, loading, login, logout, refresh],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
