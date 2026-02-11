/**
 * Runtime setup — singleton initialization and data decoding
 *
 * Creates and configures the Uniweb singleton (globalThis.uniweb)
 * with routing components, icon resolver, data fetcher, etc.
 */

import { createUniweb, Website } from '@uniweb/core'
import {
  Link as RouterLink,
  useNavigate,
  useParams,
  useLocation
} from 'react-router-dom'

import { ChildBlocks } from './components/PageRenderer.jsx'
import { executeFetchClient } from './data-fetcher-client.js'

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
 * Initialize the Uniweb singleton.
 *
 * Creates globalThis.uniweb with Website, routing components, icons,
 * data fetcher, and pre-populated DataStore.
 *
 * @param {Object} configData - Site configuration data
 * @returns {Uniweb}
 */
export function setupUniweb(configData) {
  // Create singleton via @uniweb/core (also assigns to globalThis.uniweb)
  const uniwebInstance = createUniweb(configData)

  // Pre-populate DataStore from build-time fetched data
  if (configData.fetchedData && uniwebInstance.activeWebsite?.dataStore) {
    for (const entry of configData.fetchedData) {
      uniwebInstance.activeWebsite.dataStore.set(entry.config, entry.data)
    }
  }

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

  // Register data fetcher on DataStore so BlockRenderer can fetch data
  if (uniwebInstance.activeWebsite?.dataStore) {
    uniwebInstance.activeWebsite.dataStore.registerFetcher(executeFetchClient)
  }

  return uniwebInstance
}

/**
 * Rebuild the Website within the existing singleton.
 *
 * For live editing: creates a new Website from modified configData
 * and assigns it to the singleton. The singleton itself (foundation,
 * icon resolver, routing components) stays unchanged.
 *
 * @param {Object} configData - Modified site configuration data
 * @returns {Website} The new Website instance
 */
export function rebuildWebsite(configData) {
  const uniweb = globalThis.uniweb
  const newWebsite = new Website(configData)
  newWebsite.dataStore.registerFetcher(executeFetchClient)
  uniweb.activeWebsite = newWebsite
  return newWebsite
}

/**
 * Register a foundation on the Uniweb singleton.
 *
 * Separated from setupUniweb because foundation loading is async
 * and happens independently.
 *
 * @param {Object} uniwebInstance - The Uniweb singleton
 * @param {Object} foundation - The loaded foundation module
 */
export function registerFoundation(uniwebInstance, foundation) {
  uniwebInstance.setFoundation(foundation)

  if (foundation.default?.capabilities) {
    uniwebInstance.setFoundationConfig(foundation.default.capabilities)
  }

  if (foundation.default?.layoutMeta && uniwebInstance.foundationConfig) {
    uniwebInstance.foundationConfig.layoutMeta = foundation.default.layoutMeta
  }
}

/**
 * Decode combined data from __DATA__ element
 *
 * Encoding is signaled via MIME type:
 * - application/json: plain JSON (no compression)
 * - application/gzip: gzip + base64 encoded
 *
 * @returns {Promise<{foundation: Object, content: Object}|null>}
 */
export async function decodeData() {
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
