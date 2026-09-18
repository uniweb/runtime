/**
 * The pathname the prerender lane reports to a foundation.
 *
 * `initPrerender` registers an SSR-safe `useLocation()` so a foundation's
 * `useRouting()` / `useLocation()` work during prerender. It built the pathname
 * as `'/' + website.activePage.route` — and a page's route is ALREADY
 * root-relative, so every prerendered page reported a doubled leading slash:
 * `//` on the homepage, `//about` elsewhere.
 *
 * ⛔ It failed silently for as long as it existed, because nothing in the runtime
 * reads pathname — a foundation does, and only in the built output. Measured
 * 2026-09-18: a language switcher passing `useLocation().pathname` into
 * `getLocaleUrl` emitted `href="//"`, which a browser resolves as a
 * PROTOCOL-RELATIVE url with an empty host, not as the site root. The SPA was
 * correct throughout, so the two lanes disagreed and only the static one was wrong.
 */

import { describe, it, expect } from 'vitest'
import { initPrerender } from '../src/ssr-renderer.js'

const foundation = { default: {} }

function locationFor(route) {
  const uniweb = initPrerender(
    { config: { defaultLanguage: 'en' }, pages: route === null ? [] : [{ route, sections: [] }] },
    foundation,
    []
  )
  if (route !== null) uniweb.activeWebsite.setActivePage?.(route)
  return uniweb.routingComponents.useLocation()
}

describe('the SSR useLocation stub', () => {
  it('reports the homepage as "/", never "//"', () => {
    expect(locationFor('/').pathname).toBe('/')
  })

  it('does not double the slash on an inner page', () => {
    expect(locationFor('/about').pathname).toBe('/about')
  })

  it('falls back to "/" when no page is active', () => {
    expect(locationFor(null).pathname).toBe('/')
  })

  it('never emits a protocol-relative pathname', () => {
    for (const route of ['/', '/about', '/docs/reference/faq']) {
      expect(locationFor(route).pathname.startsWith('//')).toBe(false)
    }
  })
})
