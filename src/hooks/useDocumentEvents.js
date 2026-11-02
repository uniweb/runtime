/**
 * useDocumentEvents — arm what a tracked document reports from its own listeners:
 * where a visitor goes when they leave, which sections they interact with, and what
 * the site counts as a conversion. Each is `document-tracking.js`'s to arm.
 *
 * ⭐ **This file is the only part always loaded.** The listeners live behind a dynamic
 * import, so a site with no tracking destination downloads none of them. It is one hook
 * rather than one per event because every site carries it: two copies of this effect
 * cost every site more than a third event's whole listener costs a tracked one.
 *
 * ⚖️ **The condition is `isEnabled()`, not each event's `arms()`,** which is that same
 * trade: a site narrowed to `emit: minimal` downloads the chunk and arms nothing in it,
 * and no site pays to ask the question three times here.
 *
 * ## Armed ONCE for the document, not per page
 *
 * ⭐ **This is the difference from `useSectionViews` and it decides where the hook is
 * mounted.** Sections are elements, so their observer must re-arm when the page's
 * elements change. These are delegated listeners on `document`, which outlive every SPA
 * navigation — re-arming per route would tear down and rebuild the same listeners for no
 * reason, and a click landing mid-swap would be lost. ⇒ It belongs in `WebsiteRenderer`
 * beside `usePageView`, keyed on nothing.
 *
 * ## SSR
 *
 * There is no SSR twin, and that IS the suppression — the same as `usePageView`. Effects
 * do not run under `renderToString` and a Worker isolate has no `document`. Nothing to
 * remember to switch off.
 */

import { useEffect } from 'react'

/**
 * Safe to call unconditionally: it decides *when*, never *whether*.
 */
export function useDocumentEvents() {
  useEffect(() => {
    const tracking = globalThis.uniweb?.tracking
    // Somewhere to send, in a live document — so a framed authoring preview arms nothing.
    if (!tracking?.isEnabled?.()) return

    // `cancelled` guards the gap between asking for the module and getting it —
    // a fast unmount would otherwise install listeners nothing ever removes.
    let cancelled = false
    let stop = null

    import('../document-tracking.js')
      .then((m) => {
        if (cancelled) return
        stop = m.observeDocument(tracking)
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

export default useDocumentEvents
