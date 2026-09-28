/** A viewer account as the API returns it; timestamps are epoch milliseconds. */
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

/** One entry in the administrator audit log. */
export interface AuditEvent {
  id: number
  action: string
  targetAccountId: string | null
  targetUsername: string | null
  metadata: unknown
  createdAt: number
}
