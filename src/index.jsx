/**
 * @uniweb/runtime - Main Entry Point
 *
 * Minimal runtime for loading foundations and orchestrating rendering.
 * Foundations should import components from @uniweb/kit.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'

// Components
import { ChildBlocks } from './components/PageRenderer.jsx'
import WebsiteRenderer from './components/WebsiteRenderer.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Layout from './components/Layout.jsx'
import Blocks from './components/Blocks.jsx'

// Core factory from @uniweb/core
import { createUniweb } from '@uniweb/core'

/**
 * Decode combined data from __DATA__ element
 *
 * Encoding is signaled via MIME type:
 * - application/json: plain JSON (no compression)
 * - application/gzip: gzip + base64 encoded
 *
 * @returns {Promise<{foundation: Object, content: Object}|null>}
 */
async function decodeData() {
  const el = document.getElementById('__DATA__')
  if (!el?.textContent) return null

  const raw = el.textContent

  // Plain JSON (uncompressed)
  if (el.type === 'application/json') {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  // Compressed (application/gzip or legacy application/octet-stream)
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0))
      const stream = new DecompressionStream('gzip')
      const writer = stream.writable.getWriter()
      writer.write(bytes)
      writer.close()
      const json = await new Response(stream.readable).text()
      return JSON.parse(json)
    } catch {
      return null
    }
  }

  // Fallback for old browsers: try plain JSON (server can detect User-Agent)
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Load foundation CSS from URL
 * @param {string} url - URL to foundation's CSS file
 */
async function loadFoundationCSS(url) {
  if (!url) return

  return new Promise((resolve) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = url
    link.onload = () => {
      console.log('[Runtime] Foundation CSS loaded')
      resolve()
    }
    link.onerror = () => {
      console.warn('[Runtime] Could not load foundation CSS from:', url)
      resolve() // Don't fail for CSS
    }
    document.head.appendChild(link)
  })
}

/**
 * Load a foundation module via dynamic import
 * @param {string|Object} source - URL string or {url, cssUrl} object
 * @returns {Promise<Object>} The loaded foundation module
 */
async function loadFoundation(source) {
  const url = typeof source === 'string' ? source : source.url
  const cssUrl = typeof source === 'object' ? source.cssUrl : null

  console.log(`[Runtime] Loading foundation from: ${url}`)

  try {
    // Load CSS and JS in parallel
    const [, foundation] = await Promise.all([
      cssUrl ? loadFoundationCSS(cssUrl) : Promise.resolve(),
      import(/* @vite-ignore */ url)
    ])

    const componentNames = foundation.components
      ? Object.keys(foundation.components)
      : 'unknown'
    console.log('[Runtime] Foundation loaded. Available components:', componentNames)

    return foundation
  } catch (error) {
    console.error('[Runtime] Failed to load foundation:', error)
    throw error
  }
}

/**
 * Initialize the Uniweb instance
 * @param {Object} configData - Site configuration data
 * @returns {Uniweb}
 */
function initUniweb(configData) {
  // Create singleton via @uniweb/core (also assigns to globalThis.uniweb)
  const uniwebInstance = createUniweb(configData)

  // Set up child block renderer for nested blocks
  uniwebInstance.childBlockRenderer = ChildBlocks

  return uniwebInstance
}

/**
 * Render the application
 * @param {Object} options
 */
