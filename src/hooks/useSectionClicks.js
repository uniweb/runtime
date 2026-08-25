/**
 * useSectionClicks — arm section-click reporting for the document.
 *
 * ⭐ **This file is the only part always loaded.** The listener lives behind a
 * dynamic import into `document-tracking.js` — the same chunk `outbound_click`
 * uses, because the two arm on the same condition — so a site with no tracking
 * destination downloads none of it.
 *
 * ⛔ **One call, three questions.** `tracking.arms('section_click')` asks all of
 * them: is there somewhere to send in a live document (so a framed authoring
 * preview arms nothing), will the host consume this row, and did the site select
 * it.
 *
 * ## ⛔ THIS IS NOT IN THE `standard` PRESET, and that is deliberate
 *
 * ⭐ **`section_click` is the FIRST event where `standard` and `all` diverge** —
 * the divergence `wire-foundation.js`'s `EMIT_PRESETS` was written in
 * anticipation of. `standard` is a **curated** set that a framework release must
 * not grow behind an operator's back; `all` is the standing yes. So:
 *
 * ```
 * emit: (absent) / standard   ->  does NOT arm      <- the DEFAULT
 * emit: all                   ->  arms
 * emit: [ ..., section_click] ->  arms
 * ```
 *
 * ⛔ **Do NOT "fix" this by adding the name to `standard`.** That would make a
 * site which changed nothing start sending more, which is the exact surprise the
 * two presets exist to prevent — and it is a promise the docs already make to
 * operators.
 *
 * ⚠️ **The consequence a consumer must be told, because nothing surfaces it:** a
 * host may declare this event and a collector may store it, and **a default site
 * still emits none of it**. Every gate reads yes and the series is flat. That is
 * correct behaviour, not a fault, but it is indistinguishable from a broken
 * emitter unless someone says so first.
 *
 * ⛔ **NO `trackSections` override is passed, and that is deliberate.** That
 * flag exists because `section_view` emits **once per section per page view**,
 * so its cost scales with page length and had to be capped where the cost
 * varies. A click is bounded by what a visitor does, so the same control would
 * buy nothing here — and it would cost a delivery projection to carry.
 *
 * ⚠️ **Consequence worth knowing when reading the numbers:** on a page with
 * `trackSections: false` this still reports clicks, so the click population is
 * strictly larger than the view population and **a click can exist with no view
 * row to divide by.** A per-section CTR is therefore only sound on sections
 * present in both. *(Named here because it is the emitter's doing, not the
 * collector's.)*
 *
 * ## Armed ONCE for the document, not per page
 *
 * ⭐ Same as `useOutboundClicks`, and for the same reason: this is a single
 * delegated listener on `document`, which outlives every SPA navigation.
 * Re-arming per route would tear down and rebuild the same listener for no
 * reason, and a click landing mid-swap would be lost. The *page* it attributes
 * to is read at click time instead — see `observeSectionClicks`.
 *
 * ## SSR
 *
 * There is no SSR twin, and that IS the suppression — effects do not run under
 * `renderToString` and a Worker isolate has no `document`.
 */

import { useEffect } from 'react'

/**
 * Safe to call unconditionally: it decides *when*, never *whether*.
 */
export function useSectionClicks() {
  useEffect(() => {
    const tracking = globalThis.uniweb?.tracking
    if (!tracking?.arms?.('section_click')) return

    // `cancelled` guards the gap between asking for the module and getting it —
    // a fast unmount would otherwise install a listener nothing ever removes.
    let cancelled = false
    let stop = null

    import('../document-tracking.js')
      .then((m) => {
        if (cancelled) return
        // Read the active page at CLICK time, not now: one listener spans every
        // navigation, and capturing the page here would attribute every later
        // click to whichever page the visitor first landed on.
        stop = m.observeSectionClicks(() => globalThis.uniweb?.activeWebsite?.activePage)
      })
      .catch(() => {
        // Telemetry must never surface to a visitor. A chunk that fails to load
        // costs some counts; nothing else about the page is affected.
      })

    return () => {
      cancelled = true
      if (stop) stop()
    }
  }, [])
}

export default useSectionClicks
