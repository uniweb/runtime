/**
 * @uniweb/runtime - Main Entry Point
 *
 * Minimal runtime for loading foundations and orchestrating rendering.
 * Foundations should import components from @uniweb/kit.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'

import { setupUniweb, registerFoundation, decodeData } from './setup.js'
import { loadFoundation, loadExtensions } from './foundation-loader.js'
import RuntimeProvider from './RuntimeProvider.jsx'

/**
 * Get the router basename from Vite's BASE_URL
 * Vite sets this based on the `base` config option
 * Returns undefined for root path ('/'), otherwise strips trailing slash
 */
function getBasename() {
  const baseUrl = import.meta.env?.BASE_URL
  if (!baseUrl || baseUrl === '/') return undefined
  // Remove trailing slash for BrowserRouter compatibility
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
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
  const uniwebInstance = setupUniweb(configData)

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
      foundation = remoteModule?.default?.default ? remoteModule.default : remoteModule
    } else if (foundationSource && typeof foundationSource === 'object') {
      // Already a foundation module
      foundation = foundationSource
    }

    if (!foundation) {
      throw new Error('Failed to load foundation')
    }

    // Register foundation on the runtime
    registerFoundation(uniwebInstance, foundation)

    // Load extensions (secondary foundations)
    const extensions = configData?.config?.extensions
    if (extensions?.length) {
      await loadExtensions(extensions, uniwebInstance)
    }

    // Derive basename
    const routerBasename = basename ?? getBasename()

    // Set initial active page from browser URL so getLocaleUrl() works on first render
    const website = uniwebInstance.activeWebsite
    if (website && typeof window !== 'undefined') {
      const rawPath = window.location.pathname
      const basePath = routerBasename || ''
      const routePath = basePath && rawPath.startsWith(basePath)
        ? rawPath.slice(basePath.length) || '/'
        : rawPath
      website.setActivePage(routePath)
    }

    // Render the app
    const container = document.getElementById('root')
    if (!container) {
      console.error('[Runtime] Root element not found')
      return
    }

    const root = createRoot(container)
    root.render(
      <RuntimeProvider basename={routerBasename} development={development} />
    )

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
 * Template main.js calls this with config + foundation/styles promises:
 *
 *   start({
 *     config: __FOUNDATION_CONFIG__,
 *     styles: import('#foundation/styles'),
 *     foundation: import('#foundation')
 *   })
 *
 * In runtime mode, the foundation/styles promises resolve to noop modules
 * (configured by the site Vite plugin) and are ignored.
 *
 * @param {Object} options
 * @param {Object} options.config - Build-time config from __FOUNDATION_CONFIG__
 * @param {Promise} options.foundation - Promise from import('#foundation')
 * @param {Promise} options.styles - Promise from import('#foundation/styles')
 */
async function start({ config, foundation, styles } = {}) {
  // Try __DATA__ first (dynamic backends inject combined config + content)
  const data = await decodeData()

  if (data) {
    // Dynamic backend mode - foundation loaded from URL, content from data
    return initRuntime(
      { url: data.foundation.url, cssUrl: data.foundation.cssUrl },
      { configData: data.content }
    )
  }

  // Use provided config, or fall back to bundled mode
  const mode = config?.mode ?? 'bundled'

  if (mode === 'runtime') {
    // Runtime mode - foundation loaded from URL
    return initRuntime({ url: config.url, cssUrl: config.cssUrl })
  } else {
    // Bundled mode - use the provided foundation/styles promises
    const [foundationModule] = await Promise.all([foundation, styles])
    return initRuntime(foundationModule)
  }
}

export { initRuntime, start }
export default initRuntime
