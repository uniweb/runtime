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
 * paint itself see-through, and its box says `data-uw-header="over"` for a stylesheet.
 */

/** The header's height, on the opening section's wrapper: what its content is padded by. */
export const HEADER_HEIGHT = '--uw-header-height'

/** What the browser measured, on the root, which the opening section's value defers to. */
export const MEASURED_HEADER_HEIGHT = '--uw-header-measured'

/**
 * Whether the page's header lies over its opening section, and how tall the header is before the
 * browser measures it: the `height` its sections' types declare, else `0px` until measured.
 *
 * @param {Object} page - its blocks' components initialized, as both renderers do before rendering
 * @returns {{ height: string }|null}
 */
export function headerOverlay(page) {
  const first = page?.getBodyBlocks?.()?.[0]
  if (!first?.underHeader) return null
  const header = page.getLayoutAreas?.()?.header
  if (!Array.isArray(header) || header.length === 0) return null
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
 * What the opening section's wrapper adds when the header lies over it: the header's height, the
 * declared one until the browser has measured it.
 *
 * @param {{ height: string }} overlay - `headerOverlay(page)`
 * @returns {{ style: Object, 'data-uw-under-header': string }}
 */
export function underHeaderProps(overlay) {
  return {
    style: { [HEADER_HEIGHT]: `var(${MEASURED_HEADER_HEIGHT}, ${overlay.height})` },
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
