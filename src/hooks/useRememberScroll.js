/**
 * useRememberScroll Hook
 *
 * Remembers scroll position per history entry and restores it on navigation.
 * Uses React Router's location.key to track positions per history entry
 * (not per page path), so back→forward navigations restore correctly.
 *
 * Behavior:
 * - Continuously saves scroll position via a passive scroll listener
 * - Restores scroll position on back/forward (POP) navigation with retry
 * - Scrolls to top on new navigation (PUSH/REPLACE)
 * - Skips when location.hash is present (defers to useLinkInterceptor)
 * - Optionally resets block states on scroll restoration
 *
 * Scroll container:
 * The scroll container is determined by the current page's layout metadata.
 * Layouts declare a `scroll` property in meta.js:
 * - Not set: runtime manages scroll on `window` (default)
 * - 'self': layout manages its own scrolling; runtime disables
 * - CSS selector (e.g. 'main'): runtime manages scroll on that element
 * A foundation-level `scroll` in foundation.js serves as the default for
 * all layouts that don't declare their own.
 *
 * Implementation note:
 * Uniweb scrolls `window` by default (not a fixed-size container). When
 * React swaps page content, the browser may clamp scrollY and fire scroll
 * events BEFORE useEffect runs. To prevent those events from corrupting
 * the saved position of the page we're leaving, useLayoutEffect captures
 * the target value and updates the location key ref synchronously — before
 * any scroll events.
 */

import { useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/** In-memory scroll positions keyed by React Router's location.key. */
const scrollPositions = new Map()

/** Read scroll position from window or element. */
function getScrollY(container) {
  return container === window ? window.scrollY : container.scrollTop
}

/**
 * Resolve the scroll container for the current page's layout.
 *
 * @returns {Element|Window|null} - scroll target, or null if layout manages its own
 */
function resolveScrollContainer() {
  const website = globalThis.uniweb.activeWebsite
  const layoutName = website.activePage.getLayoutName()
  const layoutMeta = layoutName ? website.getLayoutMeta(layoutName) : null

  const scroll = layoutMeta?.scroll
    ?? globalThis.uniweb.foundationConfig?.scroll
    ?? null

  if (scroll === 'self') return null
  if (scroll) return document.querySelector(scroll) || window
  return window
}

/**
 * useRememberScroll hook
 *
 * @param {Object} options
 * @param {boolean} options.enabled - Enable scroll memory (default: true)
 * @param {boolean} options.resetBlockStates - Reset block states on restore (default: true)
 */
export function useRememberScroll(options = {}) {
  const { enabled = true, resetBlockStates = true } = options

  const location = useLocation()
  const navigationType = useNavigationType()
  const locationKeyRef = useRef(location.key)
  const savedScrollRef = useRef(null)
  const containerRef = useRef(window)

  // Continuously save scroll position for the current location
  const handleScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    scrollPositions.set(locationKeyRef.current, getScrollY(container))
  }, [])

  // Attach scroll listener to the current container.
  // Re-attaches on navigation since the container may change per-layout.
  useEffect(() => {
    if (!enabled) return
    const container = containerRef.current
    if (!container) return

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [location.key, enabled, handleScroll])

  // Synchronously capture saved scroll, update key, and resolve container
  // BEFORE browser scroll events can fire and corrupt the departing page's value.
  useLayoutEffect(() => {
    if (navigationType === 'POP') {
      savedScrollRef.current = scrollPositions.get(location.key) ?? null
    } else {
      savedScrollRef.current = null
    }
    locationKeyRef.current = location.key
    containerRef.current = enabled ? resolveScrollContainer() : null
  }, [location.key, navigationType, enabled])

  // On navigation: restore on POP, scroll to top on PUSH/REPLACE
  useEffect(() => {
    if (!enabled) return
    const container = containerRef.current
    if (!container) return

    // Reset block states if requested (for animations, etc.)
    if (resetBlockStates) {
      const page = globalThis.uniweb.activeWebsite.activePage
      if (typeof page.resetBlockStates === 'function') {
        page.resetBlockStates()
      }
    }

    // When hash is present, let useLinkInterceptor handle scrolling
    if (location.hash) return

    if (navigationType === 'POP') {
      const saved = savedScrollRef.current
      if (saved == null) return

      // Retry scroll restoration as content may load asynchronously.
      // Each frame: scroll, check if it landed, retry if the page
      // wasn't tall enough yet (up to ~500ms at 60fps).
      let raf
      let attempts = 0
      const tryRestore = () => {
        container.scrollTo(0, saved)
        if (Math.abs(getScrollY(container) - saved) > 5 && attempts < 30) {
          attempts++
          raf = requestAnimationFrame(tryRestore)
        }
      }
      raf = requestAnimationFrame(tryRestore)

      return () => cancelAnimationFrame(raf)
    } else {
      container.scrollTo(0, 0)
    }
  }, [location.key, navigationType, enabled, resetBlockStates, location.hash])
}

export default useRememberScroll
