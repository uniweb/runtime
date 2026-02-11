/**
 * RuntimeProvider
 *
 * Encapsulates the full React rendering tree for a Uniweb site:
 * ErrorBoundary → BrowserRouter → Routes → WebsiteRenderer.
 *
 * The Uniweb singleton (globalThis.uniweb) must be set up BEFORE rendering
 * this component. RuntimeProvider reads from the singleton — it does not
 * manage initialization. The singleton is imperative infrastructure that
 * sits underneath React; React is a rendering layer within it.
 *
 * @param {Object} props
 * @param {string} [props.basename] - Router basename for subdirectory deployments
 * @param {boolean} [props.development] - Enable React StrictMode
 */

import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import WebsiteRenderer from './components/WebsiteRenderer.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

export default function RuntimeProvider({ basename, development = false }) {
  const website = globalThis.uniweb?.activeWebsite
  if (!website) return null

  // Set basePath for subdirectory deployments
  if (website.setBasePath) {
    website.setBasePath(basename || '')
  }

  const app = (
    <ErrorBoundary>
      <BrowserRouter basename={basename}>
        <Routes>
          <Route path="/*" element={<WebsiteRenderer />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )

  return development ? <React.StrictMode>{app}</React.StrictMode> : app
}
