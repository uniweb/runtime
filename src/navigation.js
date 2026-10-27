/**
 * In-app navigation: what the runtime does between a click and the next page.
 *
 * Every navigation the runtime makes goes through `navigateInApp`. That covers kit's `<Link>` and
 * `useNavigate()` (the routing components `setup.js` registers) and a link in prose
 * (`useLinkInterceptor`). It is one function so the two paths cannot decide differently again.
 *
 * ⭐ **The current page is held until the next one can be shown, content and data.** On a site
 * whose content is split, a page not visited yet has no sections until its content file arrives,
 * and `PageRenderer` renders nothing for its body until then. A section that reads data asks for it
 * only once it has rendered (`BlockRenderer`), and shows its loading state until the answer arrives.
 * So both are asked first, while the current page stays on screen and usable:
 * - the content;
 * - then, its sections known, what they will read, by the plan their render runs (`EntityStore`).
 *
 * Only what is not held is asked. A block the cache answers already is passed over, and within a
 * block the dispatcher answers what it holds and joins what is in flight. The router is told once
 * the content and data are here, or after `HOLD_TIMEOUT`. That holds for every visitor: it depends
 * on neither the View Transitions API nor a motion preference.
 *
 * ⭐ **The animation is a layer on the swap.** The swap runs inside
 * `document.startViewTransition` when four things hold: view transitions are on
 * (`website.viewTransitions`, on unless the foundation says `false`), the browser has the API,
 * the visitor has no reduced-motion preference, and the next page's content is here. The update
 * callback resolves once the router has committed the new page (`nextPageCommit`). React Router
 * commits a navigation inside `React.startTransition`, after `navigate()` has returned. A callback
 * that resolved when `navigate()` did had the browser capture the old page as the new one.
 *
 * ⛔ **Until 2026-10-27 the two paths decided differently**, and neither held the page right:
 * - `setup.js` read `foundationConfig.viewTransitions` as an opt-in, which
 *   `Website#viewTransitions` stopped being on 2026-04-11. So a `<Link>` neither animated nor
 *   waited for the content, and on a split site its body went blank until the content arrived
 *   (measured on two docs sites: 160–330 ms).
 * - A prose link waited inside the transition, with the page frozen, and its callback resolved
 *   before the commit, so the crossfade went from the old page to itself.
 * - A route carrying a query or a fragment found no page to wait for (`Website#getPage` takes a
 *   path).
 * - A reduced-motion preference skipped the wait along with the animation.
 *
 * Later that day the hold took in the page's data. Until then the page was held for its content
 * alone, and a section reading data showed its loading state after the swap. Measured on a site's
 * blog: its content was in at 331 ms, its data was asked only after the render, and the list
 * showed at 582 ms.
 */

import { getComponentMeta } from './prepare-props.js'
import { blocksOf } from './page-blocks.js'

/** How long a navigation holds the current page for the next one's content and data. */
const HOLD_TIMEOUT = 1000

/**
 * How long a view transition waits for the router to commit. A navigation that commits nothing
 * then cannot hold the frozen page until the browser gives up on it.
 */
const COMMIT_TIMEOUT = 1000

/** Read once, when the runtime loads. */
export const prefersReducedMotion =
  typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The page a navigation target names, found by its path: `Website#getPage` takes no query or
 * fragment, and a docs link names a fragment as often as not.
 *
 * @param {string|Object} to - a router path, or `navigate`'s `{ pathname }`
 * @returns {import('@uniweb/core').Page|null}
 */
