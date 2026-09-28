import { createContext, useContext } from 'react'
import type { ViewerAccount } from '../../types/account'

export interface AuthContextValue {
  account: ViewerAccount | null
  loading: boolean
  login: (username: string, password: string) => Promise<ViewerAccount>
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<ViewerAccount>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
