/**
 * useOutboundClicks — arm outbound-link reporting for the document.
 *
 * ⭐ **This file is the only part always loaded.** The listener lives behind a
 * dynamic import, so a site with no tracking destination downloads none of it —
 * the same arrangement as `useSectionViews`.
 *
 * ⛔ **One call, three questions.** `tracking.arms('outbound_click')` asks all of
 * them: is there somewhere to send in a live document (so a framed authoring
 * preview arms nothing), will the host consume this row, and did the site
 * select it. Unlike `useSectionViews` there is no per-page override to pass — see the section header
 * in `document-tracking.js` for why a page-level opt-in would cost a delivery
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
    if (!tracking?.arms?.('outbound_click')) return

    // `cancelled` guards the gap between asking for the module and getting it —
    // a fast unmount would otherwise install a listener nothing ever removes.
    let cancelled = false
    let stop = null

    import('../document-tracking.js')
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
