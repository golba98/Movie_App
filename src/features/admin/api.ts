import { apiRequest } from '../../lib/api-client'
import type { AdminMediaSource, MediaSourceInput, SearchProvider, SearchProviderInput } from '../../types/media-source'

export function getAdminMediaSources(search = '') {
  return apiRequest<{ sources: AdminMediaSource[] }>(
    `/api/admin/media-sources?search=${encodeURIComponent(search)}`,
  )
}

export function createAdminMediaSource(source: MediaSourceInput) {
  return apiRequest<{ source: AdminMediaSource }>('/api/admin/media-sources', {
    method: 'POST',
    body: JSON.stringify(source),
  })
}

export function updateAdminMediaSource(id: string, source: Partial<MediaSourceInput>) {
  return apiRequest<{ source: AdminMediaSource }>(`/api/admin/media-sources/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(source),
  })
}

export function deleteAdminMediaSource(id: string) {
  return apiRequest<{ removed: boolean }>(`/api/admin/media-sources/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function getAdminSearchProviders() {
  return apiRequest<{ providers: SearchProvider[] }>('/api/admin/search-providers')
}

export function createAdminSearchProvider(provider: SearchProviderInput) {
  return apiRequest<{ provider: SearchProvider }>('/api/admin/search-providers', {
    method: 'POST',
    body: JSON.stringify(provider),
  })
}

export function updateAdminSearchProvider(id: string, provider: Partial<SearchProviderInput>) {
  return apiRequest<{ provider: SearchProvider }>(`/api/admin/search-providers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(provider),
  })
}

export function deleteAdminSearchProvider(id: string) {
  return apiRequest<{ removed: boolean }>(`/api/admin/search-providers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
