import { errorResponse } from './http'
import { handleApi } from './routes'

export { WatchPartyRoom } from './watch-party/room'

export default {
  async fetch(request, env): Promise<Response> {
    try {
      if (new URL(request.url).pathname.startsWith('/api/')) return await handleApi(request, env)
      return env.ASSETS.fetch(request)
    } catch (error) {
      return errorResponse(error)
    }
  },
} satisfies ExportedHandler<Env>
