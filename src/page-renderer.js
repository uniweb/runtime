/**
 * The composed render entry — resolve a route, render it, inject it into a shell.
 *
 * ⭐ **This exists because framework had two callers of one unshared sequence, not
 * because a consumer asked.** `@uniweb/runtime/ssr` exported every step of the
 * per-page render and never the sequence, so each host assembled it:
 *
 *   - `@uniweb/build`'s `prerender.js` — `renderPage` → classify → `injectPageContent`,
 *     once per page in its loop.
 *   - an SSR isolate prerendering the page a visit starts on (the SPA renders every
 *     page after it) — `resolvePage` → `renderPage` → `injectPageContent`, and it wrote
 *     the route lookup three times in three files before `resolvePage` was exported at
 *     all (see that function's header).
 *
 * Two unlike callers is what makes the interface honest: a build bakes files and an
 * isolate answers a request, so anything only one of them needs stayed out.
 *
 * ⛔ WHAT IS DELIBERATELY NOT IN HERE, and the boundary is the point:
 *
 *   - **Shell assembly.** The shell arrives built. The import map, the CDN base and
 *     cache headers are host layout, and a runtime that assembled them would be
 *     modelling a deployment it cannot see (the host drew this line itself,
 *     2026-09-03: a serve location is read from the payload, never constructed here).
 *   - **Init and the data step.** The two lanes differ REALLY here, not incidentally: a
 *     build initializes once per locale and runs the data step for each page over one
 *     cache for the whole run; an isolate initializes per locale and runs the step fresh
 *     for each request. Folding either in would fit one caller and lie to the other.
 *     `initPrerender` / `initPrerenderForLocale` / `loadPageData` / `hydrateDataStore`
 *     stay separate exports, and `prefetchAndHydrate` below is the isolate's two-step,
 *     not a general one. ⭐ What both lanes DO share is the last step: the render reads
 *     exactly the entries its page carries. That is `render`'s `fetchedData`, since
 *     2026-10-25, and both lanes pass it.
 *   - **Anything build-only.** `injectBuildData` stays in the build lane; it is the
 *     other half of the head seam and has its own parity guard.
 */
