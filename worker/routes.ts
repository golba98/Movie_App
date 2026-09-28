import {
  adminLogin,
  adminLogout,
  adminSession,
  createAccount,
  deleteAccount,
  listAccounts,
  listAudit,
  resetAccountPassword,
  revokeAccountSessions,
  updateAccount,
} from './auth/admin'
import { changePassword, viewerLogin, viewerLogout, viewerSession } from './auth/viewer'
import {
  createMediaSource,
  deleteMediaSource,
  extractStreamEndpoint,
  listMediaSourcesForAdmin,
  listMediaSourcesForViewer,
  updateMediaSource,
} from './catalog/media-sources'
import {
  createSearchProvider,
  deleteSearchProvider,
  listSearchProvidersForAdmin,
  updateSearchProvider,
} from './catalog/search-providers'
import { proxyTmdb } from './catalog/tmdb'
import { ensureTesterAccount } from './dev-seed'
import { assertSameOrigin, methodNotAllowed, notFound } from './http'
import { deleteFavourite, importFavourites, listFavourites, putFavourite } from './library/favourites'
import { getWatchHistory, syncWatchHistory } from './library/watch-history'
import { watchPartyExtensionDevConnect, watchPartyExtensionSocket, watchPartyExtensionToken } from './watch-party/extension'
import {
  createWatchParty,
  joinWatchParty,
  lookupWatchParty,
  regenerateWatchPartyInvitation,
  watchPartyMedia,
  watchPartyRoomInfo,
  watchPartySocket,
  watchPartyState,
} from './watch-party/routes'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
// Receives the URL-decoded path parameters captured by the route pattern.
type Handler = (request: Request, env: Env, params: string[]) => Promise<Response>

interface Route {
  path: string | RegExp
  methods: Partial<Record<Method, Handler>>
}

const ID = '([^/]+)'
const MEDIA = '(movie|tv)/(\\d+)'
const pattern = (source: string) => new RegExp(`^${source}$`)

const DEV_CONNECT_PATH = '/api/watch-party/extension/dev-connect'
const TMDB_PREFIX = '/api/tmdb'

