/**
 * `uniweb dev`'s warning about a sticky element that cannot move — browser-only, run by
 * `components/Layout.jsx` behind `import.meta.env.DEV`, so a published page's runtime drops it.
 *
 * `position: sticky` keeps an element inside its parent's box. When the parent is no taller than
 * the element (no wider, for one that sticks sideways), the element has no room and scrolls away
 * with the page, and nothing says so. Whose box the parent is says what to do (`unmovableAdvice`):
 *
 *   - a component's outermost element — a header's own `sticky top-0` — sits in the section's
 *     wrapper, as tall as itself, so it never moves. The section's `sticky: true` asks the runtime
 *     to make sticky the box that can (`sticky.js`).
 *   - a box the runtime made sticky (`data-uw-sticky`) in an element a layout wraps it in, which
 *     confines it. The layout makes its element sticky when `page.isSticky(area)`.
 *   - an element inside a component sits in a box the component draws. A side panel beside a list
 *     sticks within the row the two share, and cannot when its box is only as tall as the panel:
 *     the fix is the component's, to give that box room or make it the sticky one.
 *
 * ⭐ MEASURED ON THE SETTLED PAGE. A box's height can wait on the page's data — a list fills its
 * column once its records arrive — so the check runs once nothing is in flight (the layout passes
 * `website.dataStore.whenIdle` as `settled`), after the page's fonts, in the frames after that:
 * React has committed what arrived, and the browser has laid it out. ⛔ Until 2026-10-25 it
 * measured in the first frame after the page mounted, while the page's fetches were still out,
 * and named a side panel whose column was waiting for its records as one that could never move.
 *
 * Table parts are left out: a sticky table header cell sticks within its table, though its row is
 * no taller than it is. So is a child section the runtime made sticky (`data-uw-sticky="child"`):
 * with no room — stacked at one column, or the tallest in its row — it does not stick, by design.
 *
 * And an element that sits in a box that CLIPS — `overflow: hidden`, or `overflow-x: hidden`
 * alone, which makes the box scroll vertically too — sticks to that box in place of the page,
 * and the box does not scroll, so it never moves. Components clip for rounded corners; the
 * warning names `overflow: clip`, which clips and keeps it sticking. A box that really scrolls
 * (a layout's own scrolling `<main>`) is the element's scroller, and is left alone.
 */

const warned = new WeakSet()

/** Every section wrapper the browser's renderer drew, noted in dev (`BlockRenderer.jsx`). */
const sectionWrappers = new WeakSet()

/** How long the check waits on the page's fetches before it measures anyway. */
const SETTLE_CAP_MS = 10_000

/**
 * Note a section's wrapper, so the check can tell a component's outermost element — the one in
 * it — from an element inside a component. A ref callback's argument: null on unmount.
 *
 * @param {Element|null} element
 */
export function noteSectionWrapper(element) {
  if (element) sectionWrappers.add(element)
}

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
 * The box a sticky element would stick to in place of the page, because it clips its overflow
 * without scrolling — or null. Looks no further than the nearest box with an overflow of its own:
 * one that scrolls is the element's scroller, which is fine. Stops below `<body>`, whose overflow
 * is the viewport's.
 *
 * @param {Element} el
 * @returns {Element|null}
 */
export function clippingAncestor(el) {
  const doc = el.ownerDocument
  for (let node = el.parentElement; node && node !== doc?.body && node !== doc?.documentElement; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node)
    if (overflowY === 'visible' || overflowY === 'clip') continue
    if (overflowY === 'hidden') return node
    // `auto` / `scroll`: a scroller — unless it is only `overflow-x: hidden`'s side effect.
    const scrolls = node.scrollHeight > node.clientHeight + 1
    return overflowX === 'hidden' && !scrolls ? node : null
  }
  return null
}

/**
 * What to do about a sticky element that cannot move, by whose box holds it (see above).
 *
 * @param {Element} el
 * @returns {string}
 */
export function unmovableAdvice(el) {
  if (el.getAttribute('data-uw-sticky')) {
    return (
      'It is the box the runtime makes sticky for a section, and an element of the layout around it ' +
      'confines it: a layout that wraps an area in an element of its own makes that element sticky ' +
      'when `page.isSticky(area)`.'
    )
  }
  if (sectionWrappers.has(boxParent(el))) {
    return (
      "It is a section's outermost element, and the section's wrapper is as tall as it is. To keep the " +
      'section in view, give it `sticky: true` (its type may default it in meta.js), and the runtime ' +
      'makes sticky the box that can.'
    )
  }
  return (
    'It sits in a box the component draws. Give that box room — let it stretch with its row rather ' +
    'than fit its content (`items-start` or `self-start` shrinks it) — or make that box the sticky one.'
  )
}

/** Warn, once per element, about each sticky element on the page that cannot move. */
function checkPage(doc) {
  for (const el of doc.body.querySelectorAll('*')) {
    if (warned.has(el) || getComputedStyle(el).position !== 'sticky') continue
    const clip = clippingAncestor(el)
    if (clip) {
      warned.add(el)
      console.warn(
        '[uniweb] This element is sticky but sits in a box that clips its overflow (`overflow: hidden`, ' +
          'or `overflow-x: hidden`), so it sticks to that box, which does not scroll, and never moves. ' +
          'Clip with `overflow: clip` instead: it clips the same and keeps the element sticking.',
        el,
        clip,
      )
      continue
    }
    if (el.getAttribute('data-uw-sticky') === 'child' || canStick(el)) continue
    warned.add(el)
    console.warn(
      '[uniweb] This element is sticky but cannot move: its parent is no taller than it is, so it ' +
        `scrolls away with the page. ${unmovableAdvice(el)}`,
      el,
    )
  }
}

/**
 * Check the page once it has settled: when `settled()` resolves (or after `SETTLE_CAP_MS`, so a
 * fetch that never answers does not silence the check), its fonts have loaded, and two frames have
 * passed — the first for React to commit what arrived, the second to lay it out.
 *
 * @param {Document} [doc]
 * @param {{ settled?: () => Promise<unknown> }} [options] - what the page waits on: its data
 * @returns {() => void} cancels a check not yet run
 */
export function warnUnmovableSticky(doc = globalThis.document, { settled } = {}) {
  if (!doc?.body || typeof requestAnimationFrame !== 'function') return () => {}
  let cancelled = false
  let frame = 0
  let cap = 0
  const nextFrame = () => new Promise((resolve) => { frame = requestAnimationFrame(resolve) })
  const capped = new Promise((resolve) => { cap = setTimeout(resolve, SETTLE_CAP_MS) })
  ;(async () => {
    await Promise.race([Promise.resolve(settled?.()).catch(() => {}), capped])
    clearTimeout(cap)
    await doc.fonts?.ready
    if (!cancelled) await nextFrame()
    if (!cancelled) await nextFrame()
    if (!cancelled) checkPage(doc)
  })()
  return () => {
    cancelled = true
    clearTimeout(cap)
    cancelAnimationFrame(frame)
  }
}
