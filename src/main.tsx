import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { AppErrorBoundary } from './app/AppErrorBoundary'
import { AuthProvider } from './features/auth/AuthProvider'
import { FavouritesProvider } from './features/favourites/FavouritesProvider'
import { WatchedHistoryProvider } from './features/watch-history/WatchHistoryProvider'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <FavouritesProvider>
          <WatchedHistoryProvider>
            <AppErrorBoundary>
              <App />
            </AppErrorBoundary>
          </WatchedHistoryProvider>
        </FavouritesProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
