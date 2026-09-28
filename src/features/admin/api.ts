import { apiRequest } from '../../lib/api-client'
import type { AuditEvent, ViewerAccount } from '../../types/account'
import type { AdminMediaSource, MediaSourceInput, SearchProvider, SearchProviderInput } from '../../types/media-source'

const json = (method: string, body: unknown = {}) => ({ method, body: JSON.stringify(body) })
const accountPath = (id: string) => `/api/admin/accounts/${encodeURIComponent(id)}`
const sourcePath = (id: string) => `/api/admin/media-sources/${encodeURIComponent(id)}`
const providerPath = (id: string) => `/api/admin/search-providers/${encodeURIComponent(id)}`

export interface NewAccountInput {
  username: string
  displayName: string
  temporaryPassword: string
  expiresAt: number | null
}

export interface AccountChanges {
  displayName: string
  active: boolean
  expiresAt: number | null
}

// Session

export function getAdminSession() {
  return apiRequest<{ authenticated: boolean }>('/api/admin/session')
}

export function adminLogin(password: string) {
  return apiRequest('/api/admin/login', json('POST', { password }))
}

export function adminLogout() {
  return apiRequest('/api/admin/logout', json('POST'))
}

// Viewer accounts

export function getAccounts(search: string) {
  return apiRequest<{ accounts: ViewerAccount[] }>(`/api/admin/accounts?search=${encodeURIComponent(search)}`)
}

export function getAuditLog() {
  return apiRequest<{ events: AuditEvent[] }>('/api/admin/audit')
}

export function createAccount(input: NewAccountInput) {
  return apiRequest<{ account: ViewerAccount }>('/api/admin/accounts', json('POST', input))
}

export function updateAccount(id: string, changes: AccountChanges) {
  return apiRequest(accountPath(id), json('PATCH', changes))
}

export function revokeSessions(id: string) {
  return apiRequest(`${accountPath(id)}/revoke-sessions`, json('POST'))
}

export function resetPassword(id: string, temporaryPassword: string) {
  return apiRequest(`${accountPath(id)}/reset-password`, json('POST', { temporaryPassword }))
}

export function deleteAccount(id: string) {
  return apiRequest(accountPath(id), { method: 'DELETE' })
}

// Authorised media sources

export function getAdminMediaSources(search = '') {
  return apiRequest<{ sources: AdminMediaSource[] }>(`/api/admin/media-sources?search=${encodeURIComponent(search)}`)
}

export function createAdminMediaSource(source: MediaSourceInput) {
  return apiRequest<{ source: AdminMediaSource }>('/api/admin/media-sources', json('POST', source))
}

export function updateAdminMediaSource(id: string, source: Partial<MediaSourceInput>) {
  return apiRequest<{ source: AdminMediaSource }>(sourcePath(id), json('PATCH', source))
}

export function deleteAdminMediaSource(id: string) {
  return apiRequest<{ removed: boolean }>(sourcePath(id), { method: 'DELETE' })
}

// Dynamic search providers

export function getAdminSearchProviders() {
  return apiRequest<{ providers: SearchProvider[] }>('/api/admin/search-providers')
}

export function createAdminSearchProvider(provider: SearchProviderInput) {
  return apiRequest<{ provider: SearchProvider }>('/api/admin/search-providers', json('POST', provider))
}

export function updateAdminSearchProvider(id: string, provider: Partial<SearchProviderInput>) {
  return apiRequest<{ provider: SearchProvider }>(providerPath(id), json('PATCH', provider))
}

export function deleteAdminSearchProvider(id: string) {
  return apiRequest<{ removed: boolean }>(providerPath(id), { method: 'DELETE' })
}
