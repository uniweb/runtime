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
      whole: {},
    }])

    const out = await collectSiteRecords(CONTENT, { locale: 'en', fetch })

    expect(calls).toHaveLength(1)
    // The base is applied by the same fetcher a page render uses.
    expect(calls[0].url).toBe('/site/_query/en')
    // `scope`, `sort` and `limit` come off `config.queries` through
    // resolveFetchConfigs — not re-derived here.
    expect(calls[0].body.members).toMatchObject({ schema: '@std/person', scope: 'team', sort: '-name' })
    // ⛔ absence IS the brief — `whole: false` would be noise on every list question
    expect(calls[0].body.members).not.toHaveProperty('whole')
    // ⛔ `limit: 5` is on the saved query and is NOT sent: it is the list page's
    // presentation, and the corpus wants the population its detail pages reach.
    expect(calls[0].body.posts).toMatchObject({ schema: '@std/article' })
    expect(calls[0].body.posts).not.toHaveProperty('limit')
    expect(out.records.members).toEqual([{ $uuid: 'u1', $name: 'ada' }])
    expect(out.errors).toBeNull()
  })

  it('pages to exhaustion — a corpus is not a page', async () => {
    const { fetch, calls } = stub([
      { data: { members: [{ $uuid: 'u1' }], posts: [] }, whole: {}, cursors: { members: 'c1' } },
      { data: { members: [{ $uuid: 'u2' }] }, whole: {} },
    ])

    const out = await collectSiteRecords(CONTENT, { locale: 'en', fetch, only: ['members'] })

    expect(out.records.members).toEqual([{ $uuid: 'u1' }, { $uuid: 'u2' }])
    expect(calls).toHaveLength(2)
    expect(calls[1].body.members.cursor).toBe('c1')
    expect(out.meta.members.pages).toBe(2)
  })

  it('the locale is a route segment of the address, so it changes where the question goes', async () => {
    const { fetch, calls } = stub([{ data: { members: [], posts: [] }, whole: {} }])
    await collectSiteRecords(CONTENT, { locale: 'fr-CA', fetch })
    expect(calls[0].url).toBe('/site/_query/fr-CA')
  })

  it('reports a per-key failure without losing the keys that answered', async () => {
    const { fetch } = stub([{
      data: { members: [{ $uuid: 'u1' }] },
      whole: {},
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

  // ── Three gaps a consumer found on 2026-09-06, each pinned where it was missing.

  it('asks for WHOLE records when the caller wants them; briefs by default, by omission', async () => {
    // An index matches body text the record's own detail page shows; a brief
    // index cannot, and a reader who finds a word on the page and not in search
    // meets exactly the inconsistency two rankings would produce.
    const { fetch, calls } = stub([{ data: { members: [] }, whole: {} }])
    await collectSiteRecords(CONTENT, { locale: 'en', fetch, only: ['members'], whole: true })
    expect(calls[0].body.members.whole).toBe(true)

    const d = stub([{ data: { members: [] }, whole: {} }])
    await collectSiteRecords(CONTENT, { locale: 'en', fetch: d.fetch, only: ['members'] })
    expect(d.calls[0].body.members).not.toHaveProperty('whole')
  })

  it('honours the caller’s maxPages and marks the key partial rather than spinning', async () => {
    // A service that always answers with a cursor.
    const { fetch, calls } = stub([
      { data: { members: [{ $uuid: 'x' }] }, whole: {}, cursors: { members: 'c' } },
    ])
    const out = await collectSiteRecords(CONTENT, { locale: 'en', fetch, only: ['members'], maxPages: 3 })
    expect(calls).toHaveLength(3)
    expect(out.records.members).toHaveLength(3)
    expect(out.meta.members.partial).toBe(true)
    expect(out.meta.members.pages).toBe(3)
    // ⛔ `maxPages` says how many times to ask, never what is asked.
    expect(calls[0].body.members).not.toHaveProperty('maxPages')
    expect(calls[0].body.members).not.toHaveProperty('exhaustive')
  })

  it('⛔ an abort KEEPS the pages already collected, marked — it does not lose the key', async () => {
    // On an exhaustive walk every in-flight key fails at once, so discarding
    // held pages loses the corpus rather than one key. A key may appear in both
    // `records` and `errors`; the caller decides whether partial is usable.
    let n = 0
    const fetch = vi.fn(async () => {
      n += 1
      if (n === 1) return { ok: true, status: 200, json: async () => ({ data: { members: [{ $uuid: 'u1' }] }, whole: {}, cursors: { members: 'c1' } }) }
      const err = new Error('The operation was aborted'); err.name = 'AbortError'
      throw err
    })
    const out = await collectSiteRecords(CONTENT, { locale: 'en', fetch, only: ['members'] })
    expect(out.records.members).toEqual([{ $uuid: 'u1' }])
    expect(out.errors.members).toBe('aborted')
    expect(out.meta.members.partial).toBe(true)
  })

  it('a walk that collected NOTHING leaves the key out of records entirely', async () => {
    const fetch = vi.fn(async () => { const e = new Error('x'); e.name = 'AbortError'; throw e })
    const out = await collectSiteRecords(CONTENT, { locale: 'en', fetch, only: ['members'] })
    expect(out.records).not.toHaveProperty('members')
    expect(out.errors.members).toBe('aborted')
  })

  it('skips a query with no live lane rather than inventing one', async () => {
    // A query the service does not answer resolves to the compiled artifact's
    // path. Reading that file is the caller's business — it is in the site's own
    // URL space and they already serve it.
    const { fetch, calls } = stub([{ data: { members: [] }, whole: {} }])
    const out = await collectSiteRecords(CONTENT, { locale: 'en', fetch, only: ['members'] })
    expect(Object.keys(calls[0].body)).toEqual(['members'])
    expect(out.records).not.toHaveProperty('posts')
  })
})
