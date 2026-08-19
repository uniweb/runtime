/**
 * outbound_click — where a visitor goes when they leave.
 *
 * ⭐ **Reached behind a dynamic import** (`hooks/useOutboundClicks.js`), so a
 * site with no tracking destination never downloads this file. Same arrangement
 * as `section-views.js` and `script-loader.js`.
 *
 * ## ⛔ The HOSTNAME is the event. The URL never leaves the page.
 *
 * A full outbound URL can carry a query string — a search term, a token, a
 * referral id someone pasted — that the site owner has no business collecting
 * merely because a visitor clicked a link. **So the truncation happens HERE, at
 * the emitter, not at the store.** A constraint applied at write time is a
 * promise about someone else's code; applied at emit time the sensitive part
 * never exists as data at all.
 *
 * ⚖️ **This is the one place the constraint can be enforced rather than
 * agreed.** If it lived only in the collector, two producers would hold one
 * rule and could disagree silently — the failure being *a full URL quietly
 * stored*, which nothing surfaces as an error.
 *
 * ## No page-level opt-in, deliberately
 *
 * `section_view` needs one (`trackSections`) because its dimension is unbounded
 * — a site's section types run to the hundreds and hosting capped the cardinality.
 * **An outbound hostname is bounded by how many external sites a page links to**,
 * which is small and does not grow with the site. So the only gate is
 * `tracking.isEnabled()`: declaring a destination is already the operator's
 * decision to measure.
 *
 * ⛔ **And a page flag would not be free — it would need a DELIVERY PROJECTION**
 * (the stored flag → the runtime payload), which is a distinct item owned by a
 * different lane and invisible from this one. That gap shipped once already and
 * cost a day of a working emitter reporting nothing. **Not worth paying for a
 * dimension that was never at risk.**
 *
 * @module @uniweb/runtime/outbound-clicks
 */

/**
 * Protocols worth reporting as *traffic leaving the site*.
 *
 * ⛔ `mailto:` and `tel:` are deliberately absent. They are contact intents, not
 * navigations, and folding them in would put `mail` beside real destinations in
 * a chart about where traffic goes. They are worth their own event if anyone
 * asks for one; they are not worth corrupting this one.
 */
const REPORTED_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * The hostname this click leaves for, or `null` if it does not leave.
 *
 * Exported for the tests: the whole privacy claim of this module is that only a
 * hostname is ever produced, and that is worth asserting directly rather than
 * through a listener.
 *
 * @param {string} href - the link's raw `href`, possibly relative
 * @param {Location|URL} here - the document's own location
 * @returns {string|null}
 */
export function outboundHostname(href, here) {
  if (!href) return null
  let url
  try {
    // Resolving against the document is what makes a relative href resolve to
    // OUR host and therefore drop out below. A bare `new URL(href)` would throw
    // on every internal link and turn the common case into the error path.
    url = new URL(href, here.href)
  } catch {
    return null
  }
  if (!REPORTED_PROTOCOLS.has(url.protocol)) return null
  if (url.hostname === here.hostname) return null
  // `url.hostname` — never `url.host` (which appends a port), never `url.href`,
  // and nothing derived from `search` or `pathname`. This return is the
  // enforcement point named in the module header.
  return url.hostname || null
}

/**
 * Listen for clicks that leave the site and report the destination host.
 *
 * @param {{track: (event: string, data?: object) => void}} tracking
 * @returns {(() => void) | null} teardown, or null when there is no DOM
 */
export function observeOutboundClicks(tracking) {
  if (typeof document === 'undefined' || !tracking?.track) return null

  const onClick = (event) => {
    // `closest` rather than the target itself: the click almost always lands on
    // a child of the anchor — an icon, a span, the text node's element.
    const anchor = event.target?.closest?.('a[href]')
    if (!anchor) return
    const hostname = outboundHostname(anchor.getAttribute('href'), document.location)
    if (!hostname) return
    // Nothing is prevented and nothing is awaited. The navigation proceeds at
    // full speed; the queued event survives it because the tracker beacons on
    // `pagehide` and on `visibilitychange` to hidden.
    tracking.track('outbound_click', { hostname })
  }

  // ⛔ CAPTURE phase. A foundation's own handler may call `stopPropagation()` on
  // its links — a legitimate thing to do — and in the bubble phase that would
  // silently zero the count for exactly the sites that decorate their links.
  document.addEventListener('click', onClick, true)
  // A middle click fires `auxclick`, not `click`. Opening a link in a new tab
  // is a real outbound visit, and omitting it would undercount silently and
  // unevenly — power users do it far more than average visitors.
  document.addEventListener('auxclick', onClick, true)

  return () => {
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('auxclick', onClick, true)
  }
}

export default observeOutboundClicks
