/**
 * useLinkInterceptor Hook
 *
 * Intercepts clicks on internal links rendered as plain <a> tags
 * (e.g., from markdown content) and uses React Router navigation
 * instead of full page reloads.
 *
 * This enables SPA-style navigation for links that were rendered
 * as raw HTML via dangerouslySetInnerHTML.
 *
 * Also handles cross-page hash scrolling (e.g., /page#section)
 * by scrolling to the target element after navigation completes.
 */

import { useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

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
 * Scroll to element by ID with retry logic
 * Retries a few times to handle elements that render asynchronously
 *
 * @param {string} elementId - The element ID to scroll to
 * @param {number} retries - Number of retries remaining
 */
function scrollToElement(elementId, retries = 5) {
  const element = document.getElementById(elementId)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth' })
    return
  }

  // Retry after a short delay if element not found yet
  if (retries > 0) {
    requestAnimationFrame(() => {
      setTimeout(() => scrollToElement(elementId, retries - 1), 50)
    })
  }
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
  const location = useLocation()

  // Handle hash scrolling after navigation
  // This effect runs when location changes and there's a hash
  useEffect(() => {
    if (!enabled) return
    if (!location.hash) return

    // Remove the # prefix
    const elementId = location.hash.slice(1)
    if (elementId) {
      // Use requestAnimationFrame to wait for render, then scroll
      requestAnimationFrame(() => {
        scrollToElement(elementId)
      })
    }
  }, [enabled, location.pathname, location.hash])

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

      // Check if this link switches locale (requires full page reload)
      const website = globalThis.uniweb?.activeWebsite
      if (website?.hasMultipleLocales()) {
        const activeLocale = website.getActiveLocale()
        const defaultLocale = website.getDefaultLocale()
        const localeCodes = website.getLocales().map(l => l.code)
        const hrefMatch = href.match(/^\/([a-z]{2,3}(?:-[A-Z]{2})?)(?:\/|$)/)
        const hrefLocale = hrefMatch?.[1]

        let isLocaleSwitch = false
        if (hrefLocale && localeCodes.includes(hrefLocale)) {
          isLocaleSwitch = hrefLocale !== activeLocale
        } else {
          // No locale prefix = targets default locale
          isLocaleSwitch = activeLocale !== defaultLocale
        }
        if (isLocaleSwitch) return  // Allow full page reload
      }

      // Prevent the default browser navigation
      event.preventDefault()

      // Handle hash-only links (same page scroll)
      if (href.startsWith('#')) {
        const elementId = href.slice(1)
        if (elementId) {
          scrollToElement(elementId)
          // Update URL hash without navigation
          window.history.pushState(null, '', href)
        }
        return
      }

      // Use React Router navigation
      // React Router will handle the path, and our useEffect above
      // will handle scrolling to hash after navigation completes
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
