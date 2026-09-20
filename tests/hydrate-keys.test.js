/**
 * ⭐ A HYDRATED ANSWER IS FILED WHERE THE RENDER LOOKS — including for a transport that keys its
 * own requests.
 *
 * A build and a host both arrive with answers in hand: baked into a payload, or fetched by the
 * render's data step. What makes them worth anything is being findable by the dispatcher's `peek`,
 * which is what every render reads through.
 *
 * ⛔ `hydrateDataStore` derived the key itself until 2026-09-20 (`deriveCacheKey`). That is right
 * for every request the framework's own fetcher answers, and wrong for one the SITE routes to a
 * transport declaring its own `cacheKey` — the documented case being a request whose identity
 * depends on state its address does not carry. Measured: the entry landed where no peek looks, so
 * every prerendered page of such a site rendered empty and the browser refetched it, with no error
 * anywhere. The derivation has one home now: the dispatcher, where the selection happens.
 */
import { describe, it, expect, vi } from 'vitest'
import { initPrerender } from '../src/ssr-renderer.js'
import { hydrateDataStore } from '../src/wire-foundation.js'

const ITEMS = [{ id: '1', title: 'One' }]
const keyed = { resolve: vi.fn(async () => ({ data: ITEMS })), cacheKey: (req) => `mine:${req.as}` }

const foundation = {
  default: {
    meta: { X: { data: { items: null, other: null } } },
    capabilities: { transports: { mine: keyed } },
  },
}

/** A site that routes ONE key to that transport and leaves the other to the framework's fetcher. */
function site() {
  return initPrerender({
    config: {
      name: 'T',
      defaultLanguage: 'en',
      fetcher: { transports: { items: 'mine' } },
      queries: { items: { schema: '@/item', path: '/data/items.json' } },
    },
    pages: [{ route: '/', isIndex: true, title: 'Home', sections: [{ type: 'X', content: {}, params: {} }] }],
  }, foundation, []).activeWebsite
}

const ITEMS_CFG = { path: '/data/items.json', as: 'items' }
const OTHER_CFG = { path: '/data/other.json', as: 'other' }

describe('hydrateDataStore files by the dispatcher’s key', () => {
  it('a key the site routes to a keyed transport is findable after hydration', () => {
    const website = site()
    hydrateDataStore(website, [{ config: ITEMS_CFG, data: ITEMS, outcome: 'fetched' }])
    expect(website.fetcher.peek(ITEMS_CFG, { website })).toEqual({ data: ITEMS })
  })

  it('CONTROL — so is one the framework’s own fetcher answers', () => {
    const website = site()
    hydrateDataStore(website, [{ config: OTHER_CFG, data: [{ id: '2' }], outcome: 'fetched' }])
    expect(website.fetcher.peek(OTHER_CFG, { website })).toEqual({ data: [{ id: '2' }] })
  })

  it('CONTROL — an outcome that is not `fetched` is still not hydrated', () => {
    const website = site()
    hydrateDataStore(website, [{ config: ITEMS_CFG, data: null, outcome: 'skipped' }])
    expect(website.fetcher.peek(ITEMS_CFG, { website })).toBeNull()
  })

  it('a graph with no dispatcher still hydrates — a caller assembling one by hand', async () => {
    const { default: DataStore, deriveCacheKey } = await import('@uniweb/core/datastore')
    const dataStore = new DataStore()
    hydrateDataStore({ dataStore }, [{ config: OTHER_CFG, data: ['x'], outcome: 'fetched' }])
    expect(dataStore.get(deriveCacheKey(OTHER_CFG))).toEqual({ data: ['x'] })
  })
})
