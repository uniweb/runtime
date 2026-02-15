/**
 * RuntimeProvider
 *
 * Encapsulates the full React rendering tree for a Uniweb site:
 * ErrorBoundary → Router → Routes → WebsiteRenderer.
 *
 * The Uniweb singleton (globalThis.uniweb) must be set up BEFORE rendering
 * this component. RuntimeProvider reads from the singleton — it does not
 * manage initialization. The singleton is imperative infrastructure that
 * sits underneath React; React is a rendering layer within it.
 *
 * @param {Object} props
 * @param {string} [props.basename] - Router basename for subdirectory deployments
 * @param {boolean} [props.development] - Enable React StrictMode
 * @param {string[]} [props.memoryRouter] - Use MemoryRouter with these initial entries
 *   instead of BrowserRouter. Required for srcdoc iframes where the History API
 *   is unavailable. When provided, also exposes window.__uniweb_navigate for
 *   programmatic navigation from outside React.
 */

import React, { useEffect } from 'react'
import { BrowserRouter, MemoryRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import WebsiteRenderer from './components/WebsiteRenderer.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

/**
 * NavigationBridge — exposes React Router's navigate function on the window
 * so that code outside the React tree (e.g., Frame Bridge handlers) can
 * trigger navigation programmatically.
 */
function NavigationBridge() {
  const navigate = useNavigate()
  useEffect(() => {
    window.__uniweb_navigate = navigate
    return () => { delete window.__uniweb_navigate }
  }, [navigate])
  return null
}

/**
 * LocationReporter — notifies code outside the React tree when the route
 * changes. Required for MemoryRouter where the History API is not involved
 * and Frame Bridge's RouteReporter (which intercepts pushState/popstate)
 * cannot detect navigation.
 */
function LocationReporter() {
  const location = useLocation()
  useEffect(() => {
    window.__uniweb_onRouteChange?.(location.pathname)
  }, [location.pathname])
  return null
}

export default function RuntimeProvider({ basename, development = false, memoryRouter }) {
  const website = globalThis.uniweb?.activeWebsite
  if (!website) return null

  // Set basePath for subdirectory deployments
  if (website.setBasePath) {
    website.setBasePath(basename || '')
  }

  const Router = memoryRouter ? MemoryRouter : BrowserRouter
  const routerProps = memoryRouter
    ? { initialEntries: memoryRouter, basename }
    : { basename }

  const app = (
    <ErrorBoundary>
      <Router {...routerProps}>
        {memoryRouter && <NavigationBridge />}
        {memoryRouter && <LocationReporter />}
        <Routes>
          <Route path="/*" element={<WebsiteRenderer />} />
        </Routes>
      </Router>
    </ErrorBoundary>
  )

  return development ? <React.StrictMode>{app}</React.StrictMode> : app
}