const routes: Route[] = [
  // Viewer sessions
  { path: '/api/auth/login', methods: { POST: viewerLogin } },
  { path: '/api/auth/session', methods: { GET: viewerSession } },
  { path: '/api/auth/change-password', methods: { POST: changePassword } },
  { path: '/api/auth/logout', methods: { POST: viewerLogout } },

  // Administrator console
  { path: '/api/admin/login', methods: { POST: adminLogin } },
  { path: '/api/admin/session', methods: { GET: adminSession } },
  { path: '/api/admin/logout', methods: { POST: adminLogout } },
  { path: '/api/admin/accounts', methods: { GET: listAccounts, POST: createAccount } },
  { path: '/api/admin/audit', methods: { GET: listAudit } },
  { path: '/api/admin/media-sources', methods: { GET: listMediaSourcesForAdmin, POST: createMediaSource } },
  {
    path: pattern(`/api/admin/media-sources/${ID}`),
    methods: {
      PATCH: (request, env, [id]) => updateMediaSource(request, env, id),
      DELETE: (request, env, [id]) => deleteMediaSource(request, env, id),
    },
  },
  { path: '/api/admin/search-providers', methods: { GET: listSearchProvidersForAdmin, POST: createSearchProvider } },
  {
    path: pattern(`/api/admin/search-providers/${ID}`),
    methods: {
      PATCH: (request, env, [id]) => updateSearchProvider(request, env, id),
      DELETE: (request, env, [id]) => deleteSearchProvider(request, env, id),
    },
  },
  {
    path: pattern(`/api/admin/accounts/${ID}`),
    methods: {
      PATCH: (request, env, [id]) => updateAccount(request, env, id),
      DELETE: (request, env, [id]) => deleteAccount(request, env, id),
    },
  },
  { path: pattern(`/api/admin/accounts/${ID}/reset-password`), methods: { POST: (request, env, [id]) => resetAccountPassword(request, env, id) } },
  { path: pattern(`/api/admin/accounts/${ID}/revoke-sessions`), methods: { POST: (request, env, [id]) => revokeAccountSessions(request, env, id) } },

  // Playback sources
  { path: '/api/media-sources/extract', methods: { GET: extractStreamEndpoint } },

  // Watch party
  { path: '/api/watch-party/rooms', methods: { POST: createWatchParty } },
  { path: '/api/watch-party/lookup', methods: { GET: lookupWatchParty } },
  { path: DEV_CONNECT_PATH, methods: { POST: watchPartyExtensionDevConnect } },
  { path: pattern(`/api/watch-party/rooms/${ID}`), methods: { GET: (request, env, [id]) => watchPartyRoomInfo(request, env, id) } },
  { path: pattern(`/api/watch-party/rooms/${ID}/join`), methods: { POST: (request, env, [id]) => joinWatchParty(request, env, id) } },
  { path: pattern(`/api/watch-party/rooms/${ID}/state`), methods: { GET: (request, env, [id]) => watchPartyState(request, env, id) } },
  { path: pattern(`/api/watch-party/rooms/${ID}/media`), methods: { GET: (request, env, [id]) => watchPartyMedia(request, env, id) } },
  { path: pattern(`/api/watch-party/rooms/${ID}/socket`), methods: { GET: (request, env, [id]) => watchPartySocket(request, env, id) } },
  {
    path: pattern(`/api/watch-party/rooms/${ID}/extension-token`),
    methods: { POST: (request, env, [id]) => watchPartyExtensionToken(request, env, id) },
  },
  {
    path: pattern(`/api/watch-party/rooms/${ID}/extension-socket`),
    methods: { GET: (request, env, [id]) => watchPartyExtensionSocket(request, env, id) },
  },
  {
    path: pattern(`/api/watch-party/rooms/${ID}/invitation`),
    methods: { POST: (request, env, [id]) => regenerateWatchPartyInvitation(request, env, id) },
  },

  // Viewer library
  { path: '/api/favourites', methods: { GET: listFavourites } },
  { path: '/api/watch-history', methods: { GET: getWatchHistory, POST: syncWatchHistory } },
  {
    path: pattern(`/api/media-sources/${MEDIA}`),
    methods: { GET: (request, env, [type, id]) => listMediaSourcesForViewer(request, env, type as 'movie' | 'tv', Number(id)) },
  },
  { path: '/api/favourites/import', methods: { POST: importFavourites } },
  {
    path: pattern(`/api/favourites/${MEDIA}`),
    methods: {
      PUT: (request, env, [type, id]) => putFavourite(request, env, type, Number(id)),
      DELETE: (request, env, [type, id]) => deleteFavourite(request, env, type, Number(id)),
    },
  },
]

function matchRoute(path: string) {
  for (const route of routes) {
    if (typeof route.path === 'string') {
      if (route.path === path) return { route, params: [] }
      continue
    }
    const match = path.match(route.path)
    if (match) return { route, params: match.slice(1) }
  }
  return null
}

function dispatch(request: Request, env: Env, route: Route, rawParams: string[]) {
  const handler = route.methods[request.method as Method]
  if (!handler) return Promise.resolve(methodNotAllowed(Object.keys(route.methods)))
  // Decoded only once a handler runs, so a malformed id with the wrong method still gets a 405.
  return handler(request, env, rawParams.map(decodeURIComponent))
}

export async function handleApi(request: Request, env: Env) {
  const path = new URL(request.url).pathname

  // Watch party is still under development: it is reachable only when the
  // WATCH_PARTY_ENABLED var is set (local .dev.vars). Production leaves it
  // unset, so every watch-party route 404s and the Durable Object never runs.
  if (path.startsWith('/api/watch-party') && env.WATCH_PARTY_ENABLED !== 'true') return notFound()
  // The extension's dev-connect call comes from a chrome-extension:// origin.
  if (path !== DEV_CONNECT_PATH) assertSameOrigin(request)

  await ensureTesterAccount(request, env.DB)

  const matched = matchRoute(path)
  if (matched) return dispatch(request, env, matched.route, matched.params)
  // The TMDB path is forwarded still percent-encoded, exactly as requested.
  if (path.startsWith(`${TMDB_PREFIX}/`)) {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    return proxyTmdb(request, env, path.slice(TMDB_PREFIX.length))
  }
  return notFound()
}
