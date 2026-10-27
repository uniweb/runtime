import { FONT_LINKS_MARKER } from '@uniweb/theming'

/**
 * Give a page the theme's font links when it arrived without them.
 *
 * A built page carries them in its `<head>` (`@uniweb/build`), and so does a prerendered
 * one (`injectPageContent` in `ssr-renderer.js`). A host that serves the shell alone and
 * leaves every page to the browser carries neither. `ensureThemeCss` computes the links
 * onto the graph for such a lane, but nothing put them on the page: the browser added the
 * theme's CSS (`ThemeProvider`) and never its fonts, so every family the theme imports
 * fell back to a system face. This is the browser's half of the prerender's font block,
 * deduped on the same marker, so a page that already has them is left alone.
 *
 * @param {object} themeData - `website.themeData`, with the `links` block `@uniweb/theming` generated
 * @param {Document|null} [doc]
 * @returns {boolean} whether it added them
 */
export function injectFontLinks(themeData, doc = typeof document === 'undefined' ? null : document) {
  const head = doc?.head
  if (!head || !themeData?.links || head.innerHTML.includes(FONT_LINKS_MARKER)) return false
  head.insertAdjacentHTML('beforeend', `${FONT_LINKS_MARKER}\n${themeData.links}`)
  return true
}
