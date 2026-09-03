/**
 * The composed render entry — resolve a route, render it, inject it into a shell.
 *
 * ⭐ **This exists because framework had two callers of one unshared sequence, not
 * because a consumer asked.** `@uniweb/runtime/ssr` exported every step of the
 * per-page render and never the sequence, so each host assembled it:
 *
 *   - `@uniweb/build`'s `prerender.js` — `renderPage` → classify → `injectPageContent`,
 *     once per page in its loop.
 *   - an SSR isolate rendering per request — `resolvePage` → `renderPage` →
 *     `injectPageContent`, and it wrote the route lookup three times in three files
 *     before `resolvePage` was exported at all (see that function's header).
 *
 * Two unlike callers is what makes the interface honest: a build bakes files and an
 * isolate answers a request, so anything only one of them needs stayed out.
 *
 * ⛔ WHAT IS DELIBERATELY NOT IN HERE, and the boundary is the point:
 *
 *   - **Shell assembly.** The shell arrives built. The import map, the CDN base and
 *     cache headers are host layout, and a runtime that assembled them would be
 *     modelling a deployment it cannot see (hosting drew this line themselves,
 *     2026-09-03; `framework/CLAUDE.md` § *Serve locations are read, never constructed*).
 *   - **Init and hydration.** The two lanes differ REALLY here, not incidentally: a
 *     build initializes once and hydrates every collection up front, an isolate
 *     initializes per locale and prefetches per route. Folding either in would fit
 *     one caller and lie to the other. `initPrerender` / `initPrerenderForLocale` /
 *     `prefetchPageData` / `hydrateDataStore` stay separate exports, and
 *     `prefetchAndHydrate` below is the isolate's two-step, not a general one.
 *   - **Anything build-only.** `injectBuildData` stays in the build lane; it is the
 *     other half of the head seam and has its own parity guard.
 */
import { resolvePage, renderPage, classifyRenderError, injectPageContent } from './ssr-renderer.js'
import { hydrateDataStore } from './wire-foundation.js'
import { prefetchPageData } from './prefetch.js'

/**
 * A renderer bound to one initialized Website and one shell.
 *
 * Create it once per locale (the Website is already locale-sliced by
 * `initPrerenderForLocale`) and call `render` per route or per page.
 *
 * @param {Object} opts
 * @param {Object} opts.website - `uniweb.activeWebsite`, already initialized
 * @param {string} opts.shell - the HTML shell to inject into, taken as given
 * @returns {{ website: Object, render: Function }}
 */
export function createPageRenderer({ website, shell }) {
  if (!website) throw new Error('createPageRenderer: `website` is required')
  if (typeof shell !== 'string') throw new Error('createPageRenderer: `shell` must be an HTML string')

  /**
   * Render one page.
   *
   * ⭐ Returns an OUTCOME rather than throwing or returning a bare string, because
   * the two callers branch differently on the same three cases and neither wants an
   * exception: a build logs and keeps going so one broken section cannot fail a whole
   * site, an isolate decides a status code and a cache policy. Same reasoning as
   * `prefetchPageData`'s per-entry outcome.
   *
   * @param {string|Object} target - a route (`/blog/1`, resolved through the same
   *   matcher the browser uses, so a dynamic route works) or an already-resolved
   *   Page, which the build lane already holds from its own loop.
   * @param {Object} [options]
   * @param {Object} [options.inject] - extra options forwarded to `injectPageContent`
   * @returns {{ outcome: 'rendered'|'notFound'|'failed', html: string|null,
   *   page: Object|null, error: {type: string, message: string}|null }}
   */
  function render(target, { inject = {} } = {}) {
    const page = typeof target === 'string' ? resolvePage(website, target) : target

    // ⛔ Not an error: nothing matched, which is a genuine 404 and the caller's to
    // turn into one — a build skips it, an isolate serves its 404 page with a 404
    // status. Returning `failed` here would make those indistinguishable.
    if (!page) return { outcome: 'notFound', html: null, page: null, error: null }

    let result
    try {
      result = renderPage(page, website)
    } catch (err) {
      // `renderPage` handles its own errors, but a foundation can throw from
      // module scope in ways it does not catch. Classify rather than propagate,
      // so one page cannot take down a build loop or an isolate's request.
      return { outcome: 'failed', html: null, page, error: classifyRenderError(err) }
    }

    if (result.error) return { outcome: 'failed', html: null, page, error: result.error }

    // ⛔ `sectionOverrideCSS` LAST, so a caller's `inject` cannot displace it. It is
    // computed by `renderPage` for this page — theme pinning and component vars —
    // and a caller passing a same-named key would silently drop it, rendering a page
    // that looks fine and is unstyled in exactly the places the author pinned. That
    // is the empty-success shape this module keeps refusing elsewhere; the spread was
    // the other way round for one commit.
    const html = injectPageContent(shell, result.renderedContent, page, {
      ...inject,
      sectionOverrideCSS: result.sectionOverrideCSS,
    })
    return { outcome: 'rendered', html, page, error: null }
  }

  return { website, render }
}

