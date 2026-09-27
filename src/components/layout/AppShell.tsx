import { Outlet, useLocation, useNavigationType } from 'react-router'
import { useEffect } from 'react'
import { Footer } from './Footer'
import { Header } from './Header'
import { LegacyImportBanner } from '../auth/LegacyImportBanner'
import { MobileHeader, MobileNavigation } from './MobileNavigation'
import { useLenisScroll } from '../../hooks/useLenisScroll'

export function AppShell() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const lenisRef = useLenisScroll()

  useEffect(() => {
    const isDetailsRoute = location.pathname.startsWith('/movie/') || location.pathname.startsWith('/tv/')
    if (!isDetailsRoute && navigationType !== 'POP') {
      if (lenisRef.current) {
        lenisRef.current.scrollTo(0, { immediate: true })
      } else {
        window.scrollTo({ top: 0, behavior: 'instant' })
      }
    }
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