import { renderPage, classifyRenderError, injectPageContent } from './ssr-renderer.js'
import { resolveRequestedPage } from './resolve-page.js'
import { hydrateDataStore } from './wire-foundation.js'
import { loadPageData } from './load-page-data.js'
import { requireTransport } from './require-transport.js'
import { restoreStartPage } from './start-page.js'
import { whileReadingIcons } from './page-icons.js'

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
   * site, an isolate decides a status code and a cache policy. Same reasoning as the
   * per-entry outcome `loadPageData` returns.
   *
   * @param {string|Object} target - a route (`/blog/1`, resolved through the same
   *   matcher the browser uses, so a dynamic route works) or an already-resolved
   *   Page, which the build lane already holds from its own loop. A route that names
   *   no page renders the site's not-found page (`website.getNotFoundPage()`), as the
   *   browser does for it, and so does a route naming a page served from elsewhere
   *   (`rewrite:`): a request for it that reaches a renderer was not proxied, and the
   *   browser's first load of it draws the not-found page too.
   * @param {Object} [options]
   * @param {Object} [options.inject] - extra options forwarded to `injectPageContent`
   * @param {Array<{config: Object, data: *, meta?: Object}>} [options.fetchedData] - the entries
   *   the page carries: the `content.fetchedData` its HTML embeds, which the browser boots with.
   *   ⭐ Given, the render reads exactly these. The Website forgets what it held, answers and the
   *   parametric pages made from them (`Website#forgetData`), and files these, all in this
   *   synchronous call, so a Website reused across requests renders each against its own and
   *   no other request runs in between. Absent, the render reads whatever the store holds.
   * @returns {{ outcome: 'rendered'|'notFound'|'failed', html: string|null,
   *   page: Object|null, error: {type: string, message: string}|null }}
   *   `notFound` means the URL names nothing, and `html` says whether there is a page to
   *   send for it. Send `html` with your not-found status when it is set, and the shell
   *   when it is not:
   *   - `page` set, `html` set — the site's not-found page, for a route that names no page
   *     or a page served from elsewhere; or a page whose record does not exist, rendered in
   *     its own not-found state.
   *   - `page: null`, `html: null` — no route matched, or it names a page served from
   *     elsewhere, and the site has no not-found page. The browser shows its default
   *     not-found message.
   *   - `page` set, `html: null`, `error` set — that page broke while rendering; `error`
   *     says what broke.
   */
  function render(target, { inject = {}, fetchedData } = {}) {
    if (fetchedData !== undefined && !Array.isArray(fetchedData)) {
      throw new Error('createPageRenderer: `fetchedData` must be the array of entries the page carries')
    }
    // ⭐ FIRST, THIS GRAPH IS THE ONE `globalThis.uniweb` NAMES. A block's component, the props
    // pipeline and kit in the foundation reach the site through the global, and every graph built
    // since this one was points it elsewhere — a host holds several in one isolate. The render is
    // synchronous, so the value set here is the one it reads throughout (`Website#makeCurrent`).
    website.makeCurrent()
    // ⭐ BEFORE THE ROUTE IS RESOLVED: a parametric page is made from the store when it is first
    // resolved, so resolving first would make it from what an earlier request left there.
    // ⛔ Until 2026-10-25 a host that reused one Website hydrated each request's answers on top of
    // every earlier request's, and a section that reads the store itself (kit's `useFetched`)
    // could render answers its page did not carry, so the browser's first render differed.
    if (fetchedData !== undefined) {
      website.forgetData()
      hydrateDataStore(website, fetchedData)
    }
    const named = typeof target === 'string' ? resolveRequestedPage(website, target) : target
    // ⭐ A ROUTE THAT NAMES NO PAGE RENDERS THE SITE'S NOT-FOUND PAGE, as the browser does for
    // it (`PageRenderer.jsx`), and the data step asks for that page's data (`loadPageData`). No
    // route names it (`/404` is never routable), so this is the only way a route reaches it.
    // A route naming a page served from elsewhere is answered the same way: the host did not
    // proxy it (`resolveRequestedPage`).
    // ⛔ Until 2026-10-26 this answered `notFound` with nothing to send, and a host that wanted
    // the site's page had to fetch its data and render it as a Page itself.
    const resolved = named ?? (typeof target === 'string' ? website.getNotFoundPage() : null)

    // ⛔ Not an error: nothing matched and the site has no not-found page — a genuine 404,
    // and the caller's to turn into one: a build skips it, an isolate sends the shell with a
    // 404 status. Returning `failed` here would make those indistinguishable.
    if (!resolved) return { outcome: 'notFound', html: null, page: null, error: null }

    // ⭐ **THE INDEX-CHILD PROMOTION APPLIES TO BOTH TARGET FORMS** — ruled
    // 2026-09-12 [Diego]. A content-less folder with a designated `isIndex` child
    // renders that child. `Website#getPage` already did this for a ROUTE on its
    // exact-match branches, and nothing did it for an already-resolved Page, so the
    // same page rendered differently depending on which form the caller happened to
    // hold — silently, with no error on either path. `getRenderableSelf` is the one
    // rule for it and now has exactly one caller: here.
    // ⚠️ Guarded on the method rather than assumed: the documented target is a Page,
    // but a caller handing in plain page data should degrade to "render what I gave
    // you", not throw.
    const page = typeof resolved.getRenderableSelf === 'function' ? resolved.getRenderableSelf() : resolved

    // ⭐ A PAGE CAN RESOLVE AND STILL NAME NOTHING: a parametric page whose record does
    // not exist. Core marks it `notFound` only when the data answered definitively
    // (`Website#_createDynamicPage`), never on a failed or missing fetch. It renders the
    // page's own not-found state — a record miss is not a route miss — and the outcome
    // says `notFound` all the same, so a caller keying its status on the outcome sends a
    // not-found response without reading anything new. The site's not-found page, rendered
    // for a route that names no page, is `notFound` the same way. Known before rendering, so
    // it holds even when that render breaks. ⛔ Until 2026-09-30 this was `rendered`, and a
    // host that answered by the outcome sent 200 for a URL naming no record.
    const missing = !named || page?.notFound === true

    // ⭐ EVERY RENDER STARTS FROM THE ACTIVE PAGE THE WEBSITE STARTED WITH (`start-page.js`),
    // then makes active the page the route names, as the browser's boot does (`index.jsx`).
    // `renderPage` then makes the page it renders active by its route, and the not-found page
    // has none: it renders with the page a route served from elsewhere names, as in the browser,
    // or with the start page. ⛔ Until 2026-10-26 it rendered with whatever page this Website
    // rendered last, so on a Website reused across requests its header could show the previous
    // request's page.
    restoreStartPage(website)
    if (typeof target === 'string') website.setActivePage(target)
    // ⭐ The page carries the icons it drew, so the browser's first render draws them too.
    const icons = new Map()
    let result
    try {
      result = whileReadingIcons(globalThis.uniweb, icons, () => renderPage(page, website))
    } catch (err) {
      // `renderPage` handles its own errors, but a foundation can throw from
      // module scope in ways it does not catch. Classify rather than propagate,
      // so one page cannot take down a build loop or an isolate's request.
      return { outcome: missing ? 'notFound' : 'failed', html: null, page, error: classifyRenderError(err) }
    }

    if (result.error) return { outcome: missing ? 'notFound' : 'failed', html: null, page, error: result.error }

    // ⛔ `sectionOverrideCSS` LAST, so a caller's `inject` cannot displace it. It is
    // computed by `renderPage` for this page — theme pinning and component vars —
    // and a caller passing a same-named key would silently drop it, rendering a page
    // that looks fine and is unstyled in exactly the places the author pinned. That
    // is the empty-success shape this module keeps refusing elsewhere; the spread was
    // the other way round for one commit.
    const html = injectPageContent(shell, result.renderedContent, page, {
      ...inject,
      sectionOverrideCSS: result.sectionOverrideCSS,
      icons,
    })
    return { outcome: missing ? 'notFound' : 'rendered', html, page, error: null }
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
 * ⭐ **Since 2026-09-19 it asks what the RENDER will read, block by block** (`loadPageData`),
 * on the Website it is handed: the keys each component declares, the layout the page actually
 * draws, and the transport the site chose for a key. `content` is no longer read — the graph
 * carries everything — and stays in the signature for callers that pass it.
 * ⛔ `prefetchPageData`, which it replaced, worked from the payload alone and could know none of
 * those: it asked for every fetch on every level and still got four cases wrong. It was removed
 * on 2026-09-20.
 *
 * ⛔ The build lane does NOT call this: it runs `loadPageData` itself for each page, with one
 * cache for the whole run (which this entry does not take) and `prerender: 'author'`, and keeps
 * the entries to embed in that page's HTML. That difference is why this is a named isolate
 * helper and not a step inside `render`.
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

  // ⛔ THE TRANSPORT IS REQUIRED, as on every entry a host calls to have the runtime fetch for
  // it: one that did not cross the isolate boundary is refused here, never replaced by the
  // isolate's own network (`require-transport.js`, which records the measurement). Checked here
  // as well as in `loadPageData` so the message names the entry the caller called.
  requireTransport(fetch, 'prefetchAndHydrate')
  // ⛔ `locale` is forwarded to be CHECKED, not applied: the Website is locale-sliced already, so a
  // caller whose two disagree gets an error rather than a page prerendered in one language with the
  // data of another.
  const fetched = await loadPageData({ website, route, fetch, dev, locale, prerender })
  hydrateDataStore(website, fetched)
  return fetched
}
