import { Route, Routes, useLocation, type Location } from 'react-router'
import { AppShell } from './components/layout/AppShell'
import { NotFoundPage } from './app/NotFoundPage'
import { isDetailsPath } from './app/routes'
import { AdminPage } from './features/admin/AdminPage'
import { RequireChangedPassword, RequireViewer } from './features/auth/AuthGate'
import { ChangePasswordPage } from './features/auth/ChangePasswordPage'
import { LoginPage } from './features/auth/LoginPage'
import { BrowsePage } from './features/catalog/BrowsePage'
import { DetailsPage } from './features/catalog/details/DetailsPage'
import { HomePage } from './features/catalog/HomePage'
import { SearchPage } from './features/catalog/SearchPage'
import { FavouritesPage } from './features/favourites/FavouritesPage'
import { CaptureCompatibilityPage } from './features/player/CaptureCompatibilityPage'
import { WatchPartyJoinPage } from './features/watch-party/WatchPartyJoinPage'
import { WatchPartyRoomPage } from './features/watch-party/WatchPartyRoomPage'
import { watchPartyEnabled } from './lib/feature-flags'

const detailsRoutes = (
  <>
    <Route path="movie/:id" element={<DetailsPage mediaType="movie" />} />
    <Route path="tv/:id" element={<DetailsPage mediaType="tv" />} />
  </>
)

/**
 * Title details render as a modal over a background page: the page they were
 * opened from, or home when a details URL is opened directly.
 */
export default function App() {
  const location = useLocation()
  const isDetailsRoute = isDetailsPath(location.pathname)
  let background = (location.state as { backgroundLocation?: Location } | null)?.backgroundLocation
  // A details page is never a background, which would render details inside details.
  if (background && isDetailsPath(background.pathname)) background = undefined
  const resolvedBackground = background ?? (isDetailsRoute ? { pathname: '/' } : undefined)

  return (
    <>
      <Routes location={resolvedBackground ?? location}>
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
              {!resolvedBackground && detailsRoutes}
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
              {detailsRoutes}
            </Route>
          </Route>
        </Routes>
      )}
    </>
  )
}
