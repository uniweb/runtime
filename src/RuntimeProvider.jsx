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
 * @param {boolean} [props.externalRouter] - Skip creating a BrowserRouter — the
 *   consumer wraps RuntimeProvider in their own Router (e.g., MemoryRouter for
 *   srcdoc iframes). RuntimeProvider still renders ErrorBoundary, Routes, and
 *   WebsiteRenderer.
 */

import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import WebsiteRenderer from './components/WebsiteRenderer.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

export default function RuntimeProvider({ basename, development = false, externalRouter = false }) {
  const website = globalThis.uniweb?.activeWebsite
  if (!website) return null

  // Set basePath for subdirectory deployments
  if (website.setBasePath) {
    website.setBasePath(basename || '')
  }

  const routes = (
    <Routes>
      <Route path="/*" element={<WebsiteRenderer />} />
    </Routes>
  )

  const app = externalRouter
    ? <ErrorBoundary>{routes}</ErrorBoundary>
    : (
      <ErrorBoundary>
        <BrowserRouter basename={basename}>
          {routes}
        </BrowserRouter>
      </ErrorBoundary>
    )

  return development ? <React.StrictMode>{app}</React.StrictMode> : app
}
