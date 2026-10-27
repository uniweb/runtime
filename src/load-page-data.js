/**
 * THE RENDER'S DATA STEP — the page a visit starts on, fetched by the rule that renders it.
 *
 * ⭐ **Why a step at all.** The server render is synchronous: while it renders, a section reads its
 * data from the cache and never waits for a request (`EntityStore.resolve`). So whatever a page
 * shows has to be there before the render starts. That is this, and nothing else: it is not an
 * optimization, it is how a server-rendered page has content.
 *
 * ⭐ **Why it runs the render's own rule.** It asks, block by block, exactly what the render will
 * look for — `EntityStore.fetch`, the same plan `resolve` reads back (`@uniweb/core/page-data`) —
 * through a dispatcher built from the site's own foundation, so a transport the site chose answers
 * here too. ⛔ Until 2026-09-19 a host's prefetch worked this out from the payload alone: it could
 * not know which keys a component declares, which layout the page draws, or which transport a key
 * is routed to, so it asked for every fetch on every level and still got four cases wrong.
 * A payload cannot answer those; the graph the
 * isolate is about to render with can.
 *
 * ⚖️ **What it still over-asks.** The blocks are the page's — body, the layout areas it uses, their
 * child blocks and insets. Whether a component actually draws its children, or a layout its area,
 * is known only by rendering; a block that declares keys and is never drawn is asked for anyway.
 * Bounded by what such a block declares, and cheaper than rendering the page twice.
 *
 * @module
 */
import DataStore, { deriveCacheKey } from '@uniweb/core/datastore'
import { resolveRequestedPage } from './resolve-page.js'
import { getComponentMeta } from './prepare-props.js'
import { createDefaultFetcher } from './default-fetcher.js'
import { requireTransport } from './require-transport.js'
import { blocksOf } from './page-blocks.js'

/**
 * Fetch what one route's render will read.
 *
 * @param {Object} options
 * @param {Object} options.website - the initialized Website the render will use (`initPrerender`)
 * @param {string|Object} options.route - the route, or an already-resolved Page. A route that names
 *   no page, or a page served from elsewhere (`rewrite:`), asks for the site's not-found page's
 *   data, the page its render draws.
 * @param {Function} options.fetch - the transport, per request. Required: a missing one is refused,
 *   never replaced by the ambient `fetch` (`require-transport.js`)
 * @param {boolean} [options.dev]
 * @param {string|null} [options.locale] - ⛔ NOT a locale to fetch in: the Website is already
 *   locale-sliced (`initPrerenderForLocale`) and every address is resolved in ITS locale. Passing
 *   one that disagrees throws, because the alternative is a page prerendered in one language with
 *   the data of another, and nothing to see it.
 * @param {'always'|'author'} [options.prerender] - `'always'` asks for everything, which is what an
 *   isolate rendering a visit's first page wants; `'author'` honours `prerender: false`.
 * @param {Object} [options.cache] - a `DataStore` to answer from and fill, shared across calls.
 *   ⭐ For a caller that runs the step for MANY pages of one site — a static build — where every
 *   page asks for the site's and its parent's data and reading each address once is the difference
 *   between N reads and N×M. ⛔ Not for a host serving requests: there a page's data is asked
 *   fresh, and the default (a cache per call) is what does that. A shared cache changes nothing
 *   about what is ASKED or returned — every request is still recorded, hit or miss, and whether a
 *   record is held whole already is answered from this call's own requests, never the cache's.
 * @returns {Promise<Array<{ config: Object, outcome: 'fetched'|'failed'|'skipped', data: *, meta?: Object, error?: string }>>}
 *   one entry per request the render will make, keyed downstream by `deriveCacheKey(config)`
 */
