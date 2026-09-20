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
 * is routed to, so it asked for every fetch on every level and still got four cases wrong
 * (`kb/framework/plans/what-a-page-needs.md` §0). A payload cannot answer those; the graph the
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
import { resolvePage } from './ssr-renderer.js'
import { getComponentMeta } from './prepare-props.js'
import { createDefaultFetcher } from './default-fetcher.js'

/**
 * Every block the page's render can reach: its body and the layout areas it uses (the runtime's own
 * layout choice — the page's `layout:`, else the foundation's default, else the site's default set,
 * minus any area the page hides), plus what those blocks hold.
 */
function blocksOf(page) {
  const out = []
  const walk = (list) => {
    for (const block of list || []) {
      if (!block) continue
      out.push(block)
      walk(block.childBlocks)
      walk(block.insets)
    }
  }
  walk(page.getBodyBlocks?.() ?? page.bodyBlocks)
  for (const area of Object.values(page.getLayoutAreas?.() ?? {})) walk(area)
  return out
}

/**
 * Fetch what one route's render will read.
 *
 * @param {Object} options
 * @param {Object} options.website - the initialized Website the render will use (`initPrerender`)
 * @param {string|Object} options.route - the route, or an already-resolved Page
 * @param {Function} options.fetch - the transport, per request
 * @param {boolean} [options.dev]
 * @param {string|null} [options.locale] - ⛔ NOT a locale to fetch in: the Website is already
 *   locale-sliced (`initPrerenderForLocale`) and every address is resolved in ITS locale. Passing
 *   one that disagrees throws, because the alternative is a page prerendered in one language with
 *   the data of another, and nothing to see it.
 * @param {'always'|'author'} [options.prerender] - `'always'` asks for everything, which is what an
 *   isolate rendering a visit's first page wants; `'author'` honours `prerender: false`.
 * @returns {Promise<Array<{ config: Object, outcome: 'fetched'|'failed'|'skipped', data: *, meta?: Object, error?: string }>>}
 *   one entry per request the render will make, keyed downstream by `deriveCacheKey(config)`
 */
export async function loadPageData({ website, route, fetch, dev = false, locale = null, prerender = 'always' }) {
  if (prerender !== 'author' && prerender !== 'always') {
    throw new Error(`loadPageData: prerender must be 'author' or 'always', got ${JSON.stringify(prerender)}`)
  }
  const active = website?.getActiveLocale?.() ?? null
  if (locale && active && locale !== active) {
    throw new Error(
      `loadPageData: this Website renders ${JSON.stringify(active)} and the caller asked for ` +
      `${JSON.stringify(locale)}. A Website is locale-sliced — build one per locale ` +
      '(`initPrerenderForLocale`) rather than asking this step for another language.'
    )
  }
  const resolved = typeof route === 'string' ? resolvePage(website, route) : route
  // Nothing matched: a genuine 404, and the caller's to turn into one. Nothing to fetch.
  if (!resolved) return []
  // ⭐ The same promotion the render applies: a content-less folder renders its designated child,
  // and it is that child's data the page needs.
  const page = typeof resolved.getRenderableSelf === 'function' ? resolved.getRenderableSelf() : resolved

  // A cache of this request's own: the graph's belongs to whatever it is rendering, and a page's
  // data is asked fresh per request. The site's transports still apply (`dispatcherFor`).
  const dispatcher = website.dispatcherFor({
    dataStore: new DataStore(),
    defaultFetcher: createDefaultFetcher({ basePath: website.config?.base || '', dev, fetch }),
  })

  /** One entry per request, in the order they were first asked for. */
  const entries = new Map()
  const record = (request, entry) => {
    const key = deriveCacheKey(request)
    if (!entries.has(key)) entries.set(key, entry)
  }

  const recording = {
    peek: (request, ctx) => dispatcher.peek(request, ctx),
    peekRecord: (id) => dispatcher.peekRecord(id),
    dispatch: async (request, ctx) => {
      if (prerender === 'author' && request?.prerender === false) {
        // The author deferred this one to the browser and the caller honours that. Present, so a
        // host can count what was declared against what was tried; not fetched, not hydrated.
        record(request, { config: request, outcome: 'skipped', data: null })
        return { data: null }
      }
      const result = await dispatcher.dispatch(request, ctx)
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
