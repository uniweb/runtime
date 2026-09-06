/**
 * `collectSiteRecords` — the corpus entry, for a host that indexes rather than
 * renders.
 *
 * ⭐ What this suite is really pinning is that it asks THE SAME WAY a page does.
 * The reason the export exists is that a host composing its own questions can
 * index a record whose page then renders empty — so the tests below assert the
 * shared path (one composition, one client, the saved query's own narrowing) as
 * much as the return shape.
 */
import { describe, it, expect, vi } from 'vitest'
import { collectSiteRecords } from '../src/collect-records.js'

const CONTENT = {
  config: {
    base: '/site',
    defaultLanguage: 'en',
    services: { records: '/_query/{locale}' },
    queries: {
      members: { schema: '@std/person', scope: 'team', sort: '-name' },
      posts: { schema: '@std/article', limit: 5 },
    },
  },
  pages: [],
}

/** A stub speaking the records contract's envelope, one page per call. */
function stub(pages) {
  const calls = []
  let n = 0
  const fetch = vi.fn(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    const page = pages[Math.min(n, pages.length - 1)]
    n += 1
    return { ok: true, status: 200, json: async () => page }
  })
  return { fetch, calls }
}

describe('collectSiteRecords', () => {
  it('asks one question per declared query, carrying the saved query’s own narrowing', async () => {
    const { fetch, calls } = stub([{
      data: { members: [{ $uuid: 'u1', $name: 'ada' }], posts: [{ $uuid: 'p1', $name: 'hello' }] },
      depths: { members: 'brief', posts: 'brief' },
    }])

    const out = await collectSiteRecords(CONTENT, { locale: 'en', fetch })

    expect(calls).toHaveLength(1)
    // The base is applied by the same fetcher a page render uses.
    expect(calls[0].url).toBe('/site/_query/en')
    // `scope`, `sort` and `limit` come off `config.queries` through
    // resolveFetchConfigs — not re-derived here.
    expect(calls[0].body.members).toMatchObject({ schema: '@std/person', scope: 'team', sort: '-name', depth: 'brief' })
    expect(calls[0].body.posts).toMatchObject({ schema: '@std/article', limit: 5, depth: 'brief' })
    expect(out.records.members).toEqual([{ $uuid: 'u1', $name: 'ada' }])
    expect(out.errors).toBeNull()
  })

  it('pages to exhaustion — a corpus is not a page', async () => {
    const { fetch, calls } = stub([
      { data: { members: [{ $uuid: 'u1' }], posts: [] }, depths: { members: 'brief' }, cursors: { members: 'c1' } },
      { data: { members: [{ $uuid: 'u2' }] }, depths: { members: 'brief' } },
    ])

    const out = await collectSiteRecords(CONTENT, { locale: 'en', fetch, only: ['members'] })

    expect(out.records.members).toEqual([{ $uuid: 'u1' }, { $uuid: 'u2' }])
    expect(calls).toHaveLength(2)
    expect(calls[1].body.members.cursor).toBe('c1')
    expect(out.meta.members.pages).toBe(2)
  })

  it('the locale is a route segment of the address, so it changes where the question goes', async () => {
    const { fetch, calls } = stub([{ data: { members: [], posts: [] }, depths: {} }])
    await collectSiteRecords(CONTENT, { locale: 'fr-CA', fetch })
    expect(calls[0].url).toBe('/site/_query/fr-CA')
  })

  it('reports a per-key failure without losing the keys that answered', async () => {
    const { fetch } = stub([{
      data: { members: [{ $uuid: 'u1' }] },
      depths: { members: 'brief' },
      errors: { posts: { code: 'schema_not_found', detail: 'no Model @std/article' } },
    }])
    const out = await collectSiteRecords(CONTENT, { locale: 'en', fetch })
    expect(out.records.members).toEqual([{ $uuid: 'u1' }])
    expect(out.records).not.toHaveProperty('posts')
    expect(out.errors.posts).toBe('no Model @std/article')
  })

  // ⛔ Each of these is an ordinary state of a site, not a fault. A static site's
  // corpus comes from artifacts the caller already has; throwing here would make
  // "this site has no live records" indistinguishable from a transport failure.
  it('returns empty, and asks nothing, when the site has no records service', async () => {
    const fetch = vi.fn()
    const noService = { config: { ...CONTENT.config, services: { search: '/_search' } } }
    const out = await collectSiteRecords(noService, { locale: 'en', fetch })
    expect(out).toEqual({ records: {}, errors: null, meta: {} })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns empty when the payload declares no queries, or names no locale', async () => {
    const fetch = vi.fn()
    expect((await collectSiteRecords({ config: { services: CONTENT.config.services } }, { locale: 'en', fetch })).records).toEqual({})
    expect((await collectSiteRecords(CONTENT, { locale: '', fetch })).records).toEqual({})
    expect((await collectSiteRecords(null, { locale: 'en', fetch })).records).toEqual({})
    expect(fetch).not.toHaveBeenCalled()
  })

  it('skips a query with no live lane rather than inventing one', async () => {
    // A query the service does not answer resolves to the compiled artifact's
    // path. Reading that file is the caller's business — it is in the site's own
    // URL space and they already serve it.
    const { fetch, calls } = stub([{ data: { members: [] }, depths: {} }])
    const out = await collectSiteRecords(CONTENT, { locale: 'en', fetch, only: ['members'] })
    expect(Object.keys(calls[0].body)).toEqual(['members'])
    expect(out.records).not.toHaveProperty('posts')
  })
})
