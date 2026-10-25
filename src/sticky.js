/**
 * Where a section's `sticky` setting lands — pure, so the browser's renderer
 * (`components/Layout.jsx`, `BlockRenderer.jsx`) and the prerender's (`ssr-renderer.js`) make the
 * same boxes sticky, and a prerendered page does not change when the browser renders over it.
 *
 * ⭐ A COMPONENT'S OUTERMOST ELEMENT CANNOT STICK. `position: sticky` moves an element only within
 * its parent's box, and a component sits in boxes as tall as itself: the section's wrapper, the
 * layout area's wrapper (`area-wrappers.js`), the built-in layout's zone (`default-layout.js`). (An
 * element inside a component can stick within a taller box the component draws — a side panel in
 * the row beside a list — which is the component's own layout and asks nothing of this module.)
 * So a section asks — `sticky:`, one of a section's own settings (`@uniweb/schemas/section`),
 * defaulted by its type's `meta.js` — and the runtime makes sticky the box that can:
 *
 *   - in the body, the section's own wrapper, whose parent, the body, spans every section;
 *   - a child section rendered as a section (`<ChildBlocks wrapAs>`, kit's `ChildGrid`), its own
 *     wrapper too, which then stays in view within the box its parent places it in — in
 *     `ChildGrid`, its cell, as tall as the row — and no further. Top-aligned, so a flex or grid
 *     item has room. At one column (a phone) a child is its own row and does not stick, which is
 *     what a side panel stacked under the content should do;
 *   - in any other area, the area's box when any of its sections is sticky: the zone, in the
 *     built-in layout; the area wrapper, in a foundation's layout. That box takes the area's
 *     layer, and a sticky area's layer is above every area that scrolls under it
 *     (`resolveLayoutLayers`).
 *
 * ⭐ A section stays in view BELOW what is stuck at the top. A sticky area sticks at `0px`; a
 * sticky section with no `top` of its own sticks at `--uw-sticky-top`, how far down the page's
 * stuck chrome reaches, which the browser measures (`sticky-top.js`) — so a side panel or a
 * sub-navigation clears a stuck header whatever its height. Unmeasured — a prerendered page
 * before the browser runs, a page with nothing stuck — it is `0px`.
 *
 * Every box this module makes sticky says so, `data-uw-sticky` = `area`, `section` or `child`,
 * for what reads them in the browser: the measurement, and `uniweb dev`'s check
 * (`sticky-check.js`).
 *
 * ⛔ A layout that wraps an area in an element of its own confines the area wrapper, as the zone
 * does in the built-in layout. That element is the layout's, so the layout makes it sticky, when
 * `page.isSticky(area)`.
 *
 * ⛔ Until 2026-10-19 there was no setting, and a header's own `sticky top-0` — the starter
 * templates' — scrolled away with the page. Until 2026-10-20 a child section's setting did
 * nothing, and a sticky section stuck at `0px`, under a stuck header.
 */

/** The very top of the viewport — a sticky area with no `top` of its own. */
export const STICKY_TOP = '0px'

/**
 * Where a sticky section with no `top` of its own stays: below what is stuck at the top
 * (`sticky-top.js` measures it), else the very top.
 */
export const STICKY_SECTION_TOP = 'var(--uw-sticky-top, 0px)'

/**
 * The style that keeps a box in view.
 *
 * @param {string|null} [top] - how far below the viewport's top, a CSS length
 * @param {number|null} [zIndex] - its layer, when it has one
 * @returns {{ position: 'sticky', top: string, zIndex?: number }}
 */
export function stickyStyle(top, zIndex) {
  const style = { position: 'sticky', top: top || STICKY_TOP }
  if (zIndex != null) style.zIndex = zIndex
  return style
}

/**
 * Whether an area stays in view — when any of its sections is sticky — and how far below the
 * top: the first sticky section's.
 *
 * @param {Array<Object>|null|undefined} blocks - the area's blocks, their components initialized
 * @returns {{ top: string }|null}
 */
export function areaStickiness(blocks) {
  const first = (blocks || []).find((block) => block?.sticky)
  return first ? { top: first.stickyTop || STICKY_TOP } : null
}

/**
 * Each layout area's stickiness, read from its sections — what both renderers compute before the
 * areas' layers, since a sticky area is lifted above the rest (`resolveLayoutLayers`).
 *
 * @param {Object<string, Array<Object>>} areas - area name → its blocks, their components initialized
 * @returns {Object<string, { top: string }|null>}
 */
export function layoutStickiness(areas) {
  const sticky = {}
  for (const [name, blocks] of Object.entries(areas || {})) sticky[name] = areaStickiness(blocks)
  return sticky
}

/**
 * The props a built-in layout zone takes when its area sticks — or null.
 *
 * @param {{ top: string }|null|undefined} stickiness - the area's (`areaStickiness`)
 * @param {number|null} [layer] - the area's layer (`resolveLayoutLayers`)
 * @returns {{ style: Object, 'data-uw-sticky': 'area' }|null}
 */
export function zoneProps(stickiness, layer) {
  return stickiness ? { style: stickyStyle(stickiness.top, layer), 'data-uw-sticky': 'area' } : null
}

/**
 * The style a sticky section's own wrapper takes — a body section's, or a child section's — or
 * null. Below what is stuck at the top unless its type says how far down; layer 1, so it paints
 * over the sections after it, which are positioned only when they have a background; and
 * top-aligned, so that as a flex or grid item it is not stretched to the row, which would leave
 * it no room to move (in normal flow `align-self` does nothing).
 *
 * @param {Object} block - its component initialized
 * @returns {Object|null}
 */
export function sectionStickyStyle(block) {
  return block?.sticky ? { ...stickyStyle(block.stickyTop || STICKY_SECTION_TOP, 1), alignSelf: 'start' } : null
}

/**
 * Whether any area of a page's layout sticks — its sections' components initialized, as both
 * renderers do before they render.
 *
 * @param {Object} page
 * @returns {boolean}
 */
export function hasStickyArea(page) {
  const areas = page?.getLayoutAreas?.() || {}
  return Object.values(areas).some((blocks) => areaStickiness(blocks) !== null)
}

/**
 * Where a link to a section lands — below what is stuck at the top, `--uw-sticky-top` — given to a
 * body section's box, and a child section's, on a page whose layout has a sticky area. A link to
 * `#section-…` (a search result, a contents entry, a pasted deep link) scrolls the section's top
 * edge to the top of the viewport, and without the margin the stuck header covers it — measured
 * 2026-10-20: a section's top at 0px under an 80px header, at 80px with the margin. On other pages
 * the markup is unchanged, and unmeasured the margin is `0px`.
 *
 * @param {Object} block - its component initialized
 * @param {'section'|'child'|boolean} kind - a body section's box, or a child section's; else none
 * @returns {{ scrollMarginTop: string }|null}
 */
export function sectionScrollMargin(block, kind) {
  return kind && hasStickyArea(block?.page) ? { scrollMarginTop: STICKY_SECTION_TOP } : null
}

/**
 * What a section's wrapper adds when it sticks: its style, and which kind of box it is.
 *
 * @param {Object} block - its component initialized
 * @param {'section'|'child'|boolean} kind - a body section (`true` reads as one), or a child section
 * @returns {{ style: Object, 'data-uw-sticky': string }|null}
 */
export function sectionStickyProps(block, kind) {
  const style = kind ? sectionStickyStyle(block) : null
  return style ? { style, 'data-uw-sticky': kind === 'child' ? 'child' : 'section' } : null
}
