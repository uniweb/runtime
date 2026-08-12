/**
 * A content-less container redirects to its first child — in the CURRENT locale.
 *
 * `page.getNavigableRoute()` answers in canonical routes, which is right: the
 * hierarchy is canonical and the decision "does this folder have a page of its
 * own?" has nothing to do with language. But the value was then handed straight
 * to `navigate()`, so the destination lost BOTH the slug translation and the
 * `/<locale>` prefix. Visiting `/fr/Guide-de-démarrage-rapide` landed on
 * `/Quick-Start-Guide/From-Idea-to-Website` and served the page in ENGLISH —
 * a language switch the reader never asked for, from a URL that was correct.
 *
 * The split this pins: the DECISION stays canonical, the DESTINATION is
 * localized. Collapsing the two is the tempting simplification and it breaks a
 * folder that has an index child — there `getNavigableRoute()` returns the
 * folder's own route, so comparing a localized destination against a canonical
 * `page.route` finds a difference that isn't one and redirects forever.
 *
 * PageRenderer is a React component wired to react-router, so rather than mount
 * it, this pins the resolution rule it now follows against a real Website.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Website } from '@uniweb/core'

const pageRendererSource = readFileSync(
  fileURLToPath(new URL('../src/components/PageRenderer.jsx', import.meta.url)),
  'utf8'
)

const RT = {
  fr: {
    '/Quick-Start-Guide': '/Guide-de-démarrage-rapide',
    '/Quick-Start-Guide/From-Idea-to-Website': "/Guide-de-démarrage-rapide/De-l'idée-au-site-Web",
    '/Articles': '/Articles',
  },
}

/**
 * The rule PageRenderer applies: decide on canonical, navigate to localized.
 * Kept here in one place so the assertions below describe behaviour rather than
 * restate an implementation.
 */
function resolveRedirect(website, page) {
  const navigable = page && !page.redirect && !page.hasContent() ? page.getNavigableRoute() : null
  const shouldRedirect = !!(navigable && navigable !== page?.route)
  const target = shouldRedirect
    ? website?.getLocaleUrl?.(website.activeLocale, navigable) || navigable
    : null
  return { shouldRedirect, target }
}

function site(activeLocale) {
  return new Website({
    content: {
      config: {
        name: 'T',
        defaultLanguage: 'en',
        activeLocale,
        i18n: { routeTranslations: RT },
      },
      theme: {},
      pages: [
        { route: '/', isIndex: true, title: 'Home', sections: [] },
        // Container: page.yml but no sections of its own.
        { route: '/Quick-Start-Guide', title: 'Quick Start', sections: [] },
        {
          route: '/Quick-Start-Guide/From-Idea-to-Website',
          parentRoute: '/Quick-Start-Guide',
          title: 'From Idea to Website',
          sections: [{ type: 'Section', content: { type: 'doc', content: [] } }],
        },
      ],
    },
  })
}

describe('content-less container redirect', () => {
  it('keeps the reader in French', () => {
    const w = site('fr')
    w.setActiveLocale('fr')
    const container = w.pages.find((p) => p.route === '/Quick-Start-Guide')

    const { shouldRedirect, target } = resolveRedirect(w, container)

    expect(shouldRedirect).toBe(true)
    // Both halves matter: the translated slug AND the /fr prefix.
    expect(target).toBe("/fr/Guide-de-démarrage-rapide/De-l'idée-au-site-Web")
  })

  it('emits a bare canonical route in the default locale', () => {
    const w = site('en')
    const container = w.pages.find((p) => p.route === '/Quick-Start-Guide')

    const { shouldRedirect, target } = resolveRedirect(w, container)

    expect(shouldRedirect).toBe(true)
    expect(target).toBe('/Quick-Start-Guide/From-Idea-to-Website')
  })

  it('does not redirect a page that has its own content', () => {
    const w = site('fr')
    w.setActiveLocale('fr')
    const leaf = w.pages.find((p) => p.route === '/Quick-Start-Guide/From-Idea-to-Website')

    expect(resolveRedirect(w, leaf).shouldRedirect).toBe(false)
  })

  it('does not redirect when the navigable route is the page itself', () => {
    // The self-redirect trap: a folder whose getNavigableRoute() returns its own
    // route must compare CANONICAL to CANONICAL. Localizing before comparing
    // makes `/fr/Articles` differ from `/Articles` and loops.
    const w = site('fr')
    w.setActiveLocale('fr')
    const selfPage = { route: '/Articles', redirect: null, hasContent: () => false, getNavigableRoute: () => '/Articles' }

    expect(resolveRedirect(w, selfPage).shouldRedirect).toBe(false)
  })

  /**
   * The cases above pin the RULE against a real Website, which is the part worth
   * describing — but they would keep passing if PageRenderer stopped following
   * it. These two read the component itself so a revert actually fails.
   */
  describe('PageRenderer follows the rule', () => {
    it('localizes the redirect destination', () => {
      expect(pageRendererSource).toMatch(/getLocaleUrl\?\.\(\s*website\.activeLocale/)
    })

    it('decides on the canonical route, not the localized one', () => {
      // `shouldAutoRedirect` must compare getNavigableRoute()'s canonical output
      // against page.route. If it ever compares the localized destination, a
      // folder with an index child redirects to itself forever.
      expect(pageRendererSource).toMatch(/shouldAutoRedirect\s*=\s*!!\(\s*navigableRoute\s*&&\s*navigableRoute\s*!==\s*page\?\.route/)
    })
  })
})
