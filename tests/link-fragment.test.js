/**
 * A link to a heading whose id isn't ASCII. An address percent-encodes the fragment and an id holds
 * it as written, so the id has to be read back out of the address, or there is nothing to scroll to.
 *
 * The hook runs in place: React's effect becomes synchronous, as in `locale-link-switch.test.js`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useEffect: (effect) => { effect() } }
})
let hash = ''
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/docs', hash }),
}))
vi.mock('../src/navigation.js', () => ({
  navigateInApp: vi.fn(),
  readsData: () => false,
}))

import { fragmentId, useLinkInterceptor } from '../src/hooks/useLinkInterceptor.js'

describe('fragmentId', () => {
  it('reads an id back out of an address', () => {
    expect(fragmentId('%C3%A9t%C3%A9-2026')).toBe('été-2026')
    expect(fragmentId('%E6%97%A5%E6%9C%AC%E8%AA%9E')).toBe('日本語')
  })

  it('leaves one already written as it is', () => {
    expect(fragmentId('été-2026')).toBe('été-2026')
    expect(fragmentId('getting-started')).toBe('getting-started')
  })

  it('leaves a fragment that does not decode as it is', () => {
    expect(fragmentId('100%')).toBe('100%')
    expect(fragmentId('%E0%A4%A')).toBe('%E0%A4%A')
  })
})

describe('arriving at a page with a fragment', () => {
  const saved = { window: globalThis.window, document: globalThis.document, raf: globalThis.requestAnimationFrame, uniweb: globalThis.uniweb }
  let sought
  let scrolled

  beforeEach(() => {
    sought = []
    scrolled = 0
    globalThis.document = {
      body: {},
      addEventListener() {},
      removeEventListener() {},
      getElementById: (id) => {
        sought.push(id)
        return id === 'été-2026' ? { scrollIntoView: () => { scrolled += 1 } } : null
      },
    }
    globalThis.window = { location: { origin: 'https://site.test', href: 'https://site.test/docs' }, history: { pushState() {} } }
    globalThis.requestAnimationFrame = (run) => run()
    globalThis.uniweb = {}
  })
  afterEach(() => {
    globalThis.window = saved.window
    globalThis.document = saved.document
    globalThis.requestAnimationFrame = saved.raf
    globalThis.uniweb = saved.uniweb
  })

  it('scrolls to a heading in another alphabet, named as the address writes it', () => {
    hash = '#%C3%A9t%C3%A9-2026'
    useLinkInterceptor({ enabled: true })
    expect(sought).toContain('été-2026')
    expect(scrolled).toBe(1)
  })
})