function render({ development = false, basename } = {}) {
  const container = document.getElementById('root')
  if (!container) {
    console.error('[Runtime] Root element not found')
    return
  }

  const root = createRoot(container)

  const app = (
    <ErrorBoundary
      fallback={
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h2>Something went wrong</h2>
          <p>Please try refreshing the page</p>
        </div>
      }
    >
      <BrowserRouter basename={basename}>
        <Routes>
          <Route path="/*" element={<WebsiteRenderer />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )

  root.render(development ? <React.StrictMode>{app}</React.StrictMode> : app)
}

/**
 * Initialize the Runtime Environment
 *
 * @param {string|Object|Promise} foundationSource - One of:
 *   - URL string to foundation module
 *   - Object with {url, cssUrl}
 *   - Promise that resolves to a foundation module (legacy federation support)
 * @param {Object} options
 * @param {boolean} options.development - Enable development mode
 * @param {Object} options.configData - Site configuration (or read from DOM)
 * @param {string} options.basename - Router basename
 */
async function initRuntime(foundationSource, options = {}) {
  const {
    development = import.meta.env?.DEV ?? false,
    configData: providedConfig = null,
    basename
  } = options

  // Get config data from options, DOM, or global
  const configData =
    providedConfig ??
    JSON.parse(document.getElementById('__SITE_CONTENT__')?.textContent || 'null') ??
    globalThis.__SITE_CONTENT__

  if (!configData) {
    console.error('[Runtime] No site configuration found')
    return
  }

  // Initialize core runtime
  const uniwebInstance = initUniweb(configData)

  try {
    let foundation

    // Handle different foundation source types
    if (typeof foundationSource === 'string' || (foundationSource && typeof foundationSource.url === 'string')) {
      // ESM URL - load via dynamic import
      foundation = await loadFoundation(foundationSource)
    } else if (foundationSource && typeof foundationSource.then === 'function') {
      // Promise (legacy Module Federation support)
      const remoteModule = await foundationSource
      // Handle double default wrapping
      const innerModule = remoteModule?.default?.default ? remoteModule.default : remoteModule
      // Convert to foundation interface with components object
      foundation = {
        components: innerModule.default || {},
        ...innerModule
      }
    } else if (foundationSource && typeof foundationSource === 'object') {
      // Already a foundation module
      foundation = foundationSource
    }

    if (!foundation) {
      throw new Error('Failed to load foundation')
    }

    // Set the foundation on the runtime
    uniwebInstance.setFoundation(foundation)

    // Set foundation capabilities (Layout, props, etc.) if provided
    if (foundation.capabilities) {
      uniwebInstance.setFoundationConfig(foundation.capabilities)
    }

    // Render the app
    render({ development, basename })

    // Log success
    if (!development) {
      console.log(
        '%c<%c>%c Uniweb Runtime',
        'color: #FA8400; font-weight: bold; font-size: 18px;',
        'color: #00ADFE; font-weight: bold; font-size: 18px;',
        'color: #333; font-size: 18px; font-family: system-ui, sans-serif;'
      )
    }
  } catch (error) {
    console.error('[Runtime] Initialization failed:', error)

    // Render error state
    const container = document.getElementById('root')
    if (container) {
      const root = createRoot(container)
      root.render(
        <div
          style={{
            padding: '2rem',
            margin: '1rem',
            background: '#fef2f2',
            borderRadius: '0.5rem',
            color: '#dc2626'
          }}
        >
          <h2>Runtime Error</h2>
          <p>{error.message}</p>
          {development && <pre style={{ fontSize: '0.75rem', overflow: 'auto' }}>{error.stack}</pre>}
        </div>
      )
    }
  }
}

/**
 * Simplified entry point for sites
 *
 * Reads configuration from (in order of priority):
 * 1. __DATA__ element (dynamic backends) - combined foundation config + site content
 * 2. Build-time __FOUNDATION_CONFIG__ (static builds) - foundation config only
 *
 * @param {Object} options
 * @param {Promise} options.foundation - Promise from import('#foundation')
 * @param {Promise} options.styles - Promise from import('#foundation/styles')
 */
async function start({ foundation, styles } = {}) {
  // Try __DATA__ first (dynamic backends inject combined config + content)
  const data = await decodeData()

  if (data) {
    // Dynamic backend mode - foundation loaded from URL, content from data
    return initRuntime(
      { url: data.foundation.url, cssUrl: data.foundation.cssUrl },
      { configData: data.content }
    )
  }

  // Static build mode - use build-time config
  const config =
    typeof __FOUNDATION_CONFIG__ !== 'undefined' ? __FOUNDATION_CONFIG__ : { mode: 'bundled' }

  if (config.mode === 'runtime') {
    // Runtime mode (foundation URL in site.yml)
    return initRuntime({ url: config.url, cssUrl: config.cssUrl })
  } else {
    // Bundled mode - foundation included in build
    const [foundationModule] = await Promise.all([foundation, styles])
    return initRuntime(foundationModule)
  }
}

export { initRuntime, start }
export default initRuntime
