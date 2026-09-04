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
 *                `config.records` and `config.base` are read from it.
 *   - `route`    the page to prefetch for; a `[slug]` template resolves through the same
 *                matcher the SPA uses, so `/blog/post-1` finds `/blog/:slug`.
 *   - `fetch`    how to dispatch a request. The runtime composes the address; the host
 *                decides how a site-relative one is reached (its origin, a binding).
 *                ⛔ **Crossing an isolate boundary, this survives only as an RPC method
 *                argument.** Through an entrypoint's `fetch(Request)` with a serialized
 *                body it arrives `undefined` (hosting, measured under `wrangler dev`
 *                against a real Worker Loader, 2026-09-03) — and the fetcher then falls
 *                back to `globalThis.fetch`, so the request leaves from the isolate,
 *                outside whatever budget the host wrapped around it. `prefetchAndHydrate`
 *                refuses a non-function for exactly this reason; this entry keeps the
 *                permissive default because the build and browser lanes call it in-process.
 *   - `prerender`  whether a fetch is tried — `'always'` (default) tries every config; `'author'`
 *                honours the author's `prerender: false`. ⛔ The default is `'always'` because this
 *                entry has exactly one kind of caller: an isolate rendering per request, where the
 *                flag means nothing and always prerendering is the product ([Diego, 2026-07-28 and
 *                2026-09-03]: "`prerender: false` is not for the isolate"). The build lane, which
 *                bakes static artifacts and does honour the flag, uses its own executor
 *                (`build/src/prerender.js`) and never calls this. `'author'` is the explicit opt-in
 *                for a caller that bakes; omitting the option must not silently reproduce the
 *                2026-07-28 outcome — prefetch a no-op on a live-data template, page still 200.
 *   - returns    one entry per DECLARED config, `{ config, outcome, data, meta?, error? }`, keyed
 *                downstream by `deriveCacheKey(config)`. `outcome` is `fetched`, `failed`
 *                (transport or HTTP error, `error` says which) or `skipped` (the author
 *                deferred it to the browser with `prerender: false`). `hydrateDataStore`
 *                takes the list as-is and hydrates only `fetched` entries — a host reads the
 *                outcomes to tell "nothing was tried" from "everything tried failed", which
 *                is a different cache decision (hosting, 2026-09-03).
 *
 * It resolves nothing the host owns and models no host route layout: every address is
 * `{base}/…` from the payload, or an endpoint the host itself published in `config.records`.
 */
import { resolveFetchConfigs } from '@uniweb/core/fetch-config'
import { deriveCacheKey } from '@uniweb/core/datastore'
import { routePatternToRegex, decodeRouteValue, splitPathCapture } from '@uniweb/core/route-match'
import { buildDetailConfig } from '@uniweb/core/detail-url'
import { resolveDefaultLocale } from '@uniweb/core/locale-config'
import { createDefaultFetcher } from './default-fetcher.js'

const isRefinement = (f) => f && typeof f === 'object' && f.refine === true

/**
 * The page a route names — exact first, then the `[slug]` / `[...path]` templates, like
 * the SPA. Captured params are decoded the way `matchDynamicRoute` decodes them (a
 * catch-all per segment), so the values are what the site's query is bound against.
 */
export function findPageForRoute(content, route) {
  const pages = content?.pages || []
  const exact = pages.find((p) => p.route === route)
  if (exact) return { page: exact, params: {} }
  for (const page of pages) {
    if (!page.isDynamic || !page.route) continue
    const compiled = routePatternToRegex(page.route)
    const m = compiled?.regex ? compiled.regex.exec(route) : null
    if (m) {
      const params = {}
      ;(compiled.paramNames || []).forEach((n, i) => {
        const raw = m[i + 1]
        params[n] = n === compiled.catchAll ? raw.split('/').map(decodeRouteValue).join('/') : decodeRouteValue(raw)
      })
      return { page, params }
    }
  }
  return { page: null, params: {} }
}

/**
 * The route's variables and the delivery param for a matched template page — the same
 * binding the SPA makes in `Website._createDynamicPage`: `[slug]` binds the one capture
 * under the folder's own name; `[...path]` splits its capture into `path` / `dir` /
 * `slug` and delivers by `slug`, the record's handle.
 */
