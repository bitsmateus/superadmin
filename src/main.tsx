import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { applyStoredTheme } from './hooks/useTheme'
import { registerServiceWorker } from './lib/registerServiceWorker'
import { recarregarPorVersaoNova } from './lib/versaoNova'
import './index.css'
import './styles/visualNovo.css'
import './styles/mercadoNunes.css'

// Aplica tema salvo ANTES do React renderizar — evita flash de tema errado.
applyStoredTheme()
registerServiceWorker()

// Aba aberta desde antes de uma versão nova: o arquivo da tela que ela pede já não existe. Recarrega uma vez (pega a lista nova)
// em vez de mostrar "Algo deu errado". O Vite avisa por este evento; o ErrorBoundary cobre o mesmo erro vindo do React.lazy.
window.addEventListener('vite:preloadError', (e) => {
  if (recarregarPorVersaoNova()) e.preventDefault()
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: 'rgb(var(--surface-rgb))',
                border: '1px solid var(--line)',
                color: 'rgb(var(--foreground-rgb))',
              },
            }}
            richColors
            closeButton
          />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
