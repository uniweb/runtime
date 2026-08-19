/**
 * The listeners a TRACKED document arms — grouped by WHEN THEY ARM.
 *
 * ⭐ **The grouping rule, which is what this file is really for.** Everything
 * here needs exactly `tracking.arms(<event>)` with no further condition: a
 * destination exists, this is a live document, and neither the host nor the site
 * narrowed the event away. Today that is `outbound_click` alone; the next
 * emitter meeting the same condition belongs in this chunk, and one meeting a
 * different condition does not.
 *
 * ⛔ **`section-views.js` stays separate** — its condition is narrower (a page
 * may override, so it is armed per page rather than per document). ⛔ **And
 * `script-loader.js` stays separate on a different axis entirely** — a site can
 * declare vendor scripts with **no endpoint at all**, and it is fetched only
 * *after consent is granted*, so folding it in would pull a vendor loader down
 * for a visitor who then declines.
 *
 * ⚖️ **Measured 2026-08-19, so the rule is not an aesthetic.** Merging all three
 * gzips to 1255 B against 621 / 446 / 599 apart. That saves 411 B for a site
 * using every one of them and costs ~640 B for the two commonest shapes —
 * endpoint-only, and vendor-scripts-only. **The merge optimises the rarest site
 * and penalises the usual ones**, which is the general reason to group by
 * condition rather than by topic.
 *
 * ⚖️ Everything here runs from a `useEffect`, after paint. None of it is on the
 * critical path, so request count is a minor term and correctness of the
 * condition is the major one.
 *
 * @module @uniweb/runtime/document-tracking
 */

/* ------------------------------------------------------------------ *
 * outbound_click — where a visitor goes when they leave.
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
 * — a site's section types run to the hundreds and hosting capped the
 * cardinality. **An outbound hostname is bounded by how many external sites a
 * page links to**, which is small and does not grow with the site.
 *
 * ⛔ **And a page flag would not be free — it would need a DELIVERY PROJECTION**
 * (the stored flag → the runtime payload), a distinct item owned by a different
 * lane and invisible from this one. That gap shipped once already and cost a day
 * of a working emitter reporting nothing. **Not worth paying for a dimension
 * that was never at risk.**
 * ------------------------------------------------------------------ */

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
 * Exported for the tests: the whole privacy claim of this half is that only a
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
  // enforcement point named in the section header above.
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
