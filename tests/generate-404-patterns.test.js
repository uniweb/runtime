/**
 * The 404 shell's dynamic-route patterns — which routes get "clear #root and let
 * the SPA resolve this" treatment.
 *
 * ⛔ This filtered on `page.isDynamic` ALONE and had no test. A payload whose
 * producer marks only the bracket page — or no page at all — left every parametric
 * route out of the list, and the symptom is quiet: a cold hit on such a URL shows
 * the 404 body and never clears #root, so the SPA never takes over.
 *
 * ⭐ The rule now: a route carrying a `:` segment IS parametric, whoever did or did
 * not flag it. The flag is a producer's claim about the page; the route is the
 * thing itself.
 */
import { describe, it, expect } from 'vitest'
import { Website } from '@uniweb/core'
import { generate404Html } from '../src/ssr-renderer.js'

const SHELL = '<html><head></head><body><div id="root"></div></body></html>'

const build = (pages) => {
  const siteContent = {
    config: { base: '/', defaultLanguage: 'en', languages: ['en'] },
    pages,
  }
  const website = new Website({ content: siteContent })
  return generate404Html({ baseHtml: SHELL, website, siteContent }).html
}

describe('the 404 shell lists every parametric route', () => {
  it('⭐ an UNFLAGGED parametric route is listed — the producer need not claim it', () => {
    const html = build([
      { route: '/', title: 'Home', sections: [] },
      { route: '/blog/:slug', title: 'Post', sections: [] },          // no isDynamic
      { route: '/team/:slug/bio', title: 'Bio', sections: [] },       // nested, no isDynamic
    ])
    expect(html).toContain('blog')
    expect(html).toContain('team')
  })

  it('a flagged route is still listed — the flag remains sufficient', () => {
    const html = build([
      { route: '/', title: 'Home', sections: [] },
      { route: '/members/:slug/cv', title: 'CV', isDynamic: true, paramName: 'slug', sections: [] },
    ])
    expect(html).toContain('members')
  })

  it('CONTROL — a static route is NOT listed, or the script would clear #root for every 404', () => {
    const html = build([
      { route: '/', title: 'Home', sections: [] },
      { route: '/about-us-static', title: 'About', sections: [] },
    ])
    expect(html).not.toContain('about-us-static')
  })

  it('CONTROL — a catch-all is listed too', () => {
    const html = build([
      { route: '/', title: 'Home', sections: [] },
      { route: '/docs/:path*', title: 'Docs', sections: [] },
    ])
    expect(html).toContain('docs')
  })
})