function routeBinding(page, params) {
  const { catchAll } = routePatternToRegex(page.route)
  if (catchAll && params[catchAll] !== undefined) {
    const parts = splitPathCapture(params[catchAll])
    const paramName = page.paramName || 'slug'
    return { paramName, paramValue: parts.slug, variables: { ...params, ...parts } }
  }
  const paramName = page.paramName || Object.keys(params)[0]
  return { paramName, paramValue: params[paramName], variables: { ...params } }
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
  const { page, params } = findPageForRoute(content, route)
  if (!page) return []
  const pages = content?.pages || []
  const parent = page.parent ? pages.find((p) => p.route === page.parent) : null
  const binding = page.isDynamic && Object.keys(params).length ? routeBinding(page, params) : null
  const options = {
    locale,
    defaultLocale: resolveDefaultLocale(content?.config) ?? null,
    queries: content?.config?.queries ?? null,
    records: content?.config?.records ?? null,
    variables: binding?.variables ?? null,
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

  // ⭐ A template page is ABOUT one record, and the record is a fetch of its own.
  // The list the page inherits is what the entity store matches the route param
  // against; when that query has a per-record source (a live lane's record address,
  // a `deferred:` query's per-record file), the record itself comes from a second
  // request — which this helper never built, so a host prerendering a template page
  // got the BRIEF and the body arrived after hydration as a client fetch. The
  // detail config is built by the one rule the
  // entity store uses (`buildDetailConfig`), keyed by the route's param.
  if (binding && binding.paramValue !== undefined && page.parentSchema) {
    const listCfg = [...out.values()].find((cfg) => cfg.as === page.parentSchema && cfg.detail)
    const detailCfg = listCfg ? buildDetailConfig(listCfg, { paramName: binding.paramName, paramValue: String(binding.paramValue) }) : null
    if (detailCfg) {
      const key = deriveCacheKey(detailCfg)
      if (!out.has(key)) out.set(key, detailCfg)
    }
  }
  return [...out.values()]
}

/**
 * Execute resolved fetch configs through the runtime's default fetcher.
 *
 * @param {Object[]} configs  resolved configs (from `resolvePageFetchConfigs` or the host's own
 *                             call to `resolveFetchConfigs`)
 * @param {Object} opts
 * @param {Object} opts.content  the payload — `config.base`, `config.records`
 * @param {Function} [opts.fetch]  the transport; defaults to the global `fetch`
 * @param {boolean} [opts.dev]
 * @returns {Promise<Array<{ config: Object, outcome: 'fetched'|'failed'|'skipped', data: any, error?: string }>>}
 */
export async function executeFetchConfigs(configs, { content, fetch = null, dev = false, prerender = 'always' } = {}) {
  if (prerender !== 'author' && prerender !== 'always') {
    throw new Error(`executeFetchConfigs: prerender must be 'author' or 'always', got ${JSON.stringify(prerender)}`)
  }
  const fetcher = createDefaultFetcher({
    basePath: content?.config?.base || '',
    records: content?.config?.records ?? null,
    dev,
    fetch,
  })
  const ctx = { website: null }
  // Dispatched together, not one after another: a question door batches the
  // requests issued in one tick into one POST, and a page's configs are
  // independent of each other. Order is preserved in the result.
  return Promise.all((configs || []).filter(Boolean).map(async (config) => {
    if (prerender === 'author' && config.prerender === false) {
      // The author deferred this one to the browser and the caller honours that. Present, so a
      // host can count what was declared against what was tried; not hydrated.
      return { config, outcome: 'skipped', data: null }
    }
    const result = await fetcher.resolve(config, ctx)
    if (result?.error) return { config, outcome: 'failed', data: null, error: result.error }
    return { config, outcome: 'fetched', data: result?.data ?? null, ...(result?.meta ? { meta: result.meta } : {}) }
  }))
}

/** Resolve and execute in one call: what a host passes the isolate as `fetchedData`. */
export async function prefetchPageData({ content, route, locale = null, fetch = null, dev = false, prerender = 'always' }) {
  const configs = resolvePageFetchConfigs(content, route, { locale })
  return executeFetchConfigs(configs, { content, fetch, dev, prerender })
}
