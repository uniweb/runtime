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
 * ⭐ The rule is `resolveRoute` (`@uniweb/core/resolve-route`) since 2026-09-30 — the one every
 * lane calls — and PageRenderer navigates to the location it gives. PageRenderer is a React
 * component wired to react-router, so rather than mount it, this pins the rule against a real
 * Website and checks the component reads its redirect from there.
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
    // Both halves matter: the translated slug AND the /fr prefix.
    expect(w.resolveRoute('/fr/Guide-de-démarrage-rapide')).toMatchObject({
      kind: 'redirect',
      reason: 'container',
      location: "/fr/Guide-de-démarrage-rapide/De-l'idée-au-site-Web",
    })
  })

  it('emits a bare canonical route in the default locale', () => {
    const w = site('en')
    expect(w.resolveRoute('/Quick-Start-Guide')).toMatchObject({
      kind: 'redirect',
      location: '/Quick-Start-Guide/From-Idea-to-Website',
    })
  })

  it('does not redirect a page that has its own content', () => {
    const w = site('fr')
    expect(w.resolveRoute("/fr/Guide-de-démarrage-rapide/De-l'idée-au-site-Web").kind).toBe('page')
  })

  it('does not redirect a folder whose landing is itself — the decision is canonical', () => {
    // The self-redirect trap: a folder with an index child lands on its own route. Comparing a
    // LOCALIZED destination against the canonical route makes `/fr/Articles` differ from
    // `/Articles` and loops.
    const w = new Website({
      content: {
        config: { name: 'T', defaultLanguage: 'en', activeLocale: 'fr', i18n: { routeTranslations: RT } },
        theme: {},
        pages: [
          { route: '/', isIndex: true, title: 'Home', sections: [] },
          { route: '/Articles', title: 'Articles', sections: [] },
          { route: '/Articles/index', isIndex: true, title: 'Index', sections: [{ type: 'Section' }] },
        ],
      },
    })
    expect(w.resolveRoute('/fr/Articles')).toMatchObject({ kind: 'page', route: '/Articles/index' })
  })

  /**
   * The cases above pin the RULE against a real Website — but they would keep passing if
   * PageRenderer stopped following it. These read the component itself so a revert fails.
   */
  describe('PageRenderer follows the rule', () => {
    it('resolves the URL with the Website', () => {
      expect(pageRendererSource).toMatch(/website\?\.resolveRoute\?\.\(location\.pathname\)/)
    })

    it('navigates to the location the resolution gives', () => {
      expect(pageRendererSource).toMatch(/resolution\?\.kind === 'redirect' \? resolution\.location/)
      expect(pageRendererSource).not.toMatch(/getNavigableRoute\(\)/)
    })
  })
})
