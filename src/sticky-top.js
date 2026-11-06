/**
 * `--uw-sticky-top` — how far down the viewport the page's stuck chrome reaches.
 *
 * A sticky section with no `top` of its own stays in view below it (`sticky.js`), and kit's
 * anchors land below it — a heading a contents rail scrolls to, a figure a cross-reference links
 * to. Browser-only, run by `components/Layout.jsx`: only a browser knows a box's height, and the
 * height is all that varies — a header that wraps on a phone, an announcement bar above it.
 *
 * ⭐ A MEASUREMENT THE PRERENDER DOES NOT NEED. The offset matters only once something is stuck,
 * which takes scrolling; by then the browser has rendered and measured. A prerendered page, and
 * one read without scripts, keep the variable's fallback.
 *
 * WHAT COUNTS: each box the runtime made sticky for an area (`data-uw-sticky="area"`) that comes
 * before the body and spans over it — a header — but not one that follows it (a footer that
 * sticks never reaches the top) or sits beside it (a rail stuck at the top covers no content). It
 * reaches its `top` plus its height; the variable is the furthest any of them reaches. A rule of
 * position, so it reads no meaning into an area's name (`area-wrappers.js` refuses to for the
 * same reason).
 *
 * ⭐ A HEADER OVER THE OPENING SECTION (`under-header.js`) takes no room in the flow, so its box is
 * as tall as nothing: what it reaches is what it holds, the runtime's own wrappers inside it. Its
 * height is published too, as `--uw-header-measured`, which the opening section's
 * `--uw-header-height` reads in place of the height the header type declared for the first paint.
 */

import { MEASURED_HEADER_HEIGHT } from './under-header.js'

const VARIABLE = '--uw-sticky-top'
const FOLLOWING = 4 // Node.DOCUMENT_POSITION_FOLLOWING

/**
 * The body's sections, by their Block — noted by `components/BlockRenderer.jsx` — so the
 * measurement finds the body by the block it rendered, never by an id: a header's section and a
 * body's can carry the same one.
 */
const bodySections = new WeakMap()

/** Note (or forget, with `null`) the element a body section rendered into. */
export function noteBodySection(block, element) {
  if (!block) return
  if (element) bodySections.set(block, element)
  else bodySections.delete(block)
}

/** The element a body section rendered into, or null. */
export function bodySectionOf(block) {
  return (block && bodySections.get(block)) || null
}

/**
 * How tall a box is drawn: its own height — or, for the header's box over the page's opening
 * section (`data-uw-header="over"`, `under-header.js`), which takes no room in the flow, how far what
 * it holds reaches below its top. What it holds is the runtime's own elements (the area's wrapper,
 * the sections' wrappers), never a guess at a foundation's markup.
 *
 * @param {Element} box
 * @returns {number}
 */
function drawnHeight(box) {
  const own = box.getBoundingClientRect()
  if (box.getAttribute('data-uw-header') !== 'over') return own.height
  let bottom = own.top
  for (const child of box.children) bottom = Math.max(bottom, child.getBoundingClientRect().bottom)
  return bottom - own.top
}

/**
 * How tall the header lying over the page's opening section is, in px — null on a page with none.
 *
 * @param {Document} doc
 * @returns {number|null}
 */
export function measureHeaderOverlay(doc) {
  const box = doc.querySelector('[data-uw-header="over"]')
  // A page under the header whose layout drew no header has no box to measure, and the page's
  // stylesheet pads its section by nothing (`underHeaderProps`).
  return box ? Math.round(drawnHeight(box) * 100) / 100 : null
}

/**
 * How far down the viewport the stuck chrome over the body reaches, in px — 0 when none does.
 *
 * @param {Document} doc
 * @param {Element|null} body - the body's first section
 * @returns {number}
 */
export function measureStickyTop(doc, body) {
  if (!body) return 0
  const over = body.getBoundingClientRect()
  let reach = 0
  for (const box of doc.querySelectorAll('[data-uw-sticky="area"]')) {
    if (box.contains(body)) continue
    if (!(box.compareDocumentPosition(body) & FOLLOWING)) continue // the body comes first: a footer
    const own = box.getBoundingClientRect()
    if (own.right <= over.left || own.left >= over.right) continue // beside the body: a rail
    const top = parseFloat(doc.defaultView.getComputedStyle(box).top) || 0
    reach = Math.max(reach, top + drawnHeight(box))
  }
  return Math.round(reach * 100) / 100
}

/**
 * Keep `--uw-sticky-top` on the root element as the page's stuck chrome changes size, and remove
 * it when nothing over the body sticks.
 *
 * @param {Document} doc
 * @param {Element|null} body - the body's first section
 * @returns {() => void} stops watching, and removes the variable
 */
export function watchStickyTop(doc, body) {
  const root = doc?.documentElement
  if (!root) return () => {}

  const apply = () => {
    const reach = measureStickyTop(doc, body)
    if (reach > 0) root.style.setProperty(VARIABLE, `${reach}px`)
    else root.style.removeProperty(VARIABLE)
    // The header over the opening section: what the section's `--uw-header-height` reads once known.
    const header = measureHeaderOverlay(doc)
    if (header != null) root.style.setProperty(MEASURED_HEADER_HEIGHT, `${header}px`)
    else root.style.removeProperty(MEASURED_HEADER_HEIGHT)
  }
  const forget = () => {
    root.style.removeProperty(VARIABLE)
    root.style.removeProperty(MEASURED_HEADER_HEIGHT)
  }
  apply()

  const View = doc.defaultView
  if (!body || typeof View?.ResizeObserver !== 'function') return forget
  let frame = 0
  const observer = new View.ResizeObserver(() => {
    View.cancelAnimationFrame(frame)
    frame = View.requestAnimationFrame(apply)
  })
  observer.observe(body)
  for (const box of doc.querySelectorAll('[data-uw-sticky="area"]')) observer.observe(box)
  // A box over the opening section keeps no height of its own to change: what it holds does.
  for (const box of doc.querySelectorAll('[data-uw-header="over"]')) for (const child of box.children) observer.observe(child)
  return () => {
    View.cancelAnimationFrame(frame)
    observer.disconnect()
    forget()
  }
}
