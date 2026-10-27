/**
 * Prefetch on intent. A pointer resting on a link, focus staying on one, or a press fetches the
 * page the link goes to, before the click (`link-intent.js`). A pointer sweeping across a rail of
 * links fetches nothing, and neither does a link a click would not route in the app
 * (`useLinkInterceptor`). Only a site with pages still to fetch loads the module.
 *
 * The hook runs in place: React's effect becomes synchronous, so the listeners it adds to the
 * document are the ones these events reach.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useEffect: (effect) => { effect() } }
})
vi.mock('react-router-dom', () => ({
  useNavigate: () => () => {},
  useLocation: () => ({ pathname: '/', hash: '' }),
}))
const { prefetchPage } = vi.hoisted(() => ({ prefetchPage: vi.fn() }))
// The page's fetch is `navigation.test.js`'s subject; whether the site reads data is the real rule.
vi.mock('../src/navigation.js', async (importOriginal) => ({
  ...(await importOriginal()),
  navigateInApp: vi.fn(),
  prefetchPage,
}))

import { Website } from '@uniweb/core'
import { useLinkInterceptor } from '../src/hooks/useLinkInterceptor.js'
import { watchLinkIntent } from '../src/link-intent.js'

function site({ split = true, basePath, queries } = {}) {
  const website = new Website({
    content: {
      config: {
        ...(queries ? { queries } : {}),
        name: 'T',
        defaultLanguage: 'en',
        languages: ['en', 'fr'],
        i18n: { routeTranslations: { fr: { '/About-Us': '/a-propos' } } },
      },
      theme: {},
      pages: [
        { route: '/', isIndex: true, title: 'Home', sections: [] },
        // A split page arrives without its sections, which its content file holds.
        split
          ? { route: '/About-Us', title: 'About', hasContent: true }
          : { route: '/About-Us', title: 'About', sections: [{ type: 'Hero', content: {} }] },
      ],
    },
  })
  website.setActivePage('/')
  if (basePath) website.setBasePath(basePath)
  return website
}

/** An anchor, and an element inside it. */
function anchor(attrs = {}) {
  const a = {
    tagName: 'A',
    parentElement: null,
    getAttribute: (name) => attrs[name] ?? null,
    hasAttribute: (name) => name in attrs,
    contains: (node) => node === a || node?.parentElement === a,
  }
  return a
}
const inside = (a) => ({ tagName: 'SPAN', parentElement: a })

const saved = { uniweb: globalThis.uniweb, window: globalThis.window, document: globalThis.document }
let on
beforeEach(() => {
  on = {}
  globalThis.document = {
    body: {},
    addEventListener: (type, handler) => { on[type] = handler },
    removeEventListener: (type) => { delete on[type] },
  }
  prefetchPage.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Object.assign(globalThis, saved)
})

describe('watchLinkIntent: a link a reader is about to follow has its page fetched', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    globalThis.window = { location: { origin: 'https://site.test', href: 'https://site.test/' } }
    globalThis.uniweb = { activeWebsite: site(), localeSwitch: null }
  })
  const link = () => anchor({ href: '/About-Us' })

  it('when the pointer rests on it', () => {
    watchLinkIntent()
    on.pointerover({ target: link() })
    vi.advanceTimersByTime(64)
    expect(prefetchPage).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(prefetchPage).toHaveBeenCalledWith('/About-Us')
  })

  it('once, while the pointer moves within it', () => {
    watchLinkIntent()
    const a = link()
    const label = inside(a)
    on.pointerover({ target: a })
    vi.advanceTimersByTime(40)
    on.pointerout({ target: a, relatedTarget: label })
    on.pointerover({ target: label })
    vi.advanceTimersByTime(25)
    expect(prefetchPage).toHaveBeenCalledTimes(1)
  })

  it('at once when it is pressed, since a touch has no hover', () => {
    watchLinkIntent()
    on.pointerdown({ target: link() })
    expect(prefetchPage).toHaveBeenCalledTimes(1)
  })

  it('when focus stays on it', () => {
    watchLinkIntent()
    on.focusin({ target: link() })
    vi.advanceTimersByTime(65)
    expect(prefetchPage).toHaveBeenCalledTimes(1)
  })

  it('but not for a pointer passing over it', () => {
    watchLinkIntent()
    const a = link()
    on.pointerover({ target: a })
    vi.advanceTimersByTime(30)
    on.pointerout({ target: a, relatedTarget: null })
    vi.advanceTimersByTime(100)
    expect(prefetchPage).not.toHaveBeenCalled()
  })

  it('nor for focus moving on past it', () => {
    watchLinkIntent()
    const a = link()
    on.focusin({ target: a })
    on.focusout({ target: a, relatedTarget: anchor({ href: '/' }) })
    vi.advanceTimersByTime(100)
    expect(prefetchPage).not.toHaveBeenCalled()
  })

  it('nor on a connection that asks to save data', () => {
    vi.stubGlobal('navigator', { connection: { saveData: true } })
    watchLinkIntent()
    expect(on).toEqual({})
  })

  it('until it stops watching', () => {
    const stop = watchLinkIntent()
    on.pointerover({ target: link() })
    stop()
    vi.advanceTimersByTime(100)
    expect(prefetchPage).not.toHaveBeenCalled()
    expect(on).toEqual({})
  })
})

describe('useLinkInterceptor: which sites and links prefetch', () => {
  async function arm(website) {
    globalThis.window = { location: { origin: 'https://site.test', href: 'https://site.test/' } }
    globalThis.uniweb = { activeWebsite: website, localeSwitch: null }
    useLinkInterceptor({ enabled: true })
    await vi.dynamicImportSettled()
  }

  it('a site with pages to fetch watches for intent, by router path', async () => {
    await arm(site({ basePath: '/docs/' }))
    on.pointerdown({ target: anchor({ href: '/docs/About-Us' }) })
    expect(prefetchPage).toHaveBeenCalledWith('/About-Us')
  })

  it('a site whose pages all came with it, and that reads data, watches for intent', async () => {
    await arm(site({ split: false, queries: { articles: { schema: '@/article' } } }))
    on.pointerdown({ target: anchor({ href: '/About-Us' }) })
    expect(prefetchPage).toHaveBeenCalledWith('/About-Us')
  })

  it('a site whose pages all came with it, and that reads no data, does not load the module', async () => {
    await arm(site({ split: false }))
    expect(on.click).toBeTypeOf('function')
    expect(on.pointerdown).toBeUndefined()
  })

  it.each([
    ['another site', { href: 'https://elsewhere.test/About-Us' }],
    ['a download', { href: '/About-Us', download: '' }],
    ['another tab', { href: '/About-Us', target: '_blank' }],
    ['a full-page reload', { href: '/About-Us', 'data-reload': 'true' }],
    ['a fragment on this page', { href: '#top' }],
    ["another locale's page, which is its own document", { href: '/fr/a-propos' }],
  ])('a link to %s fetches nothing', async (_, attrs) => {
    await arm(site())
    on.pointerdown({ target: anchor(attrs) })
    expect(prefetchPage).not.toHaveBeenCalled()
  })
})
