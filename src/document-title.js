/**
 * The DOCUMENT TITLE — what a browser tab, a bookmark and a search result show for a page.
 *
 * ONE rule, reached two ways (the shape `appearance.js` has for the color scheme):
 *
 *   1. SPA — `useHeadMeta` sets `document.title` on every navigation.
 *   2. Prerendered HTML — `injectPageContent()` in ssr-renderer.js writes `<title>`, for
 *      every prerender lane: the framework's SSG and a host's render alike.
 *
 * ⛔ Until 2026-09-14 each side carried its own rule. The SPA wrote `<page> | <site>` and
 * the prerender wrote `<page>` alone, so every prerendered page changed its title the
 * moment the bundle loaded (`Home` → `Home | Acme`), and a crawler that runs no script
 * indexed the shorter one.
 *
 * `<page title> | <site name>`; the page title alone when the site has no name; the empty
 * string when the page has no title — a caller then leaves the title it already has.
 *
 * @param {string|number|null|undefined} pageTitle - the page's display title (`page.getTitle()`)
 * @param {string|null|undefined} siteName - the site's name (`website.name`)
 * @returns {string}
 */
export function documentTitle(pageTitle, siteName) {
  if (!pageTitle) return ''
  const title = String(pageTitle)
  return siteName ? `${title} | ${siteName}` : title
}
