import { LoaderCircle } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../../hooks/useAuth'

export function RequireViewer() {
  const { account, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[#070709] text-zinc-300">
        <div className="flex items-center gap-3" role="status">
          <LoaderCircle className="animate-spin" aria-hidden="true" />
          Restoring your session…
        </div>
      </div>
    )
  }
  if (!account) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  return <Outlet />
}

export function RequireChangedPassword() {
  const { account } = useAuth()
  const location = useLocation()
  if (account?.mustChangePassword) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/change-password?next=${encodeURIComponent(next)}`} replace />
  }
  return <Outlet />
}
