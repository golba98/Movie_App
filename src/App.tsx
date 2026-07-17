import { Route, Routes } from 'react-router'
import { AppShell } from './components/layout/AppShell'
import { RequireChangedPassword, RequireViewer } from './components/auth/AuthGate'
import { AdminPage } from './pages/admin/AdminPage'
import { BrowsePage } from './pages/BrowsePage'
import { CaptureCompatibilityPage } from './pages/CaptureCompatibilityPage'
import { ChangePasswordPage } from './pages/auth/ChangePasswordPage'
import { DetailsPage } from './pages/DetailsPage'
import { FavouritesPage } from './pages/FavouritesPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/auth/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SearchPage } from './pages/SearchPage'

export default function App() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route path="admin" element={<AdminPage />} />
      <Route element={<RequireViewer />}>
        <Route path="change-password" element={<ChangePasswordPage />} />
        <Route element={<RequireChangedPassword />}>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="movies" element={<BrowsePage mediaType="movie" />} />
            <Route path="tv" element={<BrowsePage mediaType="tv" />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="movie/:id" element={<DetailsPage mediaType="movie" />} />
            <Route path="tv/:id" element={<DetailsPage mediaType="tv" />} />
            <Route path="favourites" element={<FavouritesPage />} />
            <Route path="capture-test" element={<CaptureCompatibilityPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}
