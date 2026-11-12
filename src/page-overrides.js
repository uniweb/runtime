/**
 * A PAGE'S SECTION OVERRIDES — one stylesheet, `<style id="uniweb-page-overrides">`, for the
 * section-level CSS of the page on screen: each section's component vars (its type's `meta.js`
 * `vars:` defaults, with the section's own `vars:` over them) and its `theme:` map, built by
 * `buildSectionOverrides` (@uniweb/theming).
 *
 * ⭐ ONE BUILD FOR BOTH RENDERERS, WHATEVER RAN FIRST. A section's component vars are known once its
 * component is (`Block#initComponent`, which reads its type's lean schema), so `pageOverrideCSS`
 * sets up every block it reads, child sections included, before it builds. The prerender
 * (`ssr-renderer.js::renderPage`) asks after rendering the page, and the browser
 * (`PageRenderer.jsx`) before `Layout` renders it; both get the same stylesheet. ⛔ Until
 * 2026-11-12 the browser built it before `Layout` set the blocks up, and kept it until the page
 * changed, so a page's first render in the browser had no component vars: every page under
 * `uniweb dev`, every page reached by a click, and the page a visit started on whenever a section's
 * `theme:` map gave the stylesheet something else to hold, since the browser's then replaced the
 * prerendered one.
 *
 * Renderer-free: the browser and the prerender import it alike.
 */
import { buildSectionOverrides } from '@uniweb/theming'

/** The id of the page's override stylesheet, in a prerendered page's `<head>` and in the browser's. */
export const PAGE_OVERRIDES_ID = 'uniweb-page-overrides'

/**
 * The page's override stylesheet: every block the page renders — its body and each layout area it
 * shows, a sidebar too — with their child sections, each set up first. `''` for a page with nothing
 * to override.
 *
 * @param {import('@uniweb/core').Page} page
 * @param {Object} [appearance] - The site's `appearance` (`website.themeData.appearance`)
 * @returns {string}
 */
export function pageOverrideCSS(page, appearance) {
  const blocks = page.getAllBlocks()
  setUp(blocks)
  return buildSectionOverrides(blocks, appearance)
}

function setUp(blocks) {
  for (const block of blocks || []) {
    block.initComponent()
    if (block.childBlocks?.length) setUp(block.childBlocks)
  }
}

/**
 * Write the page's override stylesheet into the document, for the page the browser has just
 * committed: into the element already there — the one the prerender wrote, at the first commit —
 * else into one placed right after the theme's stylesheet, so a section's rules come after the
 * site's. A page with nothing to override removes it, so a page's rules never outlive it, the
 * prerendered page's included.
 *
 * @param {Document} doc
 * @param {string} css - `pageOverrideCSS`'s answer
 */
export function writePageOverrides(doc, css) {
  let style = doc.getElementById(PAGE_OVERRIDES_ID)
  if (!css) {
    style?.remove()
    return
  }
  if (!style) {
    style = doc.createElement('style')
    style.id = PAGE_OVERRIDES_ID
    const theme = doc.getElementById('uniweb-theme')
    if (theme?.parentNode) theme.parentNode.insertBefore(style, theme.nextSibling)
    else doc.head.appendChild(style)
  }
  if (style.textContent !== css) style.textContent = css
}
