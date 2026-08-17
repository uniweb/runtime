/**
 * useSectionViews — arm section reporting on a page that asked for it.
 *
 * ⭐ **This file is the only part always loaded.** The observer lives behind a
 * dynamic import, so a site that instruments no page downloads none of it — the
 * same arrangement `script-loader.js` has, and the reason the opt-in is a
 * declaration rather than a call a foundation makes.
 *
 * ⛔ **Two gates, and both are needed.** `page.trackSections` says the author
 * asked; `tracking.isEnabled()` says there is somewhere to send and this is a
 * live document — which also means a framed authoring preview arms nothing (see
 * `Tracker.isLiveDocument`). Neither implies the other: a site can declare a
 * destination and instrument no page, or instrument a page and have no
 * destination.
 *
 * ## SSR
 *
 * There is no SSR twin, and that IS the suppression — the same as
 * `usePageView`. Effects do not run under `renderToString`, a Worker isolate has
 * no `IntersectionObserver`, and the SSR path renders one page per call with
 * stub routing. Nothing to remember to switch off.
 *
 * Design: `kb/framework/plans/tracking.md`.
 */

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Safe to call unconditionally: it decides *when*, never *whether*.
 *
 * Keyed on `location.pathname`, so it re-arms per page exactly where
 * `usePageView` emits — a `section_view` therefore always pairs with the
 * `page_view` it belongs to. A query or hash change does not re-arm, which is
 * correct: the sections on screen have not changed.
 */
export function useSectionViews() {
  const location = useLocation()

  useEffect(() => {
    const uniweb = globalThis.uniweb
    const page = uniweb?.activeWebsite?.activePage
    if (!page?.trackSections) return
    if (!uniweb.tracking?.isEnabled?.()) return

    // `cancelled` guards the gap between asking for the module and getting it:
    // a fast navigation can unmount this effect first, and observing then would
    // instrument the page the visitor already left.
    let cancelled = false
    let stop = null

    import('../section-views.js')
      .then((m) => {
        if (cancelled) return
        stop = m.observeSections(page)
      })
      .catch(() => {
        // Telemetry must never surface to a visitor. A chunk that fails to load
        // costs some counts; nothing else about the page is affected.
      })

    return () => {
      cancelled = true
      if (stop) stop()
    }
  }, [location.pathname])
}

export default useSectionViews
