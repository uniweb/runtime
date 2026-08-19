/**
 * useOutboundClicks — arm outbound-link reporting for the document.
 *
 * ⭐ **This file is the only part always loaded.** The listener lives behind a
 * dynamic import, so a site with no tracking destination downloads none of it —
 * the same arrangement as `useSectionViews`.
 *
 * ⛔ **One gate, not two.** `tracking.isEnabled()` is the whole condition: it
 * says there is somewhere to send *and* that this is a live document, so a
 * framed authoring preview arms nothing (`Tracker.isLiveDocument`). Unlike
 * `useSectionViews` there is no per-page flag to check — see the module header
 * of `outbound-clicks.js` for why a page-level opt-in would cost a delivery
 * projection and buy nothing.
 *
 * ## Armed ONCE for the document, not per page
 *
 * ⭐ **This is the difference from `useSectionViews` and it decides where the
 * hook is mounted.** Sections are elements, so their observer must re-arm when
 * the page's elements change. This is a single delegated listener on
 * `document`, which outlives every SPA navigation — re-arming it per route
 * would tear down and rebuild the same listener for no reason, and a click
 * landing mid-swap would be lost. ⇒ It belongs in `WebsiteRenderer` beside
 * `usePageView`, keyed on nothing.
 *
 * ## SSR
 *
 * There is no SSR twin, and that IS the suppression — the same as
 * `usePageView`. Effects do not run under `renderToString` and a Worker isolate
 * has no `document`. Nothing to remember to switch off.
 */

import { useEffect } from 'react'

/**
 * Safe to call unconditionally: it decides *when*, never *whether*.
 */
export function useOutboundClicks() {
  useEffect(() => {
    const tracking = globalThis.uniweb?.tracking
    if (!tracking?.isEnabled?.()) return

    // `cancelled` guards the gap between asking for the module and getting it —
    // a fast unmount would otherwise install a listener nothing ever removes.
    let cancelled = false
    let stop = null

    import('../outbound-clicks.js')
      .then((m) => {
        if (cancelled) return
        stop = m.observeOutboundClicks(tracking)
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

export default useOutboundClicks
