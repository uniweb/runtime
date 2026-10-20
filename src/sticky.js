/**
 * Where a section's `sticky` setting lands — pure, so the browser's renderer
 * (`components/Layout.jsx`, `BlockRenderer.jsx`) and the prerender's (`ssr-renderer.js`) make the
 * same boxes sticky, and a prerendered page does not change when the browser renders over it.
 *
 * ⭐ NO BOX A COMPONENT DRAWS CAN STICK. `position: sticky` moves an element only within its
 * parent's box, and a component's markup sits in boxes as tall as itself: the section's wrapper,
 * the layout area's wrapper (`area-wrappers.js`), the built-in layout's zone (`default-layout.js`).
 * So a section asks — `sticky:`, one of a section's own settings (`@uniweb/schemas/section`),
 * defaulted by its type's `meta.js` — and the runtime makes sticky the box that can:
 *
 *   - in the body, the section's own wrapper, whose parent, the body, spans every section;
 *   - in any other area, the area's box when any of its sections is sticky: the zone, in the
 *     built-in layout; the area wrapper, in a foundation's layout. That box takes the area's
 *     layer, and a sticky area's layer is above every area that scrolls under it
 *     (`resolveLayoutLayers`).
 *
 * ⛔ A layout that wraps an area in an element of its own confines the area wrapper, as the zone
 * does in the built-in layout. That element is the layout's, so the layout makes it sticky, when
 * `page.isSticky(area)`.
 *
 * ⛔ Until 2026-10-19 there was no setting, and a header's own `sticky top-0` — the starter
 * templates' — scrolled away with the page.
 */

/** The very top of the viewport — a sticky box with no `top` of its own. */
export const STICKY_TOP = '0px'

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
 * The style a sticky section's own wrapper takes, in the body — or null. Layer 1, so it paints
 * over the sections after it, which are positioned only when they have a background.
 *
 * @param {Object} block - its component initialized
 * @returns {Object|null}
 */
export function sectionStickyStyle(block) {
  return block?.sticky ? stickyStyle(block.stickyTop, 1) : null
}