/**
 * Prefetch a route's data and hydrate it onto the graph — the isolate's two-step.
 *
 * ⭐ Its whole purpose is that a host stops assembling our structure by hand. It
 * returns the prefetch outcomes rather than swallowing them, because a host reads
 * them to tell "nothing was tried" from "everything tried failed", which is a
 * different cache decision.
 *
 * ⛔ The build lane does NOT call this: it hydrates every collection once, before
 * its page loop, from its own executor that honours the author's `prerender:` flag.
 * That difference is why this is a named isolate helper and not a step inside
 * `render`.
 *
 * @returns {Promise<Array<{config: Object, outcome: string, data: any, error?: string}>>}
 */
export async function prefetchAndHydrate({ website, content, route, locale = null, fetch = null, dev = false, prerender = 'always' }) {
  // ⛔ Guarded for the same reason `createPageRenderer` is, and it was not for one
  // commit. `hydrateDataStore` no-ops on a graph with no `dataStore`, so a caller
  // passing the wrong object gets a successful-looking prefetch, an unhydrated graph
  // and a page that renders empty — no error anywhere. Fail where the mistake is.
  if (!website?.dataStore) {
    throw new Error('prefetchAndHydrate: `website` must be an initialized Website with a dataStore')
  }

  // ⛔ THE TRANSPORT IS REQUIRED HERE, unlike on `prefetchPageData`, and this is the
  // one place the difference matters.
  //
  // A function does NOT survive every isolate boundary. Measured by hosting under
  // `wrangler dev` against a real Worker Loader, 2026-09-03: passed through an
  // entrypoint's `fetch(Request)` with a JSON body the transport arrives
  // **`undefined`**; passed as an argument to an RPC method it arrives as a callable
  // function and the isolate invokes it. Only the RPC shape carries it.
  //
  // ⚠️ And `undefined` is not where it stops, which is the part their measurement
  // could not see from outside our code. `createDefaultFetcher` resolves the
  // transport as `fetchImpl || globalThis.fetch`, so a transport that failed to cross
  // silently becomes THE ISOLATE'S OWN NETWORK — outside the host's timeout, byte
  // budget and site-relative address resolution. With an absolute address it does not
  // even fail: the request goes out from the wrong place and comes back
  // `outcome: 'fetched'`. A wiring mistake wearing a success.
  //
  // ⇒ So the entry whose only caller crosses that boundary demands a real function
  // rather than defaulting. A Node or browser caller that genuinely wants the global
  // passes `fetch: globalThis.fetch` — one word, and it says so.
  if (typeof fetch !== 'function') {
    throw new Error(
      'prefetchAndHydrate: `fetch` must be a function. A transport does not survive a ' +
      'JSON-serialized isolate boundary — pass it as an RPC method argument. ' +
      'To use the ambient fetch deliberately, pass `fetch: globalThis.fetch`.'
    )
  }
  const fetched = await prefetchPageData({ content, route, locale, fetch, dev, prerender })
  hydrateDataStore(website, fetched)
  return fetched
}
