/**
 * usePageView — the one event the runtime emits by itself.
 *
 * ⭐ **The rule: the runtime auto-emits only what requires runtime privilege.**
 * A page view needs the router, so no foundation can emit it reliably. Scroll
 * depth, video milestones, downloads and everything else are opt-in from kit or
 * the foundation, stay tree-shaken, and never land here. That line exists to
 * answer, once, a question that otherwise recurs one metric at a time.
 *
 * ## Why a client emitter at all, rather than the host counting requests
 *
 * **The emission always happens; the document request does not.**
 *
 *   1. SPA navigation reaches no server — after the first document the router
 *      takes over, so every view but the first is invisible to anything
 *      watching HTTP.
 *   2. Even the first request can be absent: a cached response is served
 *      without invoking the host's own code, so counting origin requests
 *      undercounts entries by exactly the cached fraction — silently, because
 *      the cache is doing its job.
 *
 * ## SSR
 *
 * There is no SSR twin of this file, and that is the suppression. Effects do
 * not run under `renderToString`; the SSR path installs stub routing components
 * and renders one page per call, so there is no route *change* to observe; and
 * a Worker isolate has no `window`. Nothing to remember to switch off.
 *
 * Part of the site-tracking design.
 */

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Report a page view on every pathname change, including the first.
 *
 * Keyed on `location.pathname` alone, so a query-only change (`?page=2`), a
 * hash change (`#section`) and a re-render of the same route do not re-emit.
 * `useLinkInterceptor` has to name `location.hash` explicitly in its own deps
 * for the opposite reason, which is the proof that `pathname` does not cover it.
 *
 * ⚖️ **The reported path is site-relative** — React Router strips the basename,
 * so a site deployed at `/docs/` reports `/about`, not `/docs/about`. That is
 * the page's identity within the site, and it keeps the same site comparable
 * across deployments.
 *
 * Everything else is the tracker's: enablement, consent, the consecutive
 * same-path guard, and the acquisition context. This hook decides *when*, not
 * *whether* — so it is safe to call unconditionally.
 */
export function usePageView() {
  const location = useLocation()

  useEffect(() => {
    globalThis.uniweb?.tracking?.trackPageView(location.pathname)
  }, [location.pathname])
}

export default usePageView
