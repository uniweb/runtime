/**
 * The runtime executes a page's fetches for a host — one implementation of the fetch.
 * A host that renders in an isolate passes what this returns as `fetchedData`; it does not
 * resolve, request or unwrap with code of its own.
 */
import { describe, it, expect, vi } from 'vitest'
import { resolvePageFetchConfigs, executeFetchConfigs, prefetchPageData, findPageForRoute } from '../src/prefetch.js'
import { hydrateDataStore } from '../src/wire-foundation.js'
import DataStore, { deriveCacheKey } from '@uniweb/core/datastore'

// A payload as a backend publishes it: the `records` service row and the query's Model ref,
// one page with a query fetch, a [slug] child, and a section with its own remote fetch.
const CONTENT = {
  config: {
    base: '/site',
    defaultLanguage: 'en',
    languages: ['en'],
    queries: { members: { name: 'members', schema: '@std/person' } },
    services: { records: '/_records/_query/{locale}' },
  },
  pages: [
    { route: '/team', parent: null, isDynamic: false, fetch: { query: 'members', path: '/data/members.json', as: 'people' },
      sections: [{ type: 'List', fetch: { url: 'https://api.example.com/news', as: 'news', prerender: false } }] },
    { route: '/team/:slug', parent: '/team', isDynamic: true, paramName: 'slug', parentSchema: 'people', sections: [] },
  ],
}

// `routes` answers a URL by substring. A ask route's value is a FUNCTION of the
// posted question map, answering per key the way the ask does: the record
// question (narrowed by `$name`) gets the full record, any other the briefs.
function stubFetch(routes) {
  const calls = []
  const fetch = vi.fn(async (input, init) => {
    const url = String(input)
    calls.push(url)
    const hit = Object.entries(routes).find(([k]) => url.includes(k))
    let body = hit ? hit[1] : { entries: [] }
    if (typeof body === 'function') body = body(init?.body ? JSON.parse(init.body) : {})
    return { ok: true, status: 200, statusText: 'OK', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) }
  })
  return { fetch, calls }
}
const ASK = '/_records/_query/en'
const askStub = ({ briefs = [], full = null }) => (questions) => {
  const data = {}, whole = {}
  for (const [key, q] of Object.entries(questions)) {
    const isRecord = q.where && q.where.$name !== undefined
    data[key] = isRecord ? (full ? [full] : []) : briefs
    // Only keys delivered as WHOLE entities appear; a key's absence is the brief.
    if (isRecord) whole[key] = true
  }
  return Object.keys(whole).length ? { data, whole } : { data }
}

describe('resolvePageFetchConfigs', () => {
  it('resolves the page fetch to the question ask through config.services, once, keyed by cache key', () => {
    const cfgs = resolvePageFetchConfigs(CONTENT, '/team')
    const people = cfgs.find((c) => c.as === 'people')
    expect(people.ask).toBe(ASK)
    expect(people.schema).toBe('@std/person')
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
    expect(cfgs.some((c) => c.as === 'people' && c.ask === ASK)).toBe(true)
  })

  it('CONTROL — an unknown route resolves to nothing', () => {
    expect(resolvePageFetchConfigs(CONTENT, '/nope')).toEqual([])
  })
})

describe('executeFetchConfigs', () => {
  it('asks the ask through the injected fetch, under the payload base, and reads the answer by key', async () => {
    const { fetch, calls } = stubFetch({ [ASK]: askStub({ briefs: [{ $name: 'ada' }, { $name: 'lin' }] }) })
    const configs = resolvePageFetchConfigs(CONTENT, '/team')
    const out = await executeFetchConfigs(configs, { content: CONTENT, fetch })
    expect(calls.some((u) => u.endsWith('/site' + ASK))).toBe(true)
    const people = out.find((e) => e.config.as === 'people')
    expect(people.data).toEqual([{ $name: 'ada' }, { $name: 'lin' }])
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
    const { fetch } = stubFetch({ [ASK]: askStub({ briefs: [{ $name: 'ada' }] }) })
    const fetched = await prefetchPageData({ content: CONTENT, route: '/team', fetch })
    const dataStore = new DataStore()
    hydrateDataStore({ dataStore }, fetched)
    const people = fetched.find((e) => e.config.as === 'people')
    expect(dataStore.get(deriveCacheKey(people.config))?.data).toEqual([{ $name: 'ada' }])
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

describe('what a prefetched entry says about depth', () => {
  it('carries the depth the config asked for as meta, and hydration files it in the record index', async () => {
    const { fetch } = stubFetch({ [ASK]: askStub({ briefs: [{ $uuid: 'u1', $name: 'ada' }] }) })
    const fetched = await prefetchPageData({ content: CONTENT, route: '/team', fetch })
    const people = fetched.find((e) => e.config.as === 'people')
    expect(people.config.whole).toBe(false) // a ask list is a list of briefs; the record is its own question
    expect(people.meta).toEqual({ whole: false })
    const dataStore = new DataStore()
    hydrateDataStore({ dataStore }, fetched)
    expect(dataStore.getRecord('u1')).toEqual({ whole: false, record: { $uuid: 'u1', $name: 'ada' } })
    expect(dataStore.get(deriveCacheKey(people.config)).data).toEqual([{ $uuid: 'u1', $name: 'ada' }])
  })
})

describe('E2 — a template page prefetches ITS RECORD, not only the list', () => {
  it('builds the detail config for the matched param through the one shared rule', () => {
    const cfgs = resolvePageFetchConfigs(CONTENT, '/team/ada')
    const detail = cfgs.find((c) => c.ask === ASK && c.where?.$name === 'ada')
    expect(detail).toBeDefined()
    expect(detail.as).toBe('people')
    expect(detail.whole).toBe(true)
    expect(detail.dynamicContext).toEqual({ paramName: 'slug', paramValue: 'ada' })
    // and the list is still there, at brief depth
    expect(cfgs.some((c) => c.ask === ASK && !c.where?.$name && c.whole === false)).toBe(true)
  })

  it('executes it, so the host hands the isolate the record in full', async () => {
    const { fetch, calls } = stubFetch({
      [ASK]: askStub({ briefs: [{ $uuid: 'u1', $name: 'ada' }], full: { $uuid: 'u1', $name: 'ada', bio: 'Full' } }),
    })
    const fetched = await prefetchPageData({ content: CONTENT, route: '/team/ada', fetch })
    // one POST carries both questions
    expect(calls.filter((u) => u.endsWith('/site' + ASK))).toHaveLength(1)
    const record = fetched.find((e) => e.config.where?.$name === 'ada')
    expect(record.outcome).toBe('fetched')
    expect(record.data).toEqual([{ $uuid: 'u1', $name: 'ada', bio: 'Full' }])
    expect(record.meta).toEqual({ whole: true })
    // hydrated, the record index holds it in FULL — the SPA renders it without a client fetch
    const dataStore = new DataStore()
    hydrateDataStore({ dataStore }, fetched)
    expect(dataStore.getRecord('u1').whole).toBe(true)
  })

  it('CONTROL — a list page, and a template whose query has no per-record source, add no detail fetch', () => {
    expect(resolvePageFetchConfigs(CONTENT, '/team').some((c) => c.whole === true && c.dynamicContext)).toBe(false)
    // a services block with no `records` row is NO lane: the compiled file, no per-record source
    const noLane = { ...CONTENT, config: { ...CONTENT.config, services: { search: '/_search', submit: '/_submit' } } }
    expect(resolvePageFetchConfigs(noLane, '/team/ada').some((c) => c.dynamicContext)).toBe(false)
  })
})
