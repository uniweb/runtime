/**
 * The icon CDN base, and the payload key that names it.
 *
 * A site payload carries TWO unrelated things under the name `icons`, and the
 * runtime has one reader for each:
 *
 *   content.icons         { used, families, bySource, count }   the build's MANIFEST
 *   content.config.icons  { cdnUrl, cdn }                       the site's CONFIG
 *
 * `setup.js` passed the first where the second was wanted, so `cdnUrl` read as
 * `undefined` and every browser icon fetch went to the built-in default — while
 * `ssr-renderer.js`, reading both keys correctly, honored the configured base.
 * The two lanes disagreed silently: the same site prerendered against one CDN
 * and hydrated against another.
 *
 * The browser path is not a rare fallback. A prerendered page only carries the
 * icons its build found in markdown, so anything reached through fetched data
 * or authored after the build resolves at runtime — and a site whose payload
 * comes from a host takes its base from that payload.
 *
 * So the property under test is agreement: ONE payload, and both readers reach
 * the same base from it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createIconResolver } from '../src/setup.js'
import { prefetchIcons } from '../src/ssr-renderer.js'

const DEFAULT_CDN = 'https://uniweb.github.io/icons'
const HOST_CDN = 'https://icons.example.test'

/**
 * A payload shaped the way @uniweb/build's content-collector emits one:
 * the manifest at the top level, site.yml spread into `config`.
 */
function makePayload({ cdnUrl, cdn } = {}) {
  const icons = {}
  if (cdnUrl !== undefined) icons.cdnUrl = cdnUrl
  if (cdn !== undefined) icons.cdn = cdn

  return {
    config: {
      name: 'test-site',
      ...(Object.keys(icons).length ? { icons } : {}),
    },
    // The MANIFEST. Same key name, different thing.
    icons: {
      used: ['lu:house'],
      families: ['lu'],
      bySource: { 'lu:house': ['pages/home/1-hero.md'] },
      count: 1,
    },
  }
}

function stubFetch(svg = '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>') {
  const urls = []
  const fetchSpy = vi.fn(async (url) => {
    urls.push(url)
    return { ok: true, status: 200, text: async () => svg }
  })
  vi.stubGlobal('fetch', fetchSpy)
  return urls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('icon CDN base', () => {
  it('the browser resolver reads the configured base, not the default', async () => {
    const urls = stubFetch()
    const payload = makePayload({ cdnUrl: HOST_CDN })

    const resolve = createIconResolver(payload.config.icons)
    await resolve('lu', 'house')

    expect(urls).toEqual([`${HOST_CDN}/lu/lu-house.svg`])
  })

  it('falls back to the framework default when the site configures none', async () => {
    const urls = stubFetch()
    const payload = makePayload()

    const resolve = createIconResolver(payload.config.icons)
    await resolve('lu', 'house')

    expect(urls).toEqual([`${DEFAULT_CDN}/lu/lu-house.svg`])
  })

  it('`cdn: false` disables fetching entirely', async () => {
    const urls = stubFetch()
    const payload = makePayload({ cdn: false })

    const resolve = createIconResolver(payload.config.icons)
    const svg = await resolve('lu', 'house')

    expect(svg).toBeNull()
    expect(urls).toEqual([])
  })

  /**
   * The regression. Before the fix this passed the manifest, which has no
   * `cdnUrl`, so it silently produced the default — indistinguishable from a
   * site that configured nothing.
   */
  it('the MANIFEST is not the config — passing it loses the configured base', async () => {
    const urls = stubFetch()
    const payload = makePayload({ cdnUrl: HOST_CDN })

    const resolve = createIconResolver(payload.icons)
    await resolve('lu', 'house')

    expect(urls).toEqual([`${DEFAULT_CDN}/lu/lu-house.svg`])
    expect(urls[0]).not.toContain(HOST_CDN)
  })

  it('both lanes reach the same base from one payload', async () => {
    const urls = stubFetch()
    const payload = makePayload({ cdnUrl: HOST_CDN })

    // Prerender lane: list from the manifest, base from the config.
    await prefetchIcons(payload, { iconCache: new Map() })
    // Browser lane: base from the config.
    const resolve = createIconResolver(payload.config.icons)
    await resolve('lu', 'house')

    expect(urls).toHaveLength(2)
    expect(new Set(urls)).toEqual(new Set([`${HOST_CDN}/lu/lu-house.svg`]))
  })
})

/**
 * A guard on the call site itself.
 *
 * Every test above builds the resolver the way the fix builds it, so all of
 * them keep passing if `initUniweb` goes back to handing over the manifest —
 * the defect was never in the factory, it was in which object reached it.
 * Reading the wiring is what closes that, and it is the same technique
 * content-reader uses to pin its emission site.
 *
 * If a refactor moves this wiring, update the assertion — do not delete it
 * without replacing the coverage.
 */
describe('the wiring', () => {
  it('initUniweb builds the resolver from config.icons', async () => {
    const { readFile } = await import('node:fs/promises')
    const src = await readFile(new URL('../src/setup.js', import.meta.url), 'utf8')

    const call = src.match(/createIconResolver\(([^)]*)\)/g)?.find((c) => !c.includes('iconConfig'))

    expect(call, 'no createIconResolver() call site found in setup.js').toBeTruthy()
    expect(call).toContain('config')
  })
})
