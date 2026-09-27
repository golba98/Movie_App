import { Route, Routes, useLocation } from 'react-router'
import { AppShell } from './components/layout/AppShell'
import { RequireChangedPassword, RequireViewer } from './features/auth/AuthGate'
import { AdminPage } from './features/admin/AdminPage'
import { BrowsePage } from './features/catalog/BrowsePage'
import { CaptureCompatibilityPage } from './features/player/CaptureCompatibilityPage'
import { ChangePasswordPage } from './features/auth/ChangePasswordPage'
import { DetailsPage } from './features/catalog/details/DetailsPage'
import { FavouritesPage } from './features/favourites/FavouritesPage'
import { HomePage } from './features/catalog/HomePage'
import { LoginPage } from './features/auth/LoginPage'
import { NotFoundPage } from './app/NotFoundPage'
import { SearchPage } from './features/catalog/SearchPage'
import { WatchPartyJoinPage, WatchPartyRoomPage } from './features/watch-party/WatchPartyPages'
import { watchPartyEnabled } from './lib/feature-flags'

export default function App() {
  const location = useLocation()
  const state = location.state as { backgroundLocation?: Location } | null
  
  // Guard against details page nested backgroundLocation to avoid infinite render loops
  let background = state?.backgroundLocation
  if (background && (background.pathname.startsWith('/movie/') || background.pathname.startsWith('/tv/'))) {
    background = undefined
  }

  const isDetailsRoute = location.pathname.startsWith('/movie/') || location.pathname.startsWith('/tv/')
  const resolvedBackground = background || (isDetailsRoute ? { pathname: '/' } : undefined)

  return (
    <>
      <Routes location={resolvedBackground || location}>
        <Route path="login" element={<LoginPage />} />
        <Route path="admin" element={<AdminPage />} />
        {watchPartyEnabled && (
          <>
            <Route path="watch-party/join" element={<WatchPartyJoinPage />} />
            <Route path="watch-party/:roomId" element={<WatchPartyRoomPage />} />
          </>
        )}
        <Route element={<RequireViewer />}>
          <Route path="change-password" element={<ChangePasswordPage />} />
          <Route element={<RequireChangedPassword />}>
            <Route element={<AppShell />}>
              <Route index element={<HomePage />} />
              <Route path="movies" element={<BrowsePage mediaType="movie" />} />
              <Route path="tv" element={<BrowsePage mediaType="tv" />} />
              <Route path="search" element={<SearchPage />} />
              {!resolvedBackground && (
                <>
                  <Route path="movie/:id" element={<DetailsPage mediaType="movie" />} />
                  <Route path="tv/:id" element={<DetailsPage mediaType="tv" />} />
                </>
              )}
              <Route path="favourites" element={<FavouritesPage />} />
              <Route path="capture-test" element={<CaptureCompatibilityPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Route>
      </Routes>

      {isDetailsRoute && (
        <Routes>
          <Route element={<RequireViewer />}>
            <Route element={<RequireChangedPassword />}>
              <Route path="movie/:id" element={<DetailsPage mediaType="movie" />} />
              <Route path="tv/:id" element={<DetailsPage mediaType="tv" />} />
            </Route>
          </Route>
        </Routes>
      )}
    </>
  )
}
