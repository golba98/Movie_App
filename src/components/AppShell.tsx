import { Outlet, useLocation } from 'react-router'
import { useEffect } from 'react'
import { Footer } from './Footer'
import { Header } from './Header'
import { MobileNavigation } from './MobileNavigation'

export function AppShell() {
  const location = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [location.pathname])

  return (
    <div className="flex min-h-screen min-w-0 flex-col overflow-x-hidden bg-[#0a0a0a]">
      <Header />
      <MobileNavigation />
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
