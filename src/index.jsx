/**
 * @uniweb/runtime - Main Entry Point
 *
 * Minimal runtime for loading foundations and orchestrating rendering.
 * Foundations should import components from @uniweb/kit.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'
import {
  BrowserRouter,
  Routes,
  Route,
  Link as RouterLink,
  useNavigate,
  useParams,
  useLocation
} from 'react-router-dom'

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
 * Map friendly family names to react-icons codes
 * The existing CDN uses react-icons structure: /{familyCode}/{familyCode}-{name}.svg
 */
const ICON_FAMILY_MAP = {
  // Friendly names
  lucide: 'lu',
  heroicons: 'hi',
  heroicons2: 'hi2',
  phosphor: 'pi',
  tabler: 'tb',
  feather: 'fi',
  // Font Awesome (multiple versions)
  fa: 'fa',
  fa6: 'fa6',
  // Additional families from react-icons
  bootstrap: 'bs',
  'material-design': 'md',
  'ant-design': 'ai',
  remix: 'ri',
  'simple-icons': 'si',
  ionicons: 'io5',
  boxicons: 'bi',
  vscode: 'vsc',
  weather: 'wi',
  game: 'gi',
  // Also support direct codes for power users
  lu: 'lu',
  hi: 'hi',
  hi2: 'hi2',
  pi: 'pi',
  tb: 'tb',
  fi: 'fi',
  bs: 'bs',
  md: 'md',
  ai: 'ai',
  ri: 'ri',
  io5: 'io5',
  bi: 'bi',
  si: 'si',
  vsc: 'vsc',
  wi: 'wi',
  gi: 'gi'
}

/**
 * Create CDN-based icon resolver
 * @param {Object} iconConfig - From site.yml icons:
 * @returns {Function} Resolver: (library, name) => Promise<string|null>
 */
function createIconResolver(iconConfig = {}) {
  // Default to GitHub Pages CDN, can be overridden in site.yml
  const CDN_BASE = iconConfig.cdnUrl || 'https://uniweb.github.io/icons'
  const useCdn = iconConfig.cdn !== false

  // Cache resolved icons
  const cache = new Map()

  return async function resolve(library, name) {
    // Map friendly name to react-icons code
    const familyCode = ICON_FAMILY_MAP[library.toLowerCase()]
    if (!familyCode) {
      console.warn(`[icons] Unknown family "${library}"`)
      return null
    }

    // Check cache
    const key = `${familyCode}:${name}`
    if (cache.has(key)) return cache.get(key)

    // Fetch from CDN
    if (!useCdn) {
      cache.set(key, null)
      return null
    }

    try {
      // CDN structure: /{familyCode}/{familyCode}-{name}.svg
      // e.g., lucide:home → /lu/lu-home.svg
      const iconFileName = `${familyCode}-${name}`
      const url = `${CDN_BASE}/${familyCode}/${iconFileName}.svg`
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const svg = await response.text()
      cache.set(key, svg)
      return svg
    } catch (err) {
      console.warn(`[icons] Failed to load ${library}:${name}`, err.message)
      cache.set(key, null)
      return null
    }
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

  // Register routing components for kit and foundation components
  // This enables the bridge pattern: components access routing via
  // website.getRoutingComponents() instead of direct imports
  uniwebInstance.routingComponents = {
    Link: RouterLink,
    useNavigate,
    useParams,
    useLocation
  }

  // Set up icon resolver based on site config
  uniwebInstance.iconResolver = createIconResolver(configData.icons)

  // Populate icon cache from prerendered data (if available)
  // This allows icons to render immediately without CDN fetches
  if (typeof document !== 'undefined') {
    try {
      const cacheEl = document.getElementById('__ICON_CACHE__')
      if (cacheEl) {
        const cached = JSON.parse(cacheEl.textContent)
        for (const [key, svg] of Object.entries(cached)) {
          uniwebInstance.iconCache.set(key, svg)
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  return uniwebInstance
}

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
 * Render the application
 * @param {Object} options
 */
function render({ development = false, basename } = {}) {
  const container = document.getElementById('root')
  if (!container) {
    console.error('[Runtime] Root element not found')
    return
  }

  // Use provided basename, or derive from Vite's BASE_URL
  const routerBasename = basename ?? getBasename()

  // Set initial active page from browser URL so getLocaleUrl() works on first render
  const website = globalThis.uniweb?.activeWebsite
  if (website && typeof window !== 'undefined') {
    const rawPath = window.location.pathname
    const basePath = routerBasename || ''
    const routePath = basePath && rawPath.startsWith(basePath)
      ? rawPath.slice(basePath.length) || '/'
      : rawPath
    website.setActivePage(routePath)

    // Store base path on Website for components that need it (e.g., Link reload)
    if (website.setBasePath) {
      website.setBasePath(routerBasename || '')
    }
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
      <BrowserRouter basename={routerBasename}>
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
