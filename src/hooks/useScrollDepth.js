/**
 * useScrollDepth Hook
 *
 * Tracks scroll depth and reports to analytics at milestones (25%, 50%, 75%, 100%).
 * Only tracks if analytics is enabled.
 */

import { useEffect, useRef } from 'react'

/**
 * Calculate current scroll depth percentage
 * @returns {number} Scroll depth 0-100
 */
function getScrollDepth() {
  const scrollTop = window.scrollY
  const docHeight = document.documentElement.scrollHeight - window.innerHeight

  if (docHeight <= 0) return 100 // Page fits in viewport

  return Math.min(100, Math.round((scrollTop / docHeight) * 100))
}

/**
 * useScrollDepth hook
 *
 * @param {Object} analytics - Analytics instance (optional)
 * @param {Object} options
 * @param {boolean} options.enabled - Enable tracking (default: true)
 * @param {number} options.throttleMs - Throttle scroll events (default: 200)
 */
export function useScrollDepth(analytics, options = {}) {
  const { enabled = true, throttleMs = 200 } = options

  const lastCheck = useRef(0)
  const reportedMilestones = useRef(new Set())

  useEffect(() => {
    // Skip if analytics not available or disabled
    if (!enabled || !analytics?.isEnabled?.()) return

    // Reset milestones on mount (new page)
    reportedMilestones.current.clear()

    const handleScroll = () => {
      const now = Date.now()
      if (now - lastCheck.current < throttleMs) return
      lastCheck.current = now

      const depth = getScrollDepth()
      const milestones = [25, 50, 75, 100]

      for (const milestone of milestones) {
        if (depth >= milestone && !reportedMilestones.current.has(milestone)) {
          reportedMilestones.current.add(milestone)
          analytics.trackScrollDepth(milestone)
        }
      }
    }

    // Check initial scroll position
    handleScroll()

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [analytics, enabled, throttleMs])
}

export default useScrollDepth
