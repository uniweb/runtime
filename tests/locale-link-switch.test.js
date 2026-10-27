/**
 * A click on a link to another locale's page. That locale is its own document, so the browser
 * loads it, and the interceptor leaves the click alone. A host that switches locale its own way
 * (`uniweb.localeSwitch`: an editor's preview, which a page load would leave) is handed the
 * switch instead, from a `<Link reload>` and from a plain link alike.
 *
 * The hook runs in place: React's effect becomes synchronous, so the click handler it adds to
 * the document is the one these clicks reach.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useEffect: (effect) => { effect() } }
})
const navigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: '/', hash: '' }),
}))
// The navigation itself is `navigation.test.js`'s subject: here it hands the route straight on.
vi.mock('../src/navigation.js', () => ({
  navigateInApp: (navigate, to, ...options) => navigate(to, ...options),
  readsData: () => false,
}))

import { Website } from '@uniweb/core'
import { useLinkInterceptor, localeSwitchOf } from '../src/hooks/useLinkInterceptor.js'

function site(config = {}, page = '/About-Us') {
  const website = new Website({
    content: {
      config: {
        name: 'T',
        defaultLanguage: 'en',
        languages: ['en', 'fr'],
        i18n: { routeTranslations: { fr: { '/About-Us': '/a-propos' } } },
        ...config,
      },
      theme: {},
      pages: [
        { route: '/', isIndex: true, title: 'Home', sections: [] },
        { route: '/About-Us', title: 'About', sections: [] },
      ],
    },
  })
  website.setActivePage(page)
  return website
}

const saved = { uniweb: globalThis.uniweb, window: globalThis.window, document: globalThis.document }
let clickHandler
beforeEach(() => {
  navigate.mockClear()
  clickHandler = null
  globalThis.document = {
    body: {},
    addEventListener: (type, handler) => { if (type === 'click') clickHandler = handler },
    removeEventListener() {},
    getElementById: () => ({ scrollIntoView() {} }),
  }
  globalThis.window = {
    location: { origin: 'https://site.test', href: 'https://site.test/', assign: vi.fn() },
    history: { pushState: vi.fn() },
  }
})
afterEach(() => {
  globalThis.uniweb = saved.uniweb
  globalThis.window = saved.window
  globalThis.document = saved.document
})

/** Arm the interceptor on `website`, at the page URL `at`, with or without a host switch, and click an anchor. */
function click(website, attrs, { localeSwitch = null, at = '/' } = {}) {
  globalThis.uniweb = { activeWebsite: website, localeSwitch }
  globalThis.window.location.href = `https://site.test${at}`
  useLinkInterceptor({ enabled: true })
  const anchor = {
    tagName: 'A',
    parentElement: null,
    getAttribute: (name) => attrs[name] ?? null,
    hasAttribute: (name) => name in attrs,
  }
  const event = { target: anchor, button: 0, defaultPrevented: false, preventDefault: vi.fn() }
  clickHandler(event)
  return event
}

describe('with a host switch, the host is handed the switch', () => {
  it('from a reload link, told the locale, the canonical route and the URL', () => {
    const localeSwitch = vi.fn()
    const event = click(site(), { href: '/fr/a-propos', 'data-reload': 'true' }, { localeSwitch })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(localeSwitch).toHaveBeenCalledWith({ locale: 'fr', route: '/About-Us', url: '/fr/a-propos' })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('from a plain link to the page in that locale, under the base path too', () => {
    const localeSwitch = vi.fn()
    const website = site({ activeLocale: 'fr' }, '/fr/a-propos')
    website.setBasePath('/docs/')
    const event = click(website, { href: '/docs/About-Us' }, { localeSwitch })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(localeSwitch).toHaveBeenCalledWith({ locale: 'en', route: '/About-Us', url: '/docs/About-Us' })
  })

  it('but not from a reload link that stays in the locale: the browser loads it', () => {
    const localeSwitch = vi.fn()
    const event = click(site(), { href: '/login', 'data-reload': 'true' }, { localeSwitch })
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(localeSwitch).not.toHaveBeenCalled()
  })

  it('and not from a link to a page in the active locale, which the router takes', () => {
    const localeSwitch = vi.fn()
    const event = click(site({}, '/'), { href: '/About-Us' }, { localeSwitch })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(localeSwitch).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/About-Us')
  })
})

describe('with no host switch, the browser loads the other locale', () => {
  it.each([
    ['a reload link', { href: '/fr/a-propos', 'data-reload': 'true' }],
    ['a plain link', { href: '/fr/a-propos' }],
  ])('from %s', (_, attrs) => {
    const event = click(site(), attrs)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})

// ⛔ Until 2026-10-24 an href that was not a path counted as the default locale's: on another
// locale's page a query or a relative link was a page load, which left a host's frame.
describe('an href that is not a path goes where the browser would take it', () => {
  const french = () => site({ activeLocale: 'fr' }, '/fr/a-propos')
  const at = '/fr/a-propos'

  it.each([
    ['a query', '?tab=2', '/fr/a-propos?tab=2'],
    ['a relative link', 'blogue', '/fr/blogue'],
    ['a same-origin URL', 'https://site.test/fr/blogue', '/fr/blogue'],
  ])('%s that stays in the locale is the router\'s, with or without a host', (_, href, path) => {
    for (const localeSwitch of [null, vi.fn()]) {
      navigate.mockClear()
      const event = click(french(), { href }, { localeSwitch, at })
      expect(event.preventDefault).toHaveBeenCalled()
      expect(navigate).toHaveBeenCalledWith(path)
      if (localeSwitch) expect(localeSwitch).not.toHaveBeenCalled()
    }
  })

  it('a relative link to another locale is a switch like any other', () => {
    const localeSwitch = vi.fn()
    const event = click(french(), { href: '../About-Us' }, { localeSwitch, at })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(localeSwitch).toHaveBeenCalledWith({ locale: 'en', route: '/About-Us', url: '/About-Us' })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('a fragment scrolls this page', () => {
    const event = click(french(), { href: '#team' }, { localeSwitch: vi.fn(), at })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(globalThis.window.history.pushState).toHaveBeenCalledWith(null, '', '#team')
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('localeSwitchOf: the locale and page a path names, when it leaves the active one', () => {
  it.each([
    ['/fr/a-propos', 'en', { locale: 'fr', route: '/About-Us' }],
    ['/fr', 'en', { locale: 'fr', route: '/' }],
    ['/fr?ref=menu', 'en', { locale: 'fr', route: '/' }],
    ['/About-Us#team', 'fr', { locale: 'en', route: '/About-Us' }],
    ['/About-Us', 'en', null],
    ['/fr/a-propos', 'fr', null],
    ['#team', 'fr', null],
    ['//cdn.test/fr/x', 'en', null],
  ])('%s from %s', (path, activeLocale, expected) => {
    const page = activeLocale === 'fr' ? '/fr/a-propos' : '/About-Us'
    expect(localeSwitchOf(path, site({ activeLocale }, page))).toEqual(expected)
  })

  it('and none on a site of one locale', () => {
    expect(localeSwitchOf('/fr/a-propos', site({ languages: ['en'] }))).toBe(null)
  })
})
