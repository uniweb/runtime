/**
 * Server-side data prefetch — the runtime executing a page's fetches for a host.
 *
 * L2 (graph state, no React): reads a payload, resolves the fetch configs the way the
 * entity store does at render time, executes them through the runtime's own default
 * fetcher, and returns the `[{ config, data }]` list `hydrateDataStore` expects.
 *
 * ⭐ Why this exists — one implementation of the fetch, in the runtime. A host that renders
 * pages in an isolate hands the isolate `fetchedData`. Until this module the host had to
 * compute that itself: resolve the configs, issue the requests, unwrap the responses in the
 * shape the datastore expects — a copy of the runtime's logic, in another repo, drifting
 * (the records envelope went silently unread that way on 2026-09-02). [Diego, 2026-09-03]:
 * *the backend sets `config.records`; the fetch comes from the runtime.* The host now calls
 * this and carries no copy. Hosting agreed to exactly that shape the same day.
 *
 * ⛔ Contract with the host, deliberately small:
 *   - `content`  the render payload (`site-content.json` / `__DATA__`), config included —
 *                `config.records`, `config.fetcher`, `config.base` are read from it.
 *   - `route`    the page to prefetch for; a `[slug]` template resolves through the same
 *                matcher the SPA uses, so `/blog/post-1` finds `/blog/:slug`.
 *   - `fetch`    how to dispatch a request. The runtime composes the address; the host
 *                decides how a site-relative one is reached (its origin, a binding).
 *   - returns    `[{ config, data, error? }]`, keyed downstream by `deriveCacheKey(config)`.
 *
 * It resolves nothing the host owns and models no host route layout: every address is
 * `{base}/…` from the payload, or an endpoint the host itself published in `config.records`.
 */
import { resolveFetchConfigs } from '@uniweb/core/fetch-config'
import { deriveCacheKey } from '@uniweb/core/datastore'
import { routePatternToRegex } from '@uniweb/core/route-match'
import { resolveDefaultLocale } from '@uniweb/core/locale-config'
import { createDefaultFetcher } from './default-fetcher.js'

const isRefinement = (f) => f && typeof f === 'object' && f.refine === true

/** The page a route names — exact first, then the `[slug]` templates, like the SPA. */
export function findPageForRoute(content, route) {
  const pages = content?.pages || []
  const exact = pages.find((p) => p.route === route)
  if (exact) return { page: exact, params: {} }
  for (const page of pages) {
    if (!page.isDynamic || !page.route) continue
    const compiled = routePatternToRegex(page.route)
    const m = compiled?.regex ? compiled.regex.exec(route) : null
    if (m) return { page, params: Object.fromEntries((compiled.paramNames || []).map((n, i) => [n, m[i + 1]])) }
  }
  return { page: null, params: {} }
}

/**
 * Every fetch config a page will need at render time, resolved once and de-duplicated by
 * cache key: the site-level fetch, the page's, its parent's, and each section's own
 * (including nested sections), each through `resolveFetchConfigs` — the same resolver the
 * entity store uses, so a host prefetches exactly what the render will ask for.
 *
 * @returns {Object[]} resolved fetch configs
 */
export function resolvePageFetchConfigs(content, route, { locale = null } = {}) {
  const { page } = findPageForRoute(content, route)
  if (!page) return []
  const pages = content?.pages || []
  const parent = page.parent ? pages.find((p) => p.route === page.parent) : null
  const options = {
    locale,
    defaultLocale: resolveDefaultLocale(content?.config) ?? null,
    queries: content?.config?.queries ?? null,
    records: content?.config?.records ?? null,
  }
  const out = new Map()
  const add = (sources) => {
    for (const cfg of resolveFetchConfigs(sources, options).values()) {
      const key = deriveCacheKey(cfg)
      if (!out.has(key)) out.set(key, cfg)
    }
  }
  // The cascade a block sees: its own fetch (unless a refinement), page, parent, site.
  add([page.fetch ?? null, parent?.fetch ?? null, content?.config?.fetch ?? null])
  const walk = (sections) => {
    for (const s of sections || []) {
      if (s?.fetch && !isRefinement(s.fetch)) add([s.fetch, page.fetch ?? null, parent?.fetch ?? null, content?.config?.fetch ?? null])
      if (s?.subsections) walk(s.subsections)
    }
  }
  walk(page.sections)
  return [...out.values()]
}

/**
 * Execute resolved fetch configs through the runtime's default fetcher.
 *
 * @param {Object[]} configs  resolved configs (from `resolvePageFetchConfigs` or the host's own
 *                             call to `resolveFetchConfigs`)
 * @param {Object} opts
 * @param {Object} opts.content  the payload — `config.base`, `config.fetcher`, `config.records`
 * @param {Function} [opts.fetch]  the transport; defaults to the global `fetch`
 * @param {boolean} [opts.dev]
 * @returns {Promise<Array<{ config: Object, data: any, error?: string }>>}
 */
export async function executeFetchConfigs(configs, { content, fetch = null, dev = false } = {}) {
  const fetcher = createDefaultFetcher({
    basePath: content?.config?.base || '',
    config: content?.config?.fetcher ?? {},
    records: content?.config?.records ?? null,
    dev,
    fetch,
  })
  const ctx = { website: null }
  const out = []
  for (const config of configs || []) {
    if (!config) continue
    if (config.prerender === false) continue   // the author deferred this one to the browser
    const result = await fetcher.resolve(config, ctx)
    const entry = { config, data: result?.data ?? null }
    if (result?.error) entry.error = result.error
    out.push(entry)
  }
  return out
}

/** Resolve and execute in one call: what a host passes the isolate as `fetchedData`. */
export async function prefetchPageData({ content, route, locale = null, fetch = null, dev = false }) {
  const configs = resolvePageFetchConfigs(content, route, { locale })
  return executeFetchConfigs(configs, { content, fetch, dev })
}
