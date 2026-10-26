/**
 * useHeadMeta Hook
 *
 * Manages document head meta tags for SEO and social sharing.
 * Updates meta tags when page changes in SPA navigation.
 *
 * ⭐ The browser twin of `injectPageContent`'s head tags, from the same source
 * (`pageHeadMeta`), so a crawler that runs the page's script reads what one that
 * does not read. These tags are the framework's: each is set when the page has a value
 * and removed when it has none — as it must be, or a tag of the page before survives a
 * navigation. ⛔ Until 2026-10-25 this removed the canonical of every page that did not
 * author one, after the prerendered HTML had stated it.
 */

import { useEffect, useRef } from 'react'
import { documentTitle } from '../document-title.js'

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
  'og:site_name': { property: 'og:site_name' },
  'twitter:card': { name: 'twitter:card' },
  'twitter:site': { name: 'twitter:site' },
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
 * Set or remove a meta tag's content — one tag of each name, whoever wrote the others
 * @param {string} key - Meta tag key
 * @param {string|null} content - Content value (null to remove)
 */
function setMetaContent(key, content) {
  const element = getOrCreateMetaTag(key)
  if (!element) return
  const config = META_TAGS[key]
  for (const extra of document.querySelectorAll(`meta[${config.property ? 'property' : 'name'}="${config.property || config.name}"]`)) {
    if (extra !== element) extra.remove()
  }

  if (content) {
    element.setAttribute('content', content)
  } else {
    // Remove the tag if no content
    element.remove()
  }
}

/**
 * The page's URL in each locale (`hreflang`), replacing whatever the document carried
 * @param {Array<{hreflang: string, url: string}>} alternates
 */
function setAlternates(alternates) {
  for (const link of document.querySelectorAll('link[rel="alternate"][hreflang]')) link.remove()
  for (const { hreflang, url } of alternates || []) {
    const link = document.createElement('link')
    link.setAttribute('rel', 'alternate')
    link.setAttribute('hreflang', hreflang)
    link.setAttribute('href', url)
    document.head.appendChild(link)
  }
}

/**
 * The link to the page's markdown, replacing whatever the document carried
 * @param {string|null} href
 */
function setMarkdownLink(href) {
  for (const link of document.querySelectorAll('link[rel="alternate"][type="text/markdown"]')) link.remove()
  if (!href) return
  const link = document.createElement('link')
  link.setAttribute('rel', 'alternate')
  link.setAttribute('type', 'text/markdown')
  link.setAttribute('href', href)
  document.head.appendChild(link)
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
 */
export function useHeadMeta(meta, options = {}) {
  const { siteName = '' } = options

  // Track created elements for cleanup
  const createdElements = useRef([])

  useEffect(() => {
    if (!meta) return

    // Update document title — by the rule the prerendered `<title>` is written with
    // (`documentTitle`), so a prerendered page keeps its title when the bundle loads.
    const fullTitle = documentTitle(meta.title, siteName)
    if (fullTitle) document.title = fullTitle

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
      setMetaContent('og:site_name', meta.og.siteName || null)

      // Twitter cards (fallback to OG values)
      setMetaContent('twitter:card', meta.og.image ? 'summary_large_image' : 'summary')
      setMetaContent('twitter:site', meta.twitter?.site || null)
      setMetaContent('twitter:title', meta.og.title || meta.title || null)
      setMetaContent('twitter:description', meta.og.description || meta.description || null)
      setMetaContent('twitter:image', meta.og.image || null)
    }

    // Update canonical link — the page's own URL unless it authors one, and none when the site's
    // address is unknown (`Page#getHeadMeta`)
    if (meta.canonical) {
      const canonicalLink = getOrCreateLinkTag('canonical')
      canonicalLink.setAttribute('href', meta.canonical)
      for (const extra of document.querySelectorAll('link[rel="canonical"]')) {
        if (extra !== canonicalLink) extra.remove()
      }
    } else {
      for (const existing of document.querySelectorAll('link[rel="canonical"]')) existing.remove()
    }

    setAlternates(meta.alternates)
    setMarkdownLink(meta.markdown || null)

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
    meta?.og?.siteName,
    meta?.twitter?.site,
    JSON.stringify(meta?.alternates || []),
    meta?.markdown,
    siteName
  ])
}

export default useHeadMeta
