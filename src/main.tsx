import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { AppErrorBoundary } from './components/layout/AppErrorBoundary'
import { AuthProvider } from './hooks/useAuth'
import { FavouritesProvider } from './hooks/useFavourites'
import { WatchedHistoryProvider } from './hooks/useWatchedHistory'
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
