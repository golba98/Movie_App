import { useEffect } from 'react'
import { Outlet, useLocation, useNavigationType } from 'react-router'
import { isDetailsPath } from '../../app/routes'
import { LegacyImportBanner } from '../../features/favourites/LegacyImportBanner'
import { useLenisScroll } from '../../hooks/useLenisScroll'
import { Footer } from './Footer'
import { Header } from './Header'
import { MobileHeader, MobileNavigation } from './MobileNavigation'

export function AppShell() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const lenisRef = useLenisScroll()

  // New pages start at the top; back/forward keeps the browser's position, and
  // details modals leave the page beneath them where it was.
  useEffect(() => {
    if (isDetailsPath(location.pathname) || navigationType === 'POP') return
    if (lenisRef.current) lenisRef.current.scrollTo(0, { immediate: true })
    else window.scrollTo({ top: 0, behavior: 'instant' })
  }, [location.pathname, navigationType, lenisRef])

  return (
    <div className="relative z-10 flex min-h-dvh min-w-0 flex-col overflow-x-hidden bg-transparent">
      <Header />
      <MobileHeader />
      <LegacyImportBanner />
      <main className="min-w-0 flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
        <Outlet />
      </main>
      <Footer />
      <MobileNavigation />
    </div>
  )
}
