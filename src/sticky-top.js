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
 */

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
    reach = Math.max(reach, top + own.height)
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
  }
  apply()

  const View = doc.defaultView
  if (!body || typeof View?.ResizeObserver !== 'function') {
    return () => root.style.removeProperty(VARIABLE)
  }
  let frame = 0
  const observer = new View.ResizeObserver(() => {
    View.cancelAnimationFrame(frame)
    frame = View.requestAnimationFrame(apply)
  })
  observer.observe(body)
  for (const box of doc.querySelectorAll('[data-uw-sticky="area"]')) observer.observe(box)
  return () => {
    View.cancelAnimationFrame(frame)
    observer.disconnect()
    root.style.removeProperty(VARIABLE)
  }
}
