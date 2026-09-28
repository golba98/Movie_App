import { LoaderCircle } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './auth-context'
import { changePasswordPath } from './safe-redirect'

function useCurrentPath() {
  const location = useLocation()
  return `${location.pathname}${location.search}`
}

/** Signed-in viewers only; everyone else is sent to sign in and brought back afterwards. */
export function RequireViewer() {
  const { account, loading } = useAuth()
  const currentPath = useCurrentPath()

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas text-zinc-300">
        <div className="flex items-center gap-3" role="status">
          <LoaderCircle className="animate-spin" aria-hidden="true" />
          Restoring your session…
        </div>
      </div>
    )
  }
  if (!account) return <Navigate to={`/login?next=${encodeURIComponent(currentPath)}`} replace />
  return <Outlet />
}

/** Viewers holding a temporary password must replace it before anything else. */
export function RequireChangedPassword() {
  const { account } = useAuth()
  const currentPath = useCurrentPath()
  if (account?.mustChangePassword) return <Navigate to={changePasswordPath(currentPath)} replace />
  return <Outlet />
}
