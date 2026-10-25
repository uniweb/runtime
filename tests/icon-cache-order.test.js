/**
 * The icon cache a prerender writes into every page (`_iconCache`, `__ICON_CACHE__`) is in the
 * order the build names the icons (`icons.used`, sorted), whatever order their fetches settle in.
 *
 * ⛔ Until 2026-10-25 each icon was cached as its response arrived, so two builds of one site
 * wrote pages that differed in that order alone (measured: three builds, three orders).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { prefetchIcons } from '../src/ssr-renderer.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A fetch that answers each icon after its own delay; `missing` answers 404. */
function stubFetch(delays) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const name = url.match(/lu-([a-z-]+)\.svg$/)[1]
      await new Promise((settle) => setTimeout(settle, delays[name]))
      if (name === 'missing') return { ok: false, status: 404, text: async () => '' }
      return { ok: true, status: 200, text: async () => `<svg data-icon="${name}"/>` }
    })
  )
}

const payload = (used) => ({ config: {}, icons: { used, families: ['lu'], count: used.length } })

describe('prefetchIcons', () => {
  it('⭐ caches the icons in the order the build names them, not the order they arrive', async () => {
    // The last one named arrives first.
    stubFetch({ activity: 30, database: 15, zap: 1 })
    const content = payload(['lu:activity', 'lu:database', 'lu:zap'])
    const uniweb = { iconCache: new Map() }
    await prefetchIcons(content, uniweb)

    expect(Object.keys(content._iconCache)).toEqual(['lu:activity', 'lu:database', 'lu:zap'])
    expect([...uniweb.iconCache.keys()]).toEqual(['lu:activity', 'lu:database', 'lu:zap'])
    expect(content._iconCache['lu:zap']).toBe('<svg data-icon="zap"/>')
  })

  it('an icon that fails to fetch is left out, and the rest keep their order', async () => {
    stubFetch({ activity: 20, missing: 1, zap: 1 })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const content = payload(['lu:activity', 'lu:missing', 'lu:zap'])
    await prefetchIcons(content, { iconCache: new Map() })

    expect(Object.keys(content._iconCache)).toEqual(['lu:activity', 'lu:zap'])
  })
})
