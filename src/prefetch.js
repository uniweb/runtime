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
 * *the backend sets the records service; the fetch comes from the runtime.* The host now calls
 * this and carries no copy; the host that renders in an isolate agreed to exactly
 * that shape the same day.
 *
 * ⛔ Contract with the host, deliberately small:
 *   - `content`  the render payload (`site-content.json` / `__DATA__`), config included —
 *                `config.services` and `config.base` are read from it.
 *   - `route`    the page to prefetch for; a `[slug]` template resolves through the same
 *                matcher the SPA uses, so `/blog/post-1` finds `/blog/:slug`.
 *   - `fetch`    how to dispatch a request. The runtime composes the address; the host
 *                decides how a site-relative one is reached (its origin, a binding).
 *                ⛔ **Crossing an isolate boundary, this survives only as an RPC method
 *                argument.** Through an entrypoint's `fetch(Request)` with a serialized
 *                body it arrives `undefined` (measured by a host against a real
 *                isolate loader, 2026-09-03) — and the fetcher then falls
 *                back to `globalThis.fetch`, so the request leaves from the isolate,
 *                outside whatever budget the host wrapped around it. `prefetchAndHydrate`
 *                refuses a non-function for exactly this reason; this entry keeps the
 *                permissive default because the build and browser lanes call it in-process.
 *   - `prerender`  whether a fetch is tried — `'always'` (default) tries every config; `'author'`
 *                honours the author's `prerender: false`. ⛔ The default is `'always'` because this
 *                entry has exactly one kind of caller: an isolate prerendering the page a visit
 *                starts on, where the flag means nothing and always prerendering is the product
 *                ([Diego, 2026-07-28 and 2026-09-03]: "`prerender: false` is not for the isolate").
 *                ⚠️ That page ONLY: the site is a SPA, and every page after it renders in the
 *                browser with data the entity store fetches, never through this. (Until 2026-09-19
 *                this said "an isolate rendering per request", which read as "every page".)
 *                The build lane, which bakes static artifacts and does honour the flag, uses its
 *                own executor (`build/src/prerender.js`) and never calls this. `'author'` is the
 *                explicit opt-in for a caller that bakes; omitting the option must not silently
 *                reproduce the 2026-07-28 outcome — prefetch a no-op on a live-data template,
 *                page still 200.
 *   - returns    one entry per DECLARED config, `{ config, outcome, data, meta?, error? }`, keyed
 *                downstream by `deriveCacheKey(config)`. `outcome` is `fetched`, `failed`
 *                (transport or HTTP error, `error` says which) or `skipped` (the author
 *                deferred it to the browser with `prerender: false`). `hydrateDataStore`
 *                takes the list as-is and hydrates only `fetched` entries — a host reads the
 *                outcomes to tell "nothing was tried" from "everything tried failed", which
 *                is a different cache decision (measured by a host, 2026-09-03).
 *
 * It resolves nothing the host owns and models no host route layout: every address is
 * `{base}/…` from the payload, or the records service the host itself
 * published at `config.services.records`.
 */
import { resolveFetchConfigs, fetchEntries, pageRouteQuery, routeSelection, currentFor, othersView, siteReaches } from '@uniweb/core/fetch-config'
import { deriveCacheKey } from '@uniweb/core/datastore'
import { findPageForRoute, isDynamicRoute, routeBinding, parentRouteOf } from '@uniweb/core/route-match'
import { buildDetailConfig } from '@uniweb/core/detail-url'
import { resolveDefaultLocale } from '@uniweb/core/locale-config'
import { findLayoutEntry } from '@uniweb/core/layout-name'
import { createDefaultFetcher } from './default-fetcher.js'

/**
 * ⭐ **RE-EXPORTED, NOT IMPLEMENTED HERE — the rule lives in `@uniweb/core/route-match`.**
 *
 * This module carried its own copy until 2026-09-12, composed out of core's leaves,
 * and it disagreed with the SPA: this copy compared raw route strings, while
 * `Website#getPage` normalizes a trailing slash — so `/about/` prefetched nothing
 * and then rendered fine, which is the shape that hides the split.
 *
 * ⇒ The leaves were importable and the RULE was not, which is what invites a caller
 * to compose its own. Moving it into the leaf every caller already imports leaves one
 * answer to *which page is this* and nowhere for a second to form. The export keeps
 * its name here and on `@uniweb/runtime/ssr`, so the isolate API is unchanged.
 */
