import type { AdminMediaSource, MediaSource, MediaSourceInput } from '../types/media-source'
import type { MediaType } from '../types/tmdb'
import { apiRequest } from './client'

export function getMediaSources(mediaType: MediaType, tmdbId: number, signal?: AbortSignal) {
  return apiRequest<{ sources: MediaSource[] }>(`/api/media-sources/${mediaType}/${tmdbId}`, { signal })
}

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
