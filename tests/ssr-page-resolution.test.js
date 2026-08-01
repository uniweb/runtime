/**
 * The SSR surface's two page-shaped obligations.
 *
 * Both of these came out of one live incident: a host serving pages from this
 * renderer found detail pages returning a valid, completely empty document with
 * no error. Two separate causes, each of which looked like the renderer working.
 *
 *  1. `renderPage(page, …)` took a Page and this module exported no way to GET
 *     one, so the host wrote its own lookup — three times, in three files. The
 *     obvious one is an exact match over `website.pages`, which can never match
 *     a dynamic route: the payload holds `/blog/:id` and the request carries
 *     `/blog/1`.
 *  2. Once resolution worked, the page rendered empty and reported success,
 *     because `bodyBlocks` returns [] when sections are absent from the payload
 *     — correct for the SPA, which loads them first, and silent here, which
 *     never has.
 *
 * The second is the one worth a test forever: a renderer that reports success
 * having produced nothing is indistinguishable from one that worked.
 */

import { describe, it, expect } from 'vitest'
import { renderPage, resolvePage } from '../src/ssr-renderer.js'

/** A Page double — only the surface renderPage touches. */
function makePage({ route, hasContent = true, blocks = [] }) {
  return {
    route,
    hasContent: () => hasContent,
    getBodyBlocks: () => blocks,
    getPageBlocks: () => blocks,
    getLayoutName: () => 'default',
    getLayoutAreas: () => ({}),
    getLayoutParams: () => ({}),
    layout: { hide: [] },
  }
}

function makeWebsite(pages = {}) {
  return {
    setActivePage() {},
    getPage: (route) => pages[route],
    getRemoteLayout: () => null,
    getLayoutMeta: () => null,
    getAreaBlocks: () => null,
    getLayoutAreas: () => ({}),
    viewTransitions: false,
    themeData: {},
  }
}

describe('resolvePage', () => {
  it('delegates to the website graph, so a host runs the browser’s resolution', () => {
    const page = makePage({ route: '/blog/1' })
    const website = makeWebsite({ '/blog/1': page })

    expect(resolvePage(website, '/blog/1')).toBe(page)
  })

  it('returns undefined for a route nothing matches — a genuine 404', () => {
    expect(resolvePage(makeWebsite(), '/no-such-page')).toBeUndefined()
  })
})

describe('renderPage — a page whose sections were never loaded', () => {
  /**
   * The incident, pinned. Without this branch the renderer returns
   * `{ renderedContent: '' }` and the caller ships an empty document as a
   * success.
   */
  it('errors rather than rendering an empty document', () => {
    const page = makePage({ route: '/blog/1', hasContent: true, blocks: [] })
    const result = renderPage(page, makeWebsite())

    expect(result.error).toBeDefined()
    expect(result.error.type).toBe('content-not-loaded')
    expect(result.error.message).toContain('/blog/1')
    expect(result.renderedContent).toBeUndefined()
  })

  // The discriminator has to let this through: a folder with a page.yml and no
  // markdown is legitimately empty, and reports hasContent() === false.
  it('does NOT error for a content-less container, which is correctly empty', () => {
    const page = makePage({ route: '/docs', hasContent: false, blocks: [] })
    const result = renderPage(page, makeWebsite())

    expect(result.error).toBeUndefined()
    expect(typeof result.renderedContent).toBe('string')
  })

  // Guards the discriminator against being too broad: having blocks must take
  // the ordinary path. The block resolves to no component, which renders the
  // visible "Component not found" box — a rendered page, which is the point.
  it('renders normally when the page has blocks', () => {
    const block = { id: 'x', type: 'Missing', initComponent: () => null }
    const page = makePage({ route: '/blog', hasContent: true, blocks: [block] })

    const result = renderPage(page, makeWebsite())

    expect(result.error).toBeUndefined()
    expect(result.renderedContent).toContain('Component not found')
  })
})
