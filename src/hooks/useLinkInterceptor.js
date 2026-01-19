/**
 * useLinkInterceptor Hook
 *
 * Intercepts clicks on internal links rendered as plain <a> tags
 * (e.g., from markdown content) and uses React Router navigation
 * instead of full page reloads.
 *
 * This enables SPA-style navigation for links that were rendered
 * as raw HTML via dangerouslySetInnerHTML.
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Check if a URL is internal (same origin, no external protocol)
 * @param {string} href - The href to check
 * @returns {boolean}
 */
function isInternalLink(href) {
  if (!href) return false

  // Hash-only links are internal
  if (href.startsWith('#')) return true

  // Relative paths are internal
  if (href.startsWith('/') && !href.startsWith('//')) return true

  // Check if same origin
  try {
    const url = new URL(href, window.location.origin)
    return url.origin === window.location.origin
  } catch {
    // Invalid URL, treat as internal relative path
    return true
  }
}

/**
 * Check if the click should trigger navigation
 * @param {MouseEvent} event - The click event
 * @returns {boolean}
 */
function shouldNavigate(event) {
  // Ignore if default was already prevented
  if (event.defaultPrevented) return false

  // Ignore modified clicks (new tab, etc.)
  if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return false

  // Ignore right-clicks
  if (event.button !== 0) return false

  return true
}

/**
 * Find the closest anchor element from an event target
 * @param {EventTarget} target - The event target
 * @returns {HTMLAnchorElement|null}
 */
function findAnchorElement(target) {
  let element = target
  while (element && element !== document.body) {
    if (element.tagName === 'A') {
      return element
    }
    element = element.parentElement
  }
  return null
}

/**
 * useLinkInterceptor hook
 *
 * @param {Object} options
 * @param {boolean} options.enabled - Enable link interception (default: true)
 */
export function useLinkInterceptor(options = {}) {
  const { enabled = true } = options
  const navigate = useNavigate()

  useEffect(() => {
    if (!enabled) return

    function handleClick(event) {
      // Check if we should handle this click
      if (!shouldNavigate(event)) return

      // Find the anchor element
      const anchor = findAnchorElement(event.target)
      if (!anchor) return

      // Get the href
      const href = anchor.getAttribute('href')
      if (!href) return

      // Check if it's an internal link
      if (!isInternalLink(href)) return

      // Check for download attribute
      if (anchor.hasAttribute('download')) return

      // Check for target="_blank" or other non-self targets
      const target = anchor.getAttribute('target')
      if (target && target !== '_self') return

      // Prevent the default browser navigation
      event.preventDefault()

      // Handle hash-only links
      if (href.startsWith('#')) {
        // Scroll to element or top
        const elementId = href.slice(1)
        if (elementId) {
          const element = document.getElementById(elementId)
          if (element) {
            element.scrollIntoView({ behavior: 'smooth' })
          }
        }
        return
      }

      // Use React Router navigation
      navigate(href)
    }

    // Add click listener to document
    document.addEventListener('click', handleClick)

    return () => {
      document.removeEventListener('click', handleClick)
    }
  }, [enabled, navigate])
}

export default useLinkInterceptor
