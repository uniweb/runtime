/**
 * Runtime setup — build the Uniweb singleton + Website from a site-content
 * payload and a loaded foundation.
 *
 * Replaces the old `setupUniweb` + `registerFoundation` + `rebuildWebsite`
 * split. The Uniweb constructor now takes foundation + extensions directly,
 * so the runtime's boot sequence boils down to:
 *
 *   decodeData()       // pulls __DATA__ from the HTML shell
 *   loadFoundation()   // dynamic import of the primary foundation URL
 *   loadExtensions()   // parallel imports of extension URLs
 *   initUniweb({ content, foundation, extensions, ... })  // this module
 *   createRoot(...).render(<RuntimeProvider />)
 *
 * Editor live edits go through `website.rebuild({ content })` on the
 * already-constructed Website — no fetcher re-registration, state survives,
 * cache survives.
 */

import React from 'react'
import { createUniweb, defaultCacheKey } from '@uniweb/core'
import { createStaticJsonFetcher } from '@uniweb/fetchers'
import {
  Link as RouterLink,
  useNavigate as useRouterNavigate,
  useParams,
  useLocation,
} from 'react-router-dom'

import { ChildBlocks } from './components/PageRenderer.jsx'

// ─── View Transition Wrappers ───────────────────────────────────────────────
//
// When the foundation enables viewTransitions, navigation is wrapped in
// document.startViewTransition() to animate page changes. Split content
// is prefetched inside the transition callback so the user never sees
// a blank or loading state.

const CONTENT_PREFETCH_TIMEOUT = 1000
export const prefersReducedMotion =
  typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function prefetchContent(route) {
  const website = globalThis.uniweb?.activeWebsite
  if (!route || !website) return

  const targetPage = website.getPage(route)
  if (!targetPage?.hasContent?.() || targetPage.isContentLoaded?.()) return

  return Promise.race([
    targetPage.loadContent(),
    new Promise((resolve) => setTimeout(resolve, CONTENT_PREFETCH_TIMEOUT)),
  ])
}

function navigateWithTransition(navigate, to, options) {
  const vt = globalThis.uniweb?.foundationConfig?.viewTransitions
  if (vt && document.startViewTransition && !prefersReducedMotion) {
    document.startViewTransition(async () => {
      const route = typeof to === 'string' ? to : to?.pathname
      await prefetchContent(route)
      navigate(to, options)
    })
  } else {
    navigate(to, options)
  }
}

const ViewTransitionLink = React.forwardRef(function ViewTransitionLink(
  { onClick, replace, state, preventScrollReset, ...props },
  ref,
) {
  const navigate = useRouterNavigate()

  const handleClick = (e) => {
    if (onClick) onClick(e)
    if (e.defaultPrevented) return
    if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return
    if (e.button !== 0) return

    const vt = globalThis.uniweb?.foundationConfig?.viewTransitions
    if (!vt || !document.startViewTransition || prefersReducedMotion) return

    e.preventDefault()
    navigateWithTransition(navigate, props.to, { replace, state, preventScrollReset })
  }

  return React.createElement(RouterLink, {
    ref,
    ...props,
    onClick: handleClick,
    replace,
    state,
    preventScrollReset,
  })
})

function useNavigate() {
  const navigate = useRouterNavigate()
  return (to, options) => navigateWithTransition(navigate, to, options)
}

/**
 * Default routing components for browser/SPA mode. The editor substitutes
 * its own when it wraps DynamicApp in a MemoryRouter.
 */
const DEFAULT_ROUTING_COMPONENTS = {
  Link: ViewTransitionLink,
  useNavigate,
  useParams,
  useLocation,
}

// ─── Icon resolution ────────────────────────────────────────────────────────

const ICON_FAMILY_MAP = {
  lucide: 'lu',
  heroicons: 'hi',
  heroicons2: 'hi2',
  phosphor: 'pi',
  tabler: 'tb',
  feather: 'fi',
  fa: 'fa',
  fa6: 'fa6',
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
  gi: 'gi',
}

