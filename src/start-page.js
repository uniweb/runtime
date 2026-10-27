/**
 * The page a Website starts with as active — recorded when the SSR init builds the graph, and put
 * back before each render (`createPageRenderer`).
 *
 * ⭐ It is what the browser has on a URL that names no page. Core makes the site's index page (or
 * its first page) active when it builds the Website, and neither the boot nor `PageRenderer` makes
 * the not-found page active, since no route names it.
 *
 * ⛔ `renderPage` makes the page it renders active by its route, so for the not-found page it
 * changes nothing, and that page rendered with whatever page the Website rendered last: on a
 * Website reused across requests, the previous request's. Anything that adapts to the active page
 * — a header, a language switcher, a docs sidebar — showed that page.
 *
 * A WeakMap rather than a slot on core's sealed Website: it is SSR state, and core is in every site.
 */
const startPages = new WeakMap()

/** Remember `website`'s active page as the one it starts with. Call it before anything renders. */
export function recordStartPage(website) {
  if (website && !startPages.has(website)) startPages.set(website, website.activePage)
}

/** Make `website`'s start page active again. A Website the SSR init did not build is left alone. */
export function restoreStartPage(website) {
  if (startPages.has(website)) website.activePage = startPages.get(website)
}
