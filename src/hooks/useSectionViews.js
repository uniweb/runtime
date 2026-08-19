/**
 * useSectionViews — arm section reporting on a page that asked for it.
 *
 * ⭐ **This file is the only part always loaded.** The observer lives behind a
 * dynamic import, so a site that instruments no page downloads none of it — the
 * same arrangement `script-loader.js` has, and the reason the opt-in is a
 * declaration rather than a call a foundation makes.
 *
 * ⛔ **One gate that resolves three tiers.** `arms('section_view',
 * page.trackSections)` asks whether there is somewhere to send in a live
 * document, whether the host will store the row, and then whose answer wins:
 * the page's if it stated one, otherwise the site's `tracking.emit`. A page may
 * widen what its own site configured and may not conjure a row the host
 * declined — see `Tracker.arms`.
 *
 * ## SSR
 *
 * There is no SSR twin, and that IS the suppression — the same as
 * `usePageView`. Effects do not run under `renderToString`, a Worker isolate has
 * no `IntersectionObserver`, and the SSR path renders one page per call with
 * stub routing. Nothing to remember to switch off.
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
 *
 * ⛔ **`ready` is not a convenience — without it split-content pages
 * under-report silently.** A page's sections can arrive *after* the first
 * render (`page.loadContent()`), and an observer armed before them finds no
 * elements and reports nothing. The failure has no symptom: the section simply
 * shows zero, which is indistinguishable from nobody scrolling to it.
 *
 * ⭐ This is why the hook lives in `PageRenderer` rather than `WebsiteRenderer`
 * — `PageRenderer` is the component that re-renders when content lands, so it
 * is the only place the effect can key on it.
 *
 * @param {boolean} [ready=true] - whether this page's sections are in the DOM
 */
export function useSectionViews(ready = true) {
  const location = useLocation()

  useEffect(() => {
    if (!ready) return
    const uniweb = globalThis.uniweb
    const page = uniweb?.activeWebsite?.activePage
    if (!page) return
    // One call, and the page's answer rides in as the override: `undefined`
    // defers to the site's `tracking.emit`, `true`/`false` overrule it, and
    // neither can escape the host's own list. See `Tracker.arms`.
    if (!uniweb.tracking?.arms?.('section_view', page.trackSections)) return

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
  }, [location.pathname, ready])
}

export default useSectionViews
