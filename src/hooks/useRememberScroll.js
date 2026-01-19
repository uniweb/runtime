/**
 * useRememberScroll Hook
 *
 * Remembers scroll position per page and restores it on navigation.
 * Works with Page.scrollY property for persistence.
 *
 * Behavior:
 * - Saves scroll position when navigating away from a page
 * - Restores scroll position when returning to a previously visited page
 * - Scrolls to top for newly visited pages
 * - Optionally resets block states on scroll restoration
 */

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * useRememberScroll hook
 *
 * @param {Object} options
 * @param {boolean} options.enabled - Enable scroll memory (default: true)
 * @param {boolean} options.resetBlockStates - Reset block states on restore (default: true)
 * @param {number} options.scrollDelay - Delay before restoring scroll (default: 0)
 */
export function useRememberScroll(options = {}) {
  const { enabled = true, resetBlockStates = true, scrollDelay = 0 } = options

  const location = useLocation()
  const previousPathRef = useRef(location.pathname)
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (!enabled) return

    const uniweb = globalThis.uniweb
    const website = uniweb?.activeWebsite
    if (!website) return

    const previousPath = previousPathRef.current
    const currentPath = location.pathname

    // Sync active page with current route
    // This keeps website.activePage in sync for code that depends on it
    website.setActivePage(currentPath)
    const currentPage = website.activePage

    // Skip on first render
    if (isFirstRender.current) {
      isFirstRender.current = false
      previousPathRef.current = currentPath
      return
    }

    // Path hasn't changed (might be hash or search change)
    if (previousPath === currentPath) {
      return
    }

    // Save scroll position from previous page
    const previousPage = website.getPage(previousPath)
    if (previousPage) {
      previousPage.scrollY = window.scrollY
    }

    // Restore or reset scroll for current page
    if (currentPage) {
      const targetScroll = currentPage.scrollY || 0

      // Reset block states if requested (for animations, etc.)
      if (resetBlockStates && typeof currentPage.resetBlockStates === 'function') {
        currentPage.resetBlockStates()
      }

      // Restore scroll position
      const restore = () => {
        window.scrollTo(0, targetScroll)
      }

      if (scrollDelay > 0) {
        setTimeout(restore, scrollDelay)
      } else {
        // Use requestAnimationFrame for smoother restoration
        requestAnimationFrame(restore)
      }
    }

    // Update previous path ref
    previousPathRef.current = currentPath
  }, [location.pathname, enabled, resetBlockStates, scrollDelay])

  // Save scroll position before page unload
  useEffect(() => {
    if (!enabled) return

    const handleBeforeUnload = () => {
      const uniweb = globalThis.uniweb
      const page = uniweb?.activeWebsite?.activePage
      if (page) {
        page.scrollY = window.scrollY
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [enabled])
}

export default useRememberScroll
