import {
  adminLogin,
  adminLogout,
  adminSession,
  createAccount,
  listAccounts,
  listAudit,
  resetAccountPassword,
  revokeAccountSessions,
  updateAccount,
} from './admin'
import { deleteFavourite, importFavourites, listFavourites, putFavourite } from './favourites'
import { assertSameOrigin, errorResponse, methodNotAllowed } from './http'
import {
  createMediaSource,
  deleteMediaSource,
  extractStreamEndpoint,
  listMediaSourcesForAdmin,
  listMediaSourcesForViewer,
  updateMediaSource,
  listSearchProvidersForAdmin,
  createSearchProvider,
  updateSearchProvider,
  deleteSearchProvider,
} from './media-sources'
import { proxyTmdb } from './tmdb'
import { changePassword, viewerLogin, viewerLogout, viewerSession } from './viewer'
import { hashPassword } from './auth'

let dbSeeded = false

async function ensureTesterAccount(db: D1Database) {
  if (dbSeeded) return
  dbSeeded = true
  try {
    const existing = await db
      .prepare('SELECT id FROM accounts WHERE username_normalized = ?')
      .bind('tester')
      .first()
    if (!existing) {
      const password = await hashPassword('tester-password-123')
      const now = Date.now()
      await db
        .prepare(
          `INSERT INTO accounts
            (id, username, username_normalized, display_name, password_hash, password_salt,
             password_iterations, is_active, must_change_password, expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, null, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          'tester',
          'tester',
          'Local Tester',
          password.hash,
          password.salt,
          password.iterations,
          now,
          now,
        )
        .run()
      console.log('Local tester account created: username=tester, password=tester-password-123')
    }
  } catch (error) {
    console.error('Failed to ensure tester account:', error)
  }
}

function routeMethod(request: Request, handlers: Partial<Record<string, () => Promise<Response>>>) {
  const handler = handlers[request.method]
  return handler ? handler() : Promise.resolve(methodNotAllowed(Object.keys(handlers)))
}

async function handleApi(request: Request, env: Env) {
  assertSameOrigin(request)
  const url = new URL(request.url)
  const path = url.pathname

  if (env.TMDB_ACCESS_TOKEN !== 'unit-test-tmdb-token') {
    await ensureTesterAccount(env.DB)
  }

  if (path === '/api/auth/login') {
    return routeMethod(request, { POST: () => viewerLogin(request, env) })
  }
  if (path === '/api/auth/session') {
    return routeMethod(request, { GET: () => viewerSession(request, env) })
  }
  if (path === '/api/auth/change-password') {
    return routeMethod(request, { POST: () => changePassword(request, env) })
  }
  if (path === '/api/auth/logout') {
    return routeMethod(request, { POST: () => viewerLogout(request, env) })
  }
  if (path === '/api/admin/login') {
    return routeMethod(request, { POST: () => adminLogin(request, env) })
  }
  if (path === '/api/admin/session') {
    return routeMethod(request, { GET: () => adminSession(request, env) })
  }
  if (path === '/api/admin/logout') {
    return routeMethod(request, { POST: () => adminLogout(request, env) })
  }
  if (path === '/api/admin/accounts') {
    return routeMethod(request, {
      GET: () => listAccounts(request, env),
      POST: () => createAccount(request, env),
    })
  }
  if (path === '/api/admin/audit') {
    return routeMethod(request, { GET: () => listAudit(request, env) })
  }
  if (path === '/api/admin/media-sources') {
    return routeMethod(request, {
      GET: () => listMediaSourcesForAdmin(request, env),
      POST: () => createMediaSource(request, env),
    })
  }

  const mediaSourceAdminMatch = path.match(/^\/api\/admin\/media-sources\/([^/]+)$/)
  if (mediaSourceAdminMatch) {
    const sourceId = decodeURIComponent(mediaSourceAdminMatch[1])
    return routeMethod(request, {
      PATCH: () => updateMediaSource(request, env, sourceId),
      DELETE: () => deleteMediaSource(request, env, sourceId),
    })
  }

  if (path === '/api/admin/search-providers') {
    return routeMethod(request, {
      GET: () => listSearchProvidersForAdmin(request, env),
      POST: () => createSearchProvider(request, env),
    })
  }

  const searchProviderAdminMatch = path.match(/^\/api\/admin\/search-providers\/([^/]+)$/)
  if (searchProviderAdminMatch) {
    const providerId = decodeURIComponent(searchProviderAdminMatch[1])
    return routeMethod(request, {
      PATCH: () => updateSearchProvider(request, env, providerId),
      DELETE: () => deleteSearchProvider(request, env, providerId),
    })
  }

  const accountMatch = path.match(/^\/api\/admin\/accounts\/([^/]+)$/)
  if (accountMatch) {
    return routeMethod(request, {
      PATCH: () => updateAccount(request, env, decodeURIComponent(accountMatch[1])),
    })
  }
  const resetMatch = path.match(/^\/api\/admin\/accounts\/([^/]+)\/reset-password$/)
  if (resetMatch) {
    return routeMethod(request, {
      POST: () => resetAccountPassword(request, env, decodeURIComponent(resetMatch[1])),
    })
  }
  const revokeMatch = path.match(/^\/api\/admin\/accounts\/([^/]+)\/revoke-sessions$/)
  if (revokeMatch) {
    return routeMethod(request, {
      POST: () => revokeAccountSessions(request, env, decodeURIComponent(revokeMatch[1])),
    })
  }

  if (path === '/api/media-sources/extract') {
    return routeMethod(request, { GET: () => extractStreamEndpoint(request, env) })
  }

  if (path === '/api/favourites') {
    return routeMethod(request, { GET: () => listFavourites(request, env) })
  }

  const mediaSourcesMatch = path.match(/^\/api\/media-sources\/(movie|tv)\/(\d+)$/)
  if (mediaSourcesMatch) {
    return routeMethod(request, {
      GET: () => listMediaSourcesForViewer(
        request,
        env,
        mediaSourcesMatch[1] as 'movie' | 'tv',
        Number(mediaSourcesMatch[2]),
      ),
    })
  }
  if (path === '/api/favourites/import') {
    return routeMethod(request, { POST: () => importFavourites(request, env) })
  }
  const favouriteMatch = path.match(/^\/api\/favourites\/(movie|tv)\/(\d+)$/)
  if (favouriteMatch) {
    const mediaId = Number(favouriteMatch[2])
    return routeMethod(request, {
      PUT: () => putFavourite(request, env, favouriteMatch[1], mediaId),
      DELETE: () => deleteFavourite(request, env, favouriteMatch[1], mediaId),
    })
  }

  if (path.startsWith('/api/tmdb/')) {
    return routeMethod(request, {
      GET: () => proxyTmdb(request, env, path.slice('/api/tmdb'.length)),
    })
  }

  return Response.json(
    { error: { code: 'NOT_FOUND', message: 'API route not found.' } },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  )
}

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