export async function loadPageData({ website, route, fetch, dev = false, locale = null, prerender = 'always', cache = null }) {
  if (prerender !== 'author' && prerender !== 'always') {
    throw new Error(`loadPageData: prerender must be 'author' or 'always', got ${JSON.stringify(prerender)}`)
  }
  // Before the route is resolved: a lost transport is the caller's wiring, and an unknown route
  // must not hide it.
  requireTransport(fetch, 'loadPageData')
  const active = website?.getActiveLocale?.() ?? null
  if (locale && active && locale !== active) {
    throw new Error(
      `loadPageData: this Website renders ${JSON.stringify(active)} and the caller asked for ` +
      `${JSON.stringify(locale)}. A Website is locale-sliced — build one per locale ` +
      '(`initPrerenderForLocale`) rather than asking this step for another language.'
    )
  }
  // ⭐ This graph is the one `globalThis.uniweb` names while the step reads it, which it does here,
  // before its first `await`: each block's component meta and the layout the page draws come
  // through the global, and a host holding several graphs in one isolate has it naming the newest
  // (`Website#makeCurrent`).
  website.makeCurrent()
  const named = typeof route === 'string' ? resolveRequestedPage(website, route) : route
  // ⭐ A route that names no page, or a page served from elsewhere (`resolveRequestedPage`), renders
  // the site's not-found page (`createPageRenderer`), so it is that page's data the render reads.
  // With no such page: a genuine 404, the caller's to turn into one, and nothing to fetch.
  const resolved = named ?? (typeof route === 'string' ? website.getNotFoundPage() : null)
  if (!resolved) return []
  // ⭐ The same promotion the render applies: a content-less folder renders its designated child,
  // and it is that child's data the page needs.
  const page = typeof resolved.getRenderableSelf === 'function' ? resolved.getRenderableSelf() : resolved

  // ⛔ A real Page, not page data. `createPageRenderer` tolerates plain data because rendering it
  // still produces a page; here the same tolerance would walk raw sections, find no blocks and no
  // graph behind them, and fetch NOTHING — a clean run, an empty page, no error anywhere. That is
  // the failure this whole step exists to end, so it is refused.
  if (typeof page.getBodyBlocks !== 'function') {
    throw new Error('loadPageData: `route` must be a route or a Page from this Website — page data is not enough to say what its render reads.')
  }

  // A cache of this call's own unless the caller shares one: the graph's belongs to whatever it is
  // rendering, and a page's data is asked fresh per request. The site's transports still apply
  // (`dispatcherFor`).
  const dispatcher = website.dispatcherFor({
    dataStore: cache ?? new DataStore(),
    defaultFetcher: createDefaultFetcher({ basePath: website.config?.base || '', dev, fetch }),
  })

  /** One entry per request, in the order they were first asked for. */
  const entries = new Map()
  const record = (request, entry) => {
    const key = deriveCacheKey(request)
    if (!entries.has(key)) entries.set(key, entry)
  }

  // ⭐ WHAT THIS CALL'S OWN REQUESTS ANSWERED — the record index the plan asks "held whole
  // already?" before it asks for a record (R1). ⛔ Not the cache's: a shared one holds the records
  // other pages fetched, and a record found there was never asked for, so never recorded, and the
  // page carried nothing for it (2026-10-25). With a cache of this call's own, the two hold the
  // same records.
  const answered = new DataStore()

  const recording = {
    // ⭐ What the plan uses without asking (`keyProgram`'s held steps) is what THIS call's own
    // requests answered, as `peekRecord` is: the page carries every answer its render reads, so
    // it may use nothing it did not ask for itself — not another page's answer in a cache the
    // static build shares.
    peek: (request) => answered.get(deriveCacheKey(request)),
    peekRecord: (id) => answered.getRecord(id),
    dispatch: async (request, ctx) => {
      if (prerender === 'author' && request?.prerender === false) {
        // The author deferred this one to the browser and the caller honours that. Present, so a
        // host can count what was declared against what was tried; not fetched, not hydrated.
        record(request, { config: request, outcome: 'skipped', data: null })
        return { data: null }
      }
      const result = await dispatcher.dispatch(request, ctx)
      if (!result?.error && result?.data != null) {
        answered.set(deriveCacheKey(request), result.meta ? { data: result.data, meta: result.meta } : { data: result.data })
      }
      record(request, result?.error
        ? { config: request, outcome: 'failed', data: null, error: result.error }
        : { config: request, outcome: 'fetched', data: result?.data ?? null, ...(result?.meta ? { meta: result.meta } : {}) })
      return result
    },
  }

  const store = website.entityStore
  // ⭐ Every block's first request goes out in the same tick, which is what lets a question door
  // answer a page in one POST. A step that depends on an answer takes a later one, and only its
  // own key waits.
  await Promise.all([
    // The page's own record: asked whether or not a section declares the route key, because the
    // page names itself from it and a URL naming no record is a 404.
    store.fetchPageRecord(page, { dispatcher: recording }),
    ...blocksOf(page).map((block) => store.fetch(block, getComponentMeta(block.type), { dispatcher: recording })),
  ])

  return [...entries.values()]
}