function pageAt(to) {
  const website = globalThis.uniweb?.activeWebsite
  const route = typeof to === 'string' ? to : to?.pathname
  if (!route || !website) return null
  return website.getPage(route.split(/[?#]/)[0]) || null
}

/** Whether `page`'s content can be shown now: `PageRenderer`'s own test. */
function isReady(page) {
  return !page || !page.hasContent() || page.isContentLoaded()
}

/**
 * Whether the site declares a query. Data comes from a named query (`config.queries`), so a site
 * that declares none reads none, and its pages are not walked for it.
 *
 * @param {Object|null|undefined} website
 * @returns {boolean}
 */
export function readsData(website) {
  const queries = website?.config?.queries
  return !!queries && typeof queries === 'object' && Object.keys(queries).length > 0
}

/**
 * Ask what `page`'s render will read and the cache does not hold: off a parametric page, the
 * page's own record, which names it; and each block's data, by the same call the renderer makes
 * after mount (`EntityStore.fetch`).
 *
 * @param {Object} page - its content here
 * @returns {Promise|undefined} undefined when nothing was asked
 */
function dataOf(page) {
  const website = page.website
  const store = website?.entityStore
  if (!store || !readsData(website)) return
  const asks = []
  if (page.dynamicContext) asks.push(store.fetchPageRecord(page))
  for (const block of blocksOf(page)) {
    const meta = getComponentMeta(block.type)
    if (store.resolve(block, meta).status === 'pending') asks.push(store.fetch(block, meta))
  }
  return asks.length ? Promise.all(asks) : undefined
}

/**
 * The wait for what `page`'s render reads and is not here yet: its split content, then, its
 * sections known, their data.
 *
 * @param {Object|null} page
 * @returns {Promise|undefined} undefined when it is all here
 */
function loadPage(page) {
  if (!page) return
  if (!isReady(page)) return page.loadContent().then(() => dataOf(page))
  return dataOf(page)
}

/** `wait`, or the end of HOLD_TIMEOUT, whichever comes first. */
function bounded(wait) {
  return Promise.race([wait, new Promise((resolve) => setTimeout(resolve, HOLD_TIMEOUT))])
}

/**
 * Fetch the split content of the page `route` names, giving up after HOLD_TIMEOUT. Undefined when
 * there is nothing to fetch: no such page, a page with no content, or one already loaded.
 *
 * @param {string} route - a router path; a query or fragment is ignored
 * @returns {Promise|undefined}
 */
export function prefetchContent(route) {
  const page = pageAt(route)
  if (isReady(page)) return
  return bounded(page.loadContent())
}

/**
 * Fetch what the page `route` names will read when it is shown, its split content and then its
 * data, ahead of a navigation to it (`link-intent.js`). Nothing waits on it: what arrives is held
 * for the render, and a request that fails is the navigation's to make again.
 *
 * @param {string} route - a router path; a query or fragment is ignored
 * @returns {Promise|undefined} undefined when it is all here
 */
export function prefetchPage(route) {
  return loadPage(pageAt(route))?.catch(() => {})
}

// The navigation the next swap belongs to. A later navigation supersedes one still waiting for
// its page, so a slow page reached by an earlier click cannot replace the page clicked last.
let latest = 0

/**
 * Navigate in the app. The current page is held until the next one's content and data are here,
 * then the pages are swapped, animated when view transitions apply.
 *
 * @param {Function} navigate - React Router's `navigate`
 * @param {string|Object|number} to - where to, as `navigate` takes it
 * @param {Object} [options] - `navigate`'s options
 */
export function navigateInApp(navigate, to, options) {
  const ticket = ++latest
  const page = pageAt(to)

  const swap = () => {
    if (ticket !== latest) return
    const website = globalThis.uniweb?.activeWebsite
    // A page whose content is still not here after the wait goes without the animation: a
    // crossfade to an empty body would only draw out the wait.
    const animate = isReady(page) && website?.viewTransitions
      && typeof document !== 'undefined' && document.startViewTransition && !prefersReducedMotion
    if (!animate) {
      navigate(to, options)
      return
    }
    const transition = document.startViewTransition(() => {
      // Asked before navigating: a router that commits synchronously settles it from inside `navigate`.
      const committed = nextPageCommit()
      navigate(to, options)
      return committed
    })
    // A transition the browser skips, for a duplicate `view-transition-name` or a newer
    // transition, still runs its callback, so the page is swapped all the same. The browser
    // reports the reason itself.
    transition.ready.catch(() => {})
  }

  const pending = loadPage(page)
  // A request that fails still navigates: the page then shows what it has, as it renders it.
  if (pending) bounded(pending).then(swap, swap)
  else swap()
}

const commitWaiters = new Set()

/**
 * A promise settled when `PageRenderer` next commits a page, or after COMMIT_TIMEOUT.
 *
 * @returns {Promise<void>}
 */
function nextPageCommit() {
  return new Promise((resolve) => {
    const settle = () => {
      clearTimeout(timer)
      commitWaiters.delete(settle)
      resolve()
    }
    const timer = setTimeout(settle, COMMIT_TIMEOUT)
    commitWaiters.add(settle)
  })
}

/**
 * Called by `PageRenderer` from a layout effect, once the DOM holds the page the router
 * committed and before the browser paints it. That is the moment a view transition may capture
 * it. It has no SSR twin, since the prerender makes no navigation.
 */
export function pageCommitted() {
  for (const settle of [...commitWaiters]) settle()
}