export { findPageForRoute }

/**
 * The page a page inherits from, by the one rule every lane uses (`parentRouteOf`):
 * the declared `parent` when it names a page, else the route minus its last segment.
 * ⛔ This read the declared field only until 2026-09-11. A payload that omits it —
 * published payloads may — gave every page no parent here while the SPA inferred
 * one, so `/members/alice` prefetched nothing: not the list, not the record
 * (measured). The page was then filled by the browser's own request.
 */
function parentPageOf(page, pages) {
  const byRoute = new Map(pages.filter((p) => p?.route).map((p) => [p.route, p]))
  const route = parentRouteOf(page.route, { declared: page.parent ?? null, has: (r) => byRoute.has(r) })
  return route ? byRoute.get(route) : null
}

/**
 * The layout sections a page may render — every section of the layout areas it can
 * use, subsections included. A page that names a layout uses that set (matched as the
 * runtime matches it, `@uniweb/core/layout-name`) and nothing else; a page that names
 * none uses its foundation's default layout, which a payload does not say, so every
 * set's sections are included — a superset, which a prefetch can afford.
 */
function layoutSectionsFor(content, page) {
  const sets = content?.layouts && typeof content.layouts === 'object' ? content.layouts : {}
  const name = typeof page?.layout?.name === 'string' && page.layout.name ? page.layout.name : null
  const named = name ? findLayoutEntry(sets, name) : undefined
  const chosen = name ? (named ? [named] : []) : Object.values(sets)
  const out = []
  const walk = (sections) => {
    for (const s of sections || []) {
      if (!s || typeof s !== 'object') continue
      out.push(s)
      walk(s.subsections)
    }
  }
  for (const set of chosen) for (const area of Object.values(set || {})) walk(area?.sections)
  return out
}

/**
 * Every fetch config a page will need at render time, resolved once and de-duplicated by
 * cache key: the page's, its parent's, each section's own (including nested sections),
 * its layout sections', and the site's where it reaches (`siteReaches`) — each through
 * `resolveFetchConfigs`, the same resolver the entity store uses, so a host prefetches
 * exactly what the render will ask for.
 *
 * @returns {Object[]} resolved fetch configs
 */
