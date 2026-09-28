import { apiRequest } from '../../lib/api-client'
import type { HistoryChanges } from './history-state'

const ENDPOINT = '/api/watch-history'

export function getWatchHistory() {
  return apiRequest<unknown>(ENDPOINT)
}

export function pushWatchHistory(changes: HistoryChanges, keepalive: boolean) {
  return apiRequest(ENDPOINT, { method: 'POST', body: JSON.stringify(changes), keepalive })
}
