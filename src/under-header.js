/**
 * The header laid over a page's opening section — `underHeader`, a setting of the section.
 *
 * A page that opens with a section that can sit under the header (`underHeader: true`: its type's
 * default in `meta.js`, or its author's) has the header lie over it. The header's box takes no room
 * in the flow, so the section starts at the top of the window and its picture reaches up behind a
 * see-through header; the header keeps its own height inside that box, and stays in view if it
 * sticks. Pure, so both renderers (`components/Layout.jsx`, `ssr-renderer.js`) build the same page,
 * and the browser's measurement (`sticky-top.js`) reads the same boxes.
 *
 * ⭐ THE RUNTIME DOES IT, AS IT DOES `sticky`, because a component cannot move the box the runtime
 * puts it in. Foundations that floated a header from inside its own section took the bar out of
 * the flow (`absolute`, `fixed`), which left the box the runtime measures with no height: no
 * `--uw-sticky-top`, and a link to a section landing under the bar (measured 2026-11-06 on a site's
 * store page, in Chromium and WebKit). Five sites solved it five ways.
 *
 * The opening section keeps its content clear of the header by `--uw-header-height`, which the
 * runtime gives its wrapper: the header type's `height` on the first paint, which no prerender can
 * measure, then what the browser measures. The header reads `getNextBlockInfo().underHeader` to
 * paint itself see-through, and its box says `data-uw-header="over"` for a stylesheet. Its type
 * says `background: 'self'` and paints its own bar: otherwise the theme paints the header's section
 * with its surface, a solid band over the opening section (measured 2026-11-06).
 */

/** The header's height, on the opening section's wrapper: what its content is padded by. */
export const HEADER_HEIGHT = '--uw-header-height'

/** What the browser measured, on the root, which the opening section's value defers to. */
export const MEASURED_HEADER_HEIGHT = '--uw-header-measured'

/** The header types' declared height, on the opening section's wrapper: the value before measuring. */
export const DECLARED_HEADER_HEIGHT = '--uw-header-declared'

/**
 * Whether the page's header lies over its opening section, and how tall the header is before the
 * browser measures it: the `height` its sections' types declare, else `0px` until measured.
 *
 * @param {Object} page - its blocks' components initialized, as both renderers do before rendering
 * @returns {{ height: string }|null}
 */
export function headerOverlay(page) {
  const first = page?.getBodyBlocks?.()?.[0]
  if (!first?.liesUnderHeader?.()) return null
  const header = page.getLayoutAreas().header
  const heights = header.map((block) => block?.height).filter(Boolean)
  const height = heights.length === 0 ? '0px' : heights.length === 1 ? heights[0] : `calc(${heights.join(' + ')})`
  return { height }
}

/**
 * The props of the header's box — the built-in layout's zone, or a foundation layout's area
 * wrapper — when it lies over the opening section: it takes no room in the flow, and what it holds
 * keeps its height. Whatever else the box has (its layer, its stickiness) stays.
 *
 * @param {Object|null} props - the box's props without the overlay
 * @returns {Object}
 */
export function overlayBoxProps(props) {
  return { ...(props || {}), style: { ...(props?.style || {}), height: 0, minHeight: 0 }, 'data-uw-header': 'over' }
}

/**
 * The boxes a foundation layout's header area is drawn in, the same in both renderers.
 *
 * ⭐ THE SAME ELEMENTS ON EVERY PAGE. Between a page whose opening section lies under the header and
 * one with none, only styles change, so React keeps the header mounted, with its state: a search
 * box's words, a menu, an animation that ran once. So the area always has its wrapper — its layer
 * and stickiness, collapsed on a page under the header, and `display: contents`, no box at all,
 * where it has nothing to carry (a layout that ranks its own stacking and a header that neither
 * sticks nor is named). ⛔ For part of 2026-11-06 a wrapper appeared only on a page under the
 * header there, and React rebuilt the header on each move between the two kinds of page.
 *
 * ⭐ THE NAME A LAYOUT ASKS FOR GOES ON AN ELEMENT INSIDE THE WRAPPER, which keeps the header's
 * height on every page. A named box is captured at its own size, and one with no height is captured
 * as nothing, so on the collapsed wrapper the header was gone for the length of a page switch; the
 * element inside is the header's extent everywhere, and two pages' headers pair as the layout means.
 * ⛔ For part of 2026-11-06 a collapsed wrapper dropped the name instead, which quietly ignored what
 * the layout asked for on exactly those pages.
 *
 * @param {Object|null} wrapper - the area wrapper's props (`areaWrapperProps`), its name included
 * @param {{ height: string }|null} overlay - `headerOverlay(page)`
 * @returns {{ outer: Object, inner: Object|null }} the wrapper's props, and the named element's
 */
export function headerAreaProps(wrapper, overlay) {
  const { viewTransitionName, ...style } = wrapper?.style || {}
  const inner = viewTransitionName ? { style: { viewTransitionName } } : null
  const base = { ...(wrapper || {}), style }
  if (overlay) return { outer: overlayBoxProps(base), inner }
  return { outer: Object.keys(style).length ? base : { ...base, style: { display: 'contents' } }, inner }
}

/**
 * What the opening section's wrapper adds when the header lies over it: the header type's declared
 * height, and the mark the page's stylesheet keys on.
 *
 * ⭐ THE STYLESHEET GIVES THE SECTION ITS `--uw-header-height` (`@uniweb/theming`): what the browser
 * measured, else the declared height, on a page where a header box lies over it
 * (`[data-uw-header="over"]`), and `0px` on one where none does — a layout that draws no header on
 * the page. A rule rather than this style, since only the rendered page holds that answer, and so
 * the first paint, the prerender's included, pads by what is there. ⛔ Until 2026-11-06 the section
 * was padded by the declared height whatever the layout drew, until the browser measured.
 *
 * @param {{ height: string }} overlay - `headerOverlay(page)`
 * @returns {{ style: Object, 'data-uw-under-header': string }}
 */
export function underHeaderProps(overlay) {
  return {
    style: { [DECLARED_HEADER_HEIGHT]: overlay.height },
    'data-uw-under-header': '',
  }
}

/**
 * Whether `block` is its page's opening section under the header — what its wrapper asks before it
 * adds `underHeaderProps`.
 *
 * @param {Object} block - a body section's block, its component initialized
 * @returns {{ height: string }|null} the page's overlay, when it opens with this section
 */
export function openingUnderHeader(block) {
  const page = block?.page
  if (!page || page.getBodyBlocks?.()?.[0] !== block) return null
  return headerOverlay(page)
}
