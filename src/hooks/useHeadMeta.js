/**
 * useHeadMeta Hook
 *
 * Manages document head meta tags for SEO and social sharing.
 * Updates meta tags when page changes in SPA navigation.
 */

import { useEffect, useRef } from 'react'

/**
 * Meta tag definitions for easy management
 */
const META_TAGS = {
  description: { name: 'description' },
  keywords: { name: 'keywords' },
  robots: { name: 'robots' },
  'og:title': { property: 'og:title' },
  'og:description': { property: 'og:description' },
  'og:image': { property: 'og:image' },
  'og:url': { property: 'og:url' },
  'og:type': { property: 'og:type' },
  'twitter:card': { name: 'twitter:card' },
  'twitter:title': { name: 'twitter:title' },
  'twitter:description': { name: 'twitter:description' },
  'twitter:image': { name: 'twitter:image' }
}

/**
 * Get or create a meta tag element
 * @param {string} key - Meta tag key (e.g., 'description', 'og:title')
 * @returns {HTMLMetaElement}
 */
function getOrCreateMetaTag(key) {
  const config = META_TAGS[key]
  if (!config) return null

  const selector = config.property
    ? `meta[property="${config.property}"]`
    : `meta[name="${config.name}"]`

  let element = document.querySelector(selector)

  if (!element) {
    element = document.createElement('meta')
    if (config.property) {
      element.setAttribute('property', config.property)
    } else {
      element.setAttribute('name', config.name)
    }
    document.head.appendChild(element)
  }

  return element
}

/**
 * Get or create a link element (for canonical)
 * @param {string} rel - Link rel attribute
 * @returns {HTMLLinkElement}
 */
function getOrCreateLinkTag(rel) {
  let element = document.querySelector(`link[rel="${rel}"]`)

  if (!element) {
    element = document.createElement('link')
    element.setAttribute('rel', rel)
    document.head.appendChild(element)
  }

  return element
}

/**
 * Set or remove a meta tag's content
 * @param {string} key - Meta tag key
 * @param {string|null} content - Content value (null to remove)
 */
function setMetaContent(key, content) {
  const element = getOrCreateMetaTag(key)
  if (!element) return

  if (content) {
    element.setAttribute('content', content)
  } else {
    // Remove the tag if no content
    element.remove()
  }
}

/**
 * useHeadMeta hook
 *
 * @param {Object} meta - Head metadata
 * @param {string} meta.title - Page title
 * @param {string} meta.description - Meta description
 * @param {string} meta.keywords - Meta keywords (string or array)
 * @param {string} meta.canonical - Canonical URL
 * @param {string} meta.robots - Robots directive (e.g., 'noindex, nofollow')
 * @param {Object} meta.og - Open Graph metadata
 * @param {string} meta.og.title - OG title
 * @param {string} meta.og.description - OG description
 * @param {string} meta.og.image - OG image URL
 * @param {string} meta.og.url - OG URL
 * @param {Object} options - Hook options
 * @param {string} options.siteName - Site name for title suffix
 * @param {string} options.titleSeparator - Separator between page title and site name
 */
export function useHeadMeta(meta, options = {}) {
  const {
    siteName = '',
    titleSeparator = ' | '
  } = options

  // Track created elements for cleanup
  const createdElements = useRef([])

  useEffect(() => {
    if (!meta) return

    // Update document title
    if (meta.title) {
      const fullTitle = siteName
        ? `${meta.title}${titleSeparator}${siteName}`
        : meta.title
      document.title = fullTitle
    }

    // Update meta description
    setMetaContent('description', meta.description || null)

    // Update meta keywords
    const keywords = Array.isArray(meta.keywords)
      ? meta.keywords.join(', ')
      : meta.keywords
    setMetaContent('keywords', keywords || null)

    // Update robots
    setMetaContent('robots', meta.robots || null)

    // Update Open Graph tags
    if (meta.og) {
      setMetaContent('og:title', meta.og.title || meta.title || null)
      setMetaContent('og:description', meta.og.description || meta.description || null)
      setMetaContent('og:image', meta.og.image || null)
      setMetaContent('og:url', meta.og.url || null)
      setMetaContent('og:type', 'website')

      // Twitter cards (fallback to OG values)
      setMetaContent('twitter:card', meta.og.image ? 'summary_large_image' : 'summary')
      setMetaContent('twitter:title', meta.og.title || meta.title || null)
      setMetaContent('twitter:description', meta.og.description || meta.description || null)
      setMetaContent('twitter:image', meta.og.image || null)
    }

    // Update canonical link
    if (meta.canonical) {
      const canonicalLink = getOrCreateLinkTag('canonical')
      canonicalLink.setAttribute('href', meta.canonical)
    } else {
      // Remove canonical if not set
      const existingCanonical = document.querySelector('link[rel="canonical"]')
      if (existingCanonical) {
        existingCanonical.remove()
      }
    }

    // Cleanup function - reset to defaults on unmount
    return () => {
      // We don't remove tags on cleanup because another page will set them
      // Just reset title as a fallback
      document.title = siteName || 'Website'
    }
  }, [
    meta?.title,
    meta?.description,
    meta?.keywords,
    meta?.canonical,
    meta?.robots,
    meta?.og?.title,
    meta?.og?.description,
    meta?.og?.image,
    meta?.og?.url,
    siteName,
    titleSeparator
  ])
}

export default useHeadMeta
