/**
 * A content-less folder with an `isIndex` child renders that child — whichever
 * target form the caller holds.
 *
 * ⛔ `render()` takes a route OR an already-resolved page. The route form promoted
 * (via `Website#getPage`) and the page form did not, so the SAME page rendered
 * differently depending on how it was reached, with no error on either path. Ruled
 * 2026-09-12: the two forms agree, and `getRenderableSelf` is the one rule.
 */
import { describe, it, expect } from 'vitest'
import { Website } from '@uniweb/core'
import { createPageRenderer } from '../src/page-renderer.js'

const SHELL = '<html><head></head><body><div id="root"></div></body></html>'

const make = () => {
  const content = {
    config: { base: '/', defaultLanguage: 'en', languages: ['en'] },
    pages: [
      { route: '/', title: 'Home', sections: [{ type: 'Hero', content: {} }] },
      { route: '/docs', title: 'Docs', sections: [] },
      { route: '/docs/intro', title: 'Intro', parent: '/docs', isIndex: true, sections: [{ type: 'Hero', content: {} }] },
      { route: '/docs/guide', title: 'Guide', parent: '/docs', sections: [{ type: 'Hero', content: {} }] },
    ],
  }
  const website = new Website({ content })
  return { website, renderer: createPageRenderer({ website, shell: SHELL }) }
}

describe('index-child promotion is the same on both target forms', () => {
  it('⭐ an already-resolved PAGE promotes — this is what did not happen before', () => {
    const { website, renderer } = make()
    const folder = website.pages.find((p) => p.route === '/docs')
    expect(renderer.render(folder).page.route).toBe('/docs/intro')
  })

  it('a ROUTE promotes, as it always did', () => {
    const { renderer } = make()
    expect(renderer.render('/docs').page.route).toBe('/docs/intro')
  })

  it('⭐ the two forms AGREE — the property the rule exists for', () => {
    const { website, renderer } = make()
    const folder = website.pages.find((p) => p.route === '/docs')
    expect(renderer.render(folder).page.route).toBe(renderer.render('/docs').page.route)
  })

  it('CONTROL — a page WITH content is rendered as itself, not replaced', () => {
    const { website, renderer } = make()
    const guide = website.pages.find((p) => p.route === '/docs/guide')
    expect(renderer.render(guide).page.route).toBe('/docs/guide')
    expect(renderer.render('/docs/guide').page.route).toBe('/docs/guide')
  })

  it('CONTROL — plain page data with no methods degrades to itself rather than throwing', () => {
    const { renderer } = make()
    const out = renderer.render({ route: '/loose', sections: [] })
    expect(out.page.route).toBe('/loose')
  })
})
