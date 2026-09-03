/**
 * The runtime executes a page's fetches for a host — one implementation of the fetch.
 * A host that renders in an isolate passes what this returns as `fetchedData`; it does not
 * resolve, request or unwrap with code of its own.
 */
import { describe, it, expect, vi } from 'vitest'
import { resolvePageFetchConfigs, executeFetchConfigs, prefetchPageData, findPageForRoute } from '../src/prefetch.js'
import { hydrateDataStore } from '../src/wire-foundation.js'
import DataStore, { deriveCacheKey } from '@uniweb/core/datastore'

// A payload as a backend publishes it: the records stamp with its envelope, one page with a
// query fetch, a [slug] child, and a section with its own remote fetch.
const CONTENT = {
  config: {
    base: '/site',
    defaultLanguage: 'en',
    languages: ['en'],
    queries: { members: { name: 'members', schema: '@std/person' } },
    records: { list: '/_records/{path}', record: '/_records/{path}/{param}', envelope: { records: 'entries' } },
  },
  pages: [
    { route: '/team', parent: null, isDynamic: false, fetch: { query: 'members', path: '/data/members.json', as: 'people' },
      sections: [{ type: 'List', fetch: { url: 'https://api.example.com/news', as: 'news', prerender: false } }] },
    { route: '/team/:slug', parent: '/team', isDynamic: true, paramName: 'slug', parentSchema: 'people', sections: [] },
  ],
}

function stubFetch(routes) {
  const calls = []
  const fetch = vi.fn(async (input) => {
    const url = String(input)
    calls.push(url)
    const hit = Object.entries(routes).find(([k]) => url.includes(k))
    const body = hit ? hit[1] : { entries: [] }
    return { ok: true, status: 200, statusText: 'OK', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) }
  })
  return { fetch, calls }
}

describe('resolvePageFetchConfigs', () => {
  it('resolves the page fetch to the records lane through config.records, once, keyed by cache key', () => {
    const cfgs = resolvePageFetchConfigs(CONTENT, '/team')
    const people = cfgs.find((c) => c.as === 'people')
    expect(people.endpoint).toBe('/_records/members')
    expect(people.path).toBeUndefined()
    expect(new Set(cfgs.map(deriveCacheKey)).size).toBe(cfgs.length)
  })

  it('includes a section\'s own fetch beside the page cascade', () => {
    const cfgs = resolvePageFetchConfigs(CONTENT, '/team')
    expect(cfgs.some((c) => c.as === 'news' && c.url === 'https://api.example.com/news')).toBe(true)
  })

  it('a [slug] route resolves through the same matcher the SPA uses, with its params', () => {
    const hit = findPageForRoute(CONTENT, '/team/ada')
    expect(hit.page.route).toBe('/team/:slug')
    expect(hit.params).toEqual({ slug: 'ada' })
    const cfgs = resolvePageFetchConfigs(CONTENT, '/team/ada')
    expect(cfgs.some((c) => c.as === 'people' && c.endpoint === '/_records/members')).toBe(true)
  })

  it('CONTROL — an unknown route resolves to nothing', () => {
    expect(resolvePageFetchConfigs(CONTENT, '/nope')).toEqual([])
  })
})

describe('executeFetchConfigs', () => {
  it('issues the records request through the injected fetch, under the payload base, and unwraps with the stamp\'s envelope', async () => {
    const { fetch, calls } = stubFetch({ '/_records/members': { entries: [{ slug: 'ada' }, { slug: 'lin' }] } })
    const configs = resolvePageFetchConfigs(CONTENT, '/team')
    const out = await executeFetchConfigs(configs, { content: CONTENT, fetch })
    expect(calls.some((u) => u.endsWith('/site/_records/members'))).toBe(true)
    const people = out.find((e) => e.config.as === 'people')
    expect(people.data).toEqual([{ slug: 'ada' }, { slug: 'lin' }])
  })

  it("prerender: 'author' — a fetch the author deferred is present as `skipped`, never requested", async () => {
    const { fetch, calls } = stubFetch({})
    const configs = resolvePageFetchConfigs(CONTENT, '/team')
    const out = await executeFetchConfigs(configs, { content: CONTENT, fetch, prerender: 'author' })
    expect(calls.some((u) => u.includes('api.example.com/news'))).toBe(false)
    const news = out.find((e) => e.config.as === 'news')
    expect(news.outcome).toBe('skipped')
    expect(out.every((e) => ['fetched', 'failed', 'skipped'].includes(e.outcome))).toBe(true)
  })

  it("the DEFAULT is 'always': a config the author deferred is tried — this entry's only caller is an isolate", async () => {
    const { fetch, calls } = stubFetch({ 'api.example.com/news': [{ id: 'n1' }] })
    const configs = resolvePageFetchConfigs(CONTENT, '/team')
    const out = await executeFetchConfigs(configs, { content: CONTENT, fetch })
    expect(calls.some((u) => u.includes('api.example.com/news'))).toBe(true)
    const news = out.find((e) => e.config.as === 'news')
    expect(news.outcome).toBe('fetched')
    expect(out.some((e) => e.outcome === 'skipped')).toBe(false)
  })

  it('CONTROL — an unknown prerender policy is refused, not defaulted', async () => {
    await expect(executeFetchConfigs([], { content: CONTENT, prerender: 'sometimes' })).rejects.toThrow(/prerender must be/)
  })

  it('hydrateDataStore takes only fetched entries — a skipped or failed one never enters the store', async () => {
    const fetch = vi.fn(async () => { throw new Error('binding down') })
    const fetched = await prefetchPageData({ content: CONTENT, route: '/team', fetch, prerender: 'author' })
    const dataStore = new DataStore()
    hydrateDataStore({ dataStore }, fetched)
    for (const e of fetched) expect(dataStore.has(deriveCacheKey(e.config))).toBe(false)
    expect(fetched.map((e) => e.outcome).sort()).toEqual(['failed', 'skipped'])
  })

  it('returns the shape hydrateDataStore consumes — round trip into a DataStore', async () => {
    const { fetch } = stubFetch({ '/_records/members': { entries: [{ slug: 'ada' }] } })
    const fetched = await prefetchPageData({ content: CONTENT, route: '/team', fetch })
    const dataStore = new DataStore()
    hydrateDataStore({ dataStore }, fetched)
    const people = fetched.find((e) => e.config.as === 'people')
    expect(dataStore.get(deriveCacheKey(people.config))?.data).toEqual([{ slug: 'ada' }])
  })

  it('CONTROL — a transport error is reported on the entry, not thrown', async () => {
    const fetch = vi.fn(async () => { throw new Error('binding down') })
    const configs = resolvePageFetchConfigs(CONTENT, '/team')
    const out = await executeFetchConfigs(configs, { content: CONTENT, fetch })
    const people = out.find((e) => e.config.as === 'people')
    expect(people.outcome).toBe('failed')
    expect(people.error).toBe('binding down')
    expect(people.data).toBeNull()
  })
})