function createIconResolver(iconConfig = {}) {
  const CDN_BASE = iconConfig.cdnUrl || 'https://uniweb.github.io/icons'
  const useCdn = iconConfig.cdn !== false
  const cache = new Map()

  return async function resolve(library, name) {
    const familyCode = ICON_FAMILY_MAP[library.toLowerCase()]
    if (!familyCode) {
      console.warn(`[icons] Unknown family "${library}"`)
      return null
    }

    const key = `${familyCode}:${name}`
    if (cache.has(key)) return cache.get(key)

    if (!useCdn) {
      cache.set(key, null)
      return null
    }

    try {
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

// ─── Runtime default fetcher ────────────────────────────────────────────────

function buildDefaultFetcher() {
  // BASE_URL is injected by Vite at build. For subpath deployments the default
  // fetcher prepends it to local absolute paths (remote URLs are never touched).
  const basePath = import.meta.env?.BASE_URL || ''
  return createStaticJsonFetcher({ basePath })
}

/**
 * Build the Uniweb singleton from a site-content payload and loaded foundation
 * modules. Returns the constructed Uniweb instance; it is also assigned to
 * `globalThis.uniweb` by `createUniweb`.
 *
 * Pre-populates the DataStore from `content.fetchedData` (build-time prerender
 * results) so the first render hits the cache.
 *
 * @param {Object} options
 * @param {Object} options.content - Decoded site content (pages, config, ...).
 * @param {Object} options.foundation - Loaded primary foundation module.
 * @param {Array<Object>} [options.extensions] - Loaded extension modules.
 * @param {Object} [options.routingComponents] - Routing override (editor uses this).
 * @returns {import('@uniweb/core').Uniweb}
 */
export function initUniweb({ content, foundation, extensions = [], routingComponents = DEFAULT_ROUTING_COMPONENTS }) {
  const defaultFetcher = buildDefaultFetcher()
  const uniweb = createUniweb(content, foundation, extensions, { defaultFetcher })

  // Pre-populate DataStore from build-time fetched data — each entry is
  // keyed by the framework's default cache key so runtime dispatches
  // hit the cache on first probe.
  if (content?.fetchedData?.length && uniweb.activeWebsite?.dataStore) {
    hydrateDataStore(uniweb.activeWebsite, content.fetchedData)
  }

  uniweb.childBlockRenderer = ChildBlocks
  uniweb.routingComponents = routingComponents
  uniweb.iconResolver = createIconResolver(content?.icons)

  // Populate icon cache from prerendered <script id="__ICON_CACHE__">.
  if (typeof document !== 'undefined') {
    try {
      const cacheEl = document.getElementById('__ICON_CACHE__')
      if (cacheEl) {
        const cached = JSON.parse(cacheEl.textContent)
        for (const [key, svg] of Object.entries(cached)) {
          uniweb.iconCache.set(key, svg)
        }
      }
    } catch {
      // Ignore parse errors.
    }
  }

  return uniweb
}

/**
 * Pre-populate a Website's DataStore from build-time fetchedData entries.
 * Exported so the static build path can share the same helper.
 */
export function hydrateDataStore(website, fetchedData) {
  if (!website?.dataStore) return
  for (const entry of fetchedData) {
    website.dataStore.set(defaultCacheKey(entry.config), { data: entry.data })
  }
}

/**
 * Decode combined data from the __DATA__ element. Encoding is signaled via
 * MIME type: application/json is plain JSON; application/gzip (or the legacy
 * application/octet-stream) is base64-encoded gzip.
 */
export async function decodeData() {
  const el = document.getElementById('__DATA__')
  if (!el?.textContent) return null

  const raw = el.textContent

  if (el.type === 'application/json') {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  if (typeof DecompressionStream !== 'undefined') {
    try {
      const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
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

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
