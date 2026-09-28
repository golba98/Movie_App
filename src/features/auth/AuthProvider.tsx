import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AUTH_EXPIRED_EVENT } from '../../lib/api-client'
import type { ViewerAccount } from '../../types/account'
import * as authApi from './api'
import { AuthContext } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<ViewerAccount | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    authApi.getSession()
      .then((response) => setAccount(response.account))
      .catch(() => setAccount(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const expire = () => setAccount(null)
    window.addEventListener(AUTH_EXPIRED_EVENT, expire)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expire)
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const { account } = await authApi.login(username, password)
    setAccount(account)
    return account
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      setAccount(null)
    }
  }, [])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const { account } = await authApi.changePassword(currentPassword, newPassword)
    setAccount(account)
    return account
  }, [])

  const value = useMemo(
    () => ({ account, loading, login, logout, changePassword }),
    [account, changePassword, loading, login, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
