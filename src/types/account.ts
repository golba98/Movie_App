export interface ViewerAccount {
  id: string
  username: string
  displayName: string
  active: boolean
  mustChangePassword: boolean
  expiresAt: number | null
  createdAt: number
  updatedAt: number
  lastLoginAt: number | null
}

export interface AuditEvent {
  id: number
  action: string
  targetAccountId: string | null
  targetUsername: string | null
  metadata: unknown
  createdAt: number
}
