import { Route, Routes } from 'react-router'
import { AppShell } from './components/AppShell'
import { BrowsePage } from './pages/BrowsePage'
import { DetailsPage } from './pages/DetailsPage'
import { FavouritesPage } from './pages/FavouritesPage'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SearchPage } from './pages/SearchPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="movies" element={<BrowsePage mediaType="movie" />} />
        <Route path="tv" element={<BrowsePage mediaType="tv" />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="movie/:id" element={<DetailsPage mediaType="movie" />} />
        <Route path="tv/:id" element={<DetailsPage mediaType="tv" />} />
        <Route path="favourites" element={<FavouritesPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