export function resolvePageFetchConfigs(content, route, { locale = null } = {}) {
  const { page, params } = findPageForRoute(content, route)
  if (!page) return []
  const pages = content?.pages || []
  const parent = parentPageOf(page, pages)
  // The route's binding — the SPA's (`routeBinding`, `@uniweb/core/route-match`).
  const binding = isDynamicRoute(page.route) && Object.keys(params).length
    ? routeBinding(page.route, params, page.paramName ?? null)
    : null
  const options = {
    locale,
    defaultLocale: resolveDefaultLocale(content?.config) ?? null,
    queries: content?.config?.queries ?? null,
    services: content?.config?.services ?? null,
    variables: binding?.variables ?? null,
  }
  const siteFetch = content?.config?.fetch ?? null
  // The route query: the key this page's URL names one record of, chosen at the page
  // that captured its variable — by the rule the entity store reads it with
  // (`pageRouteQuery`) — never a payload field.
  const chosen = binding
    ? pageRouteQuery(page, {
        routeOf: (p) => p.route,
        parentOf: (p) => parentPageOf(p, pages),
        fetchOf: (p) => p.fetch ?? null,
        sectionsOf: (p) => p.sections,
        site: siteFetch,
      })
    : null
  // A nested page's sections receive its capturing page's route binding, which the
  // one-parent cascade may not reach — the entity store adds it the same way.
  const routeSource = chosen?.nested ? chosen.config : null

  const out = new Map()
  const put = (cfg) => {
    const key = deriveCacheKey(cfg)
    if (!out.has(key)) out.set(key, cfg)
  }
  // ⭐ EVERY fetch of every level, each resolved on its own — not the first per key. A section
  // receives the keys its component declares, and two fetches of one `as` at two levels can
  // fill two of them (`fillDeclaredKeys`, 2026-09-14), which a prefetch holding no
  // component's meta cannot rule out. A superset, which a prefetch can afford.
  const add = (sources) => {
    const resolved = sources.flatMap((source) => fetchEntries(source).map((entry) => resolveFetchConfigs([entry], options).get(entry.as)))
    for (const cfg of resolved.filter(Boolean)) {
      // how the fetch uses the page's record — by the query it names, as the entity store asks
      const current = currentFor(cfg, chosen)
      if (current === 'exclude') {
        // the list one longer, from which the render removes the page's record
        put(othersView(cfg))
        continue
      }
      if (current !== 'only') {
        // no part for the page's record, or `current: include` — the list as the fetch describes it
        put(cfg)
        continue
      }
      // ⭐ A parametric page is ABOUT one record, and on a lane with a per-record
      // source (the records service, a `deferred:` query's per-record file) that
      // record is a request of its own. Built for EVERY config that takes the page's
      // record, by the one rule the entity store uses (`buildDetailConfig`), so
      // the question prefetched is the question the render asks — and since that
      // question drops a fetch's own narrowing, sections that narrow differently ask
      // one record question between them.
      if (cfg.detail && binding.paramValue !== undefined) {
        const detailCfg = buildDetailConfig(cfg, { paramName: binding.paramName, paramValue: String(binding.paramValue) })
        if (detailCfg) put(detailCfg)
      }
      // ⭐ On the records service the record question checks the query's set on its
      // own, so nothing else is asked. Off it, the record is FOUND in the set —
      // the query as saved, without the fetch's `narrow` (`routeSelection`) — which is
      // all the render reads for it. ⛔ Until 2026-09-14 the service's list was asked
      // beside the record, and the page embedded the whole set to show one record.
      if (!cfg.ask) put(routeSelection(cfg))
    }
  }
  // The cascade a block sees: its own fetch, page, parent, a nested page's route
  // binding, and the site's — which reaches a top-level page's sections only.
  const siteForPage = siteReaches(parent) ? siteFetch : null
  add([page.fetch ?? null, parent?.fetch ?? null, routeSource, siteForPage])
  const walk = (sections) => {
    for (const s of sections || []) {
      if (s?.fetch) add([s.fetch, page.fetch ?? null, parent?.fetch ?? null, routeSource, siteForPage])
      if (s?.subsections) walk(s.subsections)
    }
  }
  walk(page.sections)
  // ⭐ Layout sections belong to the site: the site's binding reaches them on every
  // page, beside each one's own fetch. A layout area has no parent page.
  for (const s of layoutSectionsFor(content, page)) add([s.fetch ?? null, siteFetch])
  return [...out.values()]
}

/**
 * Execute resolved fetch configs through the runtime's default fetcher.
 *
 * @param {Object[]} configs  resolved configs (from `resolvePageFetchConfigs` or the host's own
 *                             call to `resolveFetchConfigs`)
 * @param {Object} opts
 * @param {Object} opts.content  the payload — `config.base`, `config.services`
 * @param {Function} [opts.fetch]  the transport; defaults to the global `fetch`
 * @param {boolean} [opts.dev]
 * @returns {Promise<Array<{ config: Object, outcome: 'fetched'|'failed'|'skipped', data: any, error?: string }>>}
 */
export async function executeFetchConfigs(configs, { content, fetch = null, dev = false, prerender = 'always', locale = null } = {}) {
  if (prerender !== 'author' && prerender !== 'always') {
    throw new Error(`executeFetchConfigs: prerender must be 'author' or 'always', got ${JSON.stringify(prerender)}`)
  }
  const fetcher = createDefaultFetcher({
    basePath: content?.config?.base || '',
    dev,
    fetch,
  })
  // The page's locale, which a list's texts are collated in when the runtime sorts it.
  const ctx = { website: null, locale: locale ?? content?.config?.activeLocale ?? resolveDefaultLocale(content?.config) ?? null }
  // Dispatched together, not one after another: the records service batches the
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
  return executeFetchConfigs(configs, { content, fetch, dev, prerender, locale })
}
