import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { FavouritesProvider } from './hooks/useFavourites'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <FavouritesProvider>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </FavouritesProvider>
    </BrowserRouter>
  </StrictMode>,
)
