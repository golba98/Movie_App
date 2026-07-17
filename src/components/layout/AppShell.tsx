import { Outlet, useLocation } from 'react-router'
import { useEffect } from 'react'
import { Footer } from './Footer'
import { Header } from './Header'
import { LegacyImportBanner } from '../auth/LegacyImportBanner'
import { MobileNavigation } from './MobileNavigation'

export function AppShell() {
  const location = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [location.pathname])

  return (
    <div className="flex min-h-dvh min-w-0 flex-col overflow-x-hidden bg-[#070709]">
      <Header />
      <LegacyImportBanner />
      <main className="min-w-0 flex-1 pb-24 md:pb-0">
        <Outlet />
      </main>
      <Footer />
      <MobileNavigation />
    </div>
  )
}
