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
vi.mock('../src/setup.js', () => ({ prefetchContent: vi.fn(), prefersReducedMotion: false }))

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
    getElementById: () => null,
  }
  globalThis.window = { location: { origin: 'https://site.test', assign: vi.fn() }, history: { pushState: vi.fn() } }
})
afterEach(() => {
  globalThis.uniweb = saved.uniweb
  globalThis.window = saved.window
  globalThis.document = saved.document
})

/** Arm the interceptor on `website`, with or without a host switch, and click an anchor. */
function click(website, attrs, { localeSwitch = null } = {}) {
  globalThis.uniweb = { activeWebsite: website, localeSwitch }
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
