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
 * Implementation note:
 * Uniweb scrolls `window` (not a fixed-size container). When React swaps
 * page content, the browser may clamp scrollY and fire scroll events BEFORE
 * useEffect runs. To prevent those events from corrupting the saved position
 * of the page we're leaving, useLayoutEffect captures the target value and
 * updates the location key ref synchronously — before any scroll events.
 */

import { useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/** In-memory scroll positions keyed by React Router's location.key. */
const scrollPositions = new Map()

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

  // Continuously save scroll position for the current location
  const handleScroll = useCallback(() => {
    scrollPositions.set(locationKeyRef.current, window.scrollY)
  }, [])

  useEffect(() => {
    if (!enabled) return

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [enabled, handleScroll])

  // Synchronously capture saved scroll and update key BEFORE browser
  // scroll events can fire (which would corrupt the previous page's value)
  useLayoutEffect(() => {
    if (navigationType === 'POP') {
      savedScrollRef.current = scrollPositions.get(location.key) ?? null
    } else {
      savedScrollRef.current = null
    }
    locationKeyRef.current = location.key
  }, [location.key, navigationType])

  // On navigation: restore on POP, scroll to top on PUSH/REPLACE
  useEffect(() => {
    if (!enabled) return

    // Reset block states if requested (for animations, etc.)
    if (resetBlockStates) {
      const page = globalThis.uniweb?.activeWebsite?.activePage
      if (page && typeof page.resetBlockStates === 'function') {
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
        window.scrollTo(0, saved)
        if (Math.abs(window.scrollY - saved) > 5 && attempts < 30) {
          attempts++
          raf = requestAnimationFrame(tryRestore)
        }
      }
      raf = requestAnimationFrame(tryRestore)

      return () => cancelAnimationFrame(raf)
    } else {
      window.scrollTo(0, 0)
    }
  }, [location.key, navigationType, enabled, resetBlockStates, location.hash])
}

export default useRememberScroll
