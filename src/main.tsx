import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { APIProvider } from '@vis.gl/react-google-maps'
import { Auth0Provider } from '@auth0/auth0-react'
import './globals.css'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
const auth0DomainRaw = import.meta.env.VITE_AUTH0_DOMAIN as string | undefined
const auth0ClientId = import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined
const auth0Audience = import.meta.env.VITE_AUTH0_AUDIENCE as string | undefined
const auth0Domain = auth0DomainRaw?.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')

let appTree = (
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)

if (mapsApiKey) {
  appTree = (
    <APIProvider apiKey={mapsApiKey} libraries={['places']}>
      {appTree}
    </APIProvider>
  )
}

if (auth0Domain && auth0ClientId) {
  const authorizationParams: { redirect_uri: string; audience?: string } = {
    redirect_uri: window.location.origin,
  }

  if (auth0Audience?.trim()) {
    authorizationParams.audience = auth0Audience.trim()
  }

  appTree = (
    <Auth0Provider
      domain={auth0Domain}
      clientId={auth0ClientId}
      cacheLocation="localstorage"
      useRefreshTokens
      authorizationParams={authorizationParams}
    >
      {appTree}
    </Auth0Provider>
  )
} else {
  appTree = (
    <main style={{ padding: '2rem', fontFamily: '"Avenir Next", "Segoe UI", sans-serif' }}>
      <h1 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>Auth0 Config Missing</h1>
      <p>Set `VITE_AUTH0_DOMAIN` and `VITE_AUTH0_CLIENT_ID` in `.env`, then restart `npm run dev`.</p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(appTree)
