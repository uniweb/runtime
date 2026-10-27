/**
 * WHICH PAGE A ROUTE NAMES — the one lookup, importable without a renderer.
 *
 * ⭐ **It is one line, and it is a module because of who imports it.** `ssr-renderer.js` imports
 * `react-dom/server` at module scope, so anything reaching for this lookup through that file drags
 * the React server renderer into its own graph. The render's data step (`load-page-data.js`)
 * fetches and renders nothing, and did exactly that until 2026-09-20 — for `website.getPage`.
 *
 * ⚠️ **The docstring below already said "no React … safe in a Worker isolate", and was right.** It
 * was the FILE that made it false, which is the shape to watch for: a claim about a function's
 * dependencies is a claim about its module's imports, and nothing checks the two agree.
 * `tests/data-step-graph.test.js` checks it for the one caller that needs it.
 *
 * @module
 */

/**
 * Resolve a route to the Page that should render it.
 *
 * Exists because `ssr-renderer.js` exported `renderPage(page, …)` and no supported way
 * to *get* a page — so every host rendering server-side wrote its own lookup,
 * and the obvious one (`website.pages.find(p => p.route === route)`) cannot
 * match a dynamic route, because the payload holds `/blog/:id` and the request
 * carries `/blog/1`. One host wrote that lookup three times in three files
 * before the gap was noticed. A renderer that takes a Page owes callers a Page.
 *
 * ⛔ Move it, never copy it: a second lookup here would be the fourth.
 *
 * This is `Website#getPage` — the same seven-step resolution the browser runs,
 * literally the same function, so a server-rendered page and the one hydrating
 * over it cannot disagree. Pure `@uniweb/core`: no React, no DOM, no DataStore
 * required, safe in a Worker isolate.
 *
 * @param {Website} website
 * @param {string} route - The requested path, e.g. `/blog/1`
 * @returns {Page|undefined} The page, or undefined when nothing matches — which
 *   is a genuine 404 and the caller's to turn into one.
 */
export function resolvePage(website, route) {
  return website.getPage(route)
}

/**
 * The page a request for `route` renders, for the doors that render the page a visit starts on
 * (`createPageRenderer`, and its data step `loadPageData`): `resolvePage`, except a page served from
 * elsewhere.
 *
 * ⭐ A page with `rewrite:` is the host's to proxy, before the app loads. A request for one that
 * reaches a renderer was not proxied, so the doors answer it as the browser's first load of it does
 * (`PageRenderer.jsx`): with the site's not-found page, as a static build emits no file there.
 * ⛔ Until 2026-10-27 they rendered that page's own content as an ordinary page, and the browser
 * replaced it with the not-found page at boot.
 *
 * @param {Website} website
 * @param {string} route - The requested path
 * @returns {Page|undefined} undefined when the route names no page, or a page served from elsewhere
 */
export function resolveRequestedPage(website, route) {
  return website.resolveRoute(route).kind === 'rewrite' ? undefined : resolvePage(website, route)
}
