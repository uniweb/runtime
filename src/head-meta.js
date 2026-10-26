/**
 * A page's head metadata, as both of its writers state it: the prerender (`injectPageContent`)
 * and the browser (`useHeadMeta`).
 *
 * ⭐ `Page#getHeadMeta`'s, plus the address of the page's markdown (`markdown`), which the head
 * links with `<link rel="alternate" type="text/markdown">` so an agent that lands on the HTML finds
 * the document. The address is the one the site index gives the page, for the pages a markdown
 * file is written for (`pageMarkdownUrls`, `@uniweb/projections`). It is added here rather than
 * in core because core cannot depend on the package whose rules decide it.
 */

import { pageMarkdownUrls } from '@uniweb/projections/markdown-urls'

// A site's markdown addresses, worked out once for its content. `rebuild({ content })` gives the
// Website a new `pages` array, so that array is the key and a rebuilt site is worked out again.
const urlsOfPages = new WeakMap()

/**
 * @param {Object} page - a Page
 * @returns {Object} `page.getHeadMeta()`, and `markdown`: the URL of the page's markdown, or null —
 *   for a page the index leaves out and the not-found page, and for a record's page made on
 *   request (`uniweb dev`, a host), which is not among the content's pages. A static build's
 *   record pages are: its prerender writes them into the content each page boots with.
 */
export function pageHeadMeta(page) {
  return { ...page.getHeadMeta(), markdown: markdownUrlOf(page) }
}

function markdownUrlOf(page) {
  const website = page?.website
  if (!website) return null
  let urls = urlsOfPages.get(website.pages)
  if (!urls) {
    urls = pageMarkdownUrls({ pages: website.getContentPages(), config: website.config })
    urlsOfPages.set(website.pages, urls)
  }
  return urls.get(page.route) ?? null
}
