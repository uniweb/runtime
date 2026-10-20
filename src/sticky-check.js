/**
 * `uniweb dev`'s warning about a sticky element that cannot move — browser-only, run by
 * `components/Layout.jsx` behind `import.meta.env.DEV`, so a published page's runtime drops it.
 *
 * `position: sticky` keeps an element inside its parent's box. When the parent is no taller than
 * the element (no wider, for one that sticks sideways), the element has no room and scrolls away
 * with the page, and nothing says so. The two ways it happens:
 *
 *   - a component's own `sticky top-0`: a section's markup sits in boxes as tall as itself, so it
 *     never moves. The section's `sticky: true` asks the runtime to make sticky the box that can
 *     (`sticky.js`).
 *   - a layout that wraps a sticky area in an element of its own, which confines the area's box.
 *     The layout makes its element sticky when `page.isSticky(area)`.
 *
 * Table parts are left out: a sticky table header cell sticks within its table, though its row is
 * no taller than it is.
 */

const warned = new WeakSet()

/** The nearest ancestor that draws a box — `display: contents` draws none. */
function boxParent(el) {
  let parent = el.parentElement
  while (parent && getComputedStyle(parent).display === 'contents') parent = parent.parentElement
  return parent
}

/**
 * Whether a sticky element has room to move in the direction it sticks.
 *
 * @param {Element} el
 * @returns {boolean}
 */
export function canStick(el) {
  const style = getComputedStyle(el)
  if (style.display.startsWith('table')) return true
  const parent = boxParent(el)
  if (!parent) return true
  const own = el.getBoundingClientRect()
  const room = parent.getBoundingClientRect()
  const vertical = style.top !== 'auto' || style.bottom !== 'auto'
  const horizontal = style.left !== 'auto' || style.right !== 'auto'
  return (vertical && room.height > own.height + 0.5) || (horizontal && room.width > own.width + 0.5)
}

/**
 * Warn, once per element, about each sticky element on the page that cannot move.
 *
 * @param {Document} [doc]
 * @returns {() => void} cancels a check not yet run
 */
export function warnUnmovableSticky(doc = globalThis.document) {
  if (!doc?.body || typeof requestAnimationFrame !== 'function') return () => {}
  const frame = requestAnimationFrame(() => {
    for (const el of doc.body.querySelectorAll('*')) {
      if (warned.has(el) || getComputedStyle(el).position !== 'sticky' || canStick(el)) continue
      warned.add(el)
      console.warn(
        '[uniweb] This element is sticky but cannot move: its parent is no taller than it is, so it ' +
          'scrolls away with the page. To keep a section in view, give the section `sticky: true` ' +
          '(its type may default it in meta.js) — no box a component draws can stick. A layout that ' +
          'wraps an area in an element of its own makes that element sticky when `page.isSticky(area)`.',
        el,
      )
    }
  })
  return () => cancelAnimationFrame(frame)
}
