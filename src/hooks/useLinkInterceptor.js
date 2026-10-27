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
import { localeOfPath } from '@uniweb/core/resolve-route'
import { navigateInApp } from '../navigation.js'

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
export function findAnchorElement(target) {
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
 * A link the runtime may route, or null: an anchor whose href stays on this site, downloads
 * nothing and opens in this tab.
 *
 * `routeHref` is where the browser would go, as a path: the href resolved against this page's
 * URL, so a query (`?tab=2`) or a relative href (`about`) is judged like any other path. The base
 * path comes off, because React Router and locale detection work with router-relative paths (a
 * <Link reload> carries the base).
 *
 * ⛔ Until 2026-10-24 an href that was not a path counted as the default locale's, so on any
 * other locale's page it was a page load: a query or a relative link reloaded the page, and left
 * an editor's preview frame.
 *
 * @param {HTMLAnchorElement|null} anchor
 * @returns {{ anchor: HTMLAnchorElement, href: string, routeHref: string, website: Object }|null}
 */
export function inAppLink(anchor) {
  const href = anchor?.getAttribute('href')
  if (!href || !isInternalLink(href)) return null
  if (anchor.hasAttribute('download')) return null
  const target = anchor.getAttribute('target')
  if (target && target !== '_self') return null

  const website = globalThis.uniweb?.activeWebsite
  const basePath = website?.basePath || ''
  const resolved = new URL(href, window.location.href)
  let routeHref = resolved.pathname + resolved.search + resolved.hash
  if (basePath && routeHref.startsWith(basePath)) {
    routeHref = routeHref.slice(basePath.length) || '/'
  }
  return { anchor, href, routeHref, website }
}

/** Whether a page of `website` has content not fetched yet: a site whose content is split. */
function hasPagesToFetch(website) {
  return !!website?.pages?.some((page) => page.hasContent() && !page.isContentLoaded())
}

/**
 * The locale and page a link goes to when it leaves the active locale, or null.
 *
 * Which locale a path names is the hosts' rule (`localeOfPath`): a served locale's prefix,
 * else the locale served unprefixed. The page is the route that locale shows, made canonical.
 * It reads a path only; the click handler resolves every href to one first.
 *
 * @param {string} routeHref - Where the link goes, as a path, base path removed
 * @param {Object} website - The active Website
 * @returns {{ locale: string, route: string } | null}
 */
export function localeSwitchOf(routeHref, website) {
  if (!website?.hasMultipleLocales() || !routeHref.startsWith('/') || routeHref.startsWith('//')) return null
  const { locale, path } = localeOfPath(routeHref.split(/[?#]/)[0], website.config)
  if (locale === website.getActiveLocale()) return null
  return { locale, route: website.reverseTranslateRoute(path, locale) }
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

      const link = inAppLink(findAnchorElement(event.target))
      if (!link) return
      const { anchor, href, routeHref, website } = link

      // A link to another locale's page is a page load, since that locale is its own document,
      // and the browser makes it. A host that switches locale its own way (`uniweb.localeSwitch`:
      // an editor's preview, which a page load would leave) is handed it instead, a
      // `<Link reload>` from a language menu and a plain link to `/fr/…` alike.
      const switchTo = localeSwitchOf(routeHref, website)
      if (switchTo) {
        if (globalThis.uniweb?.localeSwitch) {
          event.preventDefault()
          website.switchLocale(switchTo.locale, switchTo.route)
        }
        return
      }

      // Opt out: anchors marked for full-page reload (e.g., <Link reload>)
      if (anchor.hasAttribute('data-reload')) return

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

      // React Router takes the router-relative path, and the effect above scrolls to a fragment
      // once the page is there. Like a <Link>, the click holds this page until the next one's
      // content has arrived, and the swap is animated when view transitions apply (`navigation.js`).
      navigateInApp(navigate, routeHref)
    }

    document.addEventListener('click', handleClick)

    // ⭐ A page is fetched while the reader is about to follow a link to it (`link-intent.js`),
    // on a site with pages still to fetch. A site whose pages all came with it never downloads
    // that module. `cancelled` covers an effect torn down before the module arrives.
    let cancelled = false
    let stopIntent = null
    if (hasPagesToFetch(globalThis.uniweb?.activeWebsite)) {
      import('../link-intent.js')
        .then((m) => {
          if (!cancelled) stopIntent = m.watchLinkIntent()
        })
        .catch(() => {
          // Without it, a click still holds the page until its content arrives.
        })
    }

    return () => {
      document.removeEventListener('click', handleClick)
      cancelled = true
      if (stopIntent) stopIntent()
    }
  }, [enabled, navigate])
}

export default useLinkInterceptor
