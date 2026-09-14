/**
 * The default fetcher's QUESTION-ask client — dark until a host stamps the
 * ask, pinned here against a stub that speaks backend's contract
 * (the records contract, §2 and §5).
 */
import { describe, it, expect, vi } from 'vitest'
import { createDefaultFetcher } from '../src/default-fetcher.js'

function doorStub(answer) {
  const calls = []
  const fetch = vi.fn(async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null })
    const body = typeof answer === 'function' ? answer(calls[calls.length - 1]) : answer
    if (body && body.__status) {
      return { ok: false, status: body.__status, statusText: 'Nope', headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '' }
    }
    return { ok: true, status: 200, statusText: 'OK', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) }
  })
  return { fetch, calls }
}

const list = { ask: '/_records/ask/en', query: 'members', schema: '@std/person', as: 'members', where: { published: true }, sort: 'name desc', limit: 20, whole: false, locale: 'en' }
const record = { ask: '/_records/ask/en', query: 'members', schema: '@std/person', as: 'members', where: { published: true, $name: 'ada' }, whole: true, locale: 'en', dynamicContext: { paramName: 'slug', paramValue: 'ada' } }

describe('one question — the request map and the answer', () => {
  it('POSTs the question map to the ask under the site base, in the door\'s vocabulary', async () => {
    const { fetch, calls } = doorStub({ data: { members: [{ $uuid: 'u1', $name: 'ada' }] }, whole: {} })
    const f = createDefaultFetcher({ basePath: '/site', fetch })
    const result = await f.resolve(list)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/site/_records/ask/en')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].body).toEqual({
      members: { schema: '@std/person', where: { published: true }, sort: '-name', limit: 20 },
    })
    expect(result).toEqual({ data: [{ $uuid: 'u1', $name: 'ada' }], meta: { whole: false } })
  })

  it('`depths` says what was SERVED — a brief asked of a Model with no brief comes back full, and is filed full', async () => {
    const { fetch } = doorStub({ data: { members: [{ $uuid: 'u1' }] }, whole: { members: true} })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve(list)
    expect(result.meta).toEqual({ whole: true })
  })

  // ⛔ Since backend's records-query contract rev D (2026-09-13) the service sends no
  // `errors` map: an author's mistake answers `[]` for its key. The client stopped
  // reading one on 2026-09-14, so a stray map changes nothing.
  it('an `errors` map is not read — a key\'s answer is its `data`', async () => {
    const { fetch } = doorStub({ data: { members: [] }, errors: { members: 'ignored' } })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve(list)
    expect(result.data).toEqual([])
    expect(result.error).toBeUndefined()
  })

  it('a key absent from data is a protocol violation, reported as an error', async () => {
    const { fetch } = doorStub({ data: { other: [] } })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve(list)
    expect(result.error).toMatch(/answered without the key "members"/)
  })

  it('an HTTP failure fails every question in the batch, never silently', async () => {
    const { fetch } = doorStub({ __status: 400 })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve(list)
    expect(result.error).toBe('HTTP 400: Nope')
  })

  it('`[]` under a sent key is a delivered answer: no records', async () => {
    const { fetch } = doorStub({ data: { members: [] }, whole: {} })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve(list)
    expect(result.data).toEqual([])
    expect(result.error).toBeUndefined()
  })
})

describe('the door\'s vocabulary — what crosses as written and what is respelled', () => {
  it('the where-object crosses exactly as authored — `not_in` included, and nothing is respelled', async () => {
    const { fetch, calls } = doorStub({ data: { members: [] } })
    const f = createDefaultFetcher({ fetch })
    const where = { status: { not_in: ['draft'] }, title: { starts_with: 'the' }, or: [{ a: 1 }, { b: { in: [2] } }] }
    await f.resolve({ ...list, where })
    expect(calls[0].body.members.where).toEqual(where)
  })

  it('`scope` crosses as authored, and `where` is not respelled — `path: { under }` is retired (2026-09-11)', async () => {
    const { fetch, calls } = doorStub({ data: { members: [] } })
    const f = createDefaultFetcher({ fetch })
    await f.resolve({ ...list, scope: 'research', where: { published: true } })
    expect(calls[0].body.members.scope).toBe('research')
    expect(calls[0].body.members.where).toEqual({ published: true })
  })

  it('the record of a parametric page crosses as `match`, beside an untouched `where`', async () => {
    const { fetch, calls } = doorStub({ data: { members: [] } })
    const f = createDefaultFetcher({ fetch })
    await f.resolve({ ...list, where: { published: true }, match: { $name: 'ada' }, whole: true, limit: undefined })
    expect(calls[0].body.members.match).toEqual({ $name: 'ada' })
    expect(calls[0].body.members.where).toEqual({ published: true })
    expect(calls[0].body.members.whole).toBe(true)
  })

  it('an authored `scope` wins, and a bare `sort` field is ascending', async () => {
    const { fetch, calls } = doorStub({ data: { members: [] } })
    const f = createDefaultFetcher({ fetch })
    await f.resolve({ ...list, scope: 'team', sort: 'name', where: undefined })
    expect(calls[0].body.members).toEqual({ schema: '@std/person', scope: 'team', sort: 'name', limit: 20 })
  })

  it('what the language does not have is sent as written, and answered there — never approximated', async () => {
    const { fetch, calls } = doorStub({ data: { members: [] } })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve({ ...list, where: { name: { like: 'A*' } } })
    expect(calls[0].body.members.where).toEqual({ name: { like: 'A*' } })
    expect(result.data).toEqual([])
  })
})

describe('A6 — the misses of one tick ride one POST, and each gets its own answer', () => {
  it('batches a list and its record into one request under distinct keys', async () => {
    const { fetch, calls } = doorStub({
      data: { members: [{ $uuid: 'u1', $name: 'ada' }], 'members#2': [{ $uuid: 'u1', $name: 'ada', bio: 'Full' }] },
      whole: { 'members#2': true},
    })
    const f = createDefaultFetcher({ fetch })
    const [a, b] = await Promise.all([f.resolve(list), f.resolve(record)])
    expect(calls).toHaveLength(1)
    expect(Object.keys(calls[0].body)).toEqual(['members', 'members#2'])
    expect(calls[0].body['members#2']).toEqual({ schema: '@std/person', where: { published: true, $name: 'ada' }, whole: true })
    expect(a).toEqual({ data: [{ $uuid: 'u1', $name: 'ada' }], meta: { whole: false } })
    expect(b).toEqual({ data: [{ $uuid: 'u1', $name: 'ada', bio: 'Full' }], meta: { whole: true } })
  })

  it('a request issued after the tick goes in the next batch', async () => {
    const { fetch, calls } = doorStub((call) => ({ data: Object.fromEntries(Object.keys(call.body).map((k) => [k, []])) }))
    const f = createDefaultFetcher({ fetch })
    await f.resolve(list)
    await f.resolve(record)
    expect(calls).toHaveLength(2)
  })

  it('two doors (two locales) never share a batch', async () => {
    const { fetch, calls } = doorStub((call) => ({ data: Object.fromEntries(Object.keys(call.body).map((k) => [k, []])) }))
    const f = createDefaultFetcher({ fetch })
    await Promise.all([f.resolve(list), f.resolve({ ...list, ask: '/_records/ask/fr', locale: 'fr' })])
    expect(calls.map((c) => c.url).sort()).toEqual(['/_records/ask/en', '/_records/ask/fr'])
  })

  it('the cache key of a ask request is the question, so the dispatcher dedups by it', () => {
    const f = createDefaultFetcher()
    expect(f.cacheKey(list)).toBe(f.cacheKey({ ...list }))
    expect(f.cacheKey(list)).not.toBe(f.cacheKey(record))
  })
})


// ─── backend's wire, as it shipped (2026-09-04) ────────────────────────────────
// ⚠️ QUOTED from backend's pinned tests (their channel message of 2026-09-04),
// NOT captured from a running daemon — a live capture replaces these when a
// daemon at or after their `b7a1e5ec` is reachable.

function problemStub(status, problem) {
  const fetch = vi.fn(async () => ({
    ok: false, status, statusText: 'Bad Request',
    headers: { get: () => 'application/problem+json' },
    json: async () => problem, text: async () => JSON.stringify(problem),
  }))
  return { fetch }
}

describe("backend's shipped wire — quoted shapes", () => {
  it('a whole-request refusal surfaces the problem body\'s `detail` on every key of the batch', async () => {
    const { fetch } = problemStub(400, { status: 400, title: 'Bad Request', detail: 'query "members": unknown operator `like`' })
    const f = createDefaultFetcher({ fetch })
    const [a, b] = await Promise.all([f.resolve(list), f.resolve(record)])
    expect(a.error).toBe('HTTP 400: query "members": unknown operator `like`')
    expect(b.error).toBe(a.error)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  // ⭐ REVERSED 2026-09-06 [Diego]. This test used to assert `cursors` were
  // "received and ignored". They are read now, because a cursor is how the service
  // says more records remain: the old behaviour rendered part of a list with nothing
  // to distinguish it from the end of the data.
  it('a page render REPORTS an answer with more to come — it does not page', async () => {
    const { fetch, calls } = doorStub({
      data: { members: [{ $uuid: 'u1', $name: 'ada', name: 'Ada Lovelace' }] },
      whole: {},
      cursors: { members: 'opaque' },
    })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve(list)
    expect(result.data).toEqual([{ $uuid: 'u1', $name: 'ada', name: 'Ada Lovelace' }])
    expect(result.meta).toEqual({ whole: false, partial: true })
    expect(result.error).toBeUndefined()
    // ⛔ ONE request: nothing pages in front of paint.
    expect(calls).toHaveLength(1)
    expect(calls[0].body.members).not.toHaveProperty('cursor')
  })

  // ⛔ The service sends no `limits` map since rev D; a stray one changes nothing.
  it('a `limits` map is not read — no cursor means nothing more remains', async () => {
    const { fetch } = doorStub({ data: { members: [{ $uuid: 'u1' }] }, whole: {}, limits: { members: 100 } })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve(list)
    expect(result.meta).toEqual({ whole: false })
  })

  it('⭐ a key a source did not answer is marked partial, and says which source', async () => {
    const unavailable = { source: 'portal-b', code: 'source_unavailable', detail: 'portal-b did not answer' }
    const { fetch } = doorStub({
      data: { members: [{ $uuid: 'u1' }] },
      partial: { members: unavailable },
    })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve(list)
    expect(result.data).toEqual([{ $uuid: 'u1' }])
    expect(result.meta).toMatchObject({ partial: true, unavailable })
    expect(result.error).toBeUndefined()
  })

  it('no cursor and no partial source means the answer IS the whole population', async () => {
    const { fetch } = doorStub({ data: { members: [{ $uuid: 'u1' }] }, whole: {} })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve(list)
    expect(result.meta.partial).toBeUndefined()
  })

  it('an exhaustive caller PAGES until the service stops issuing a cursor', async () => {
    // Three pages, then no cursor. The cursor of page N rides page N+1's question.
    const pages = [
      { data: { members: [{ $uuid: 'u1' }] }, whole: {}, cursors: { members: 'c1' } },
      { data: { members: [{ $uuid: 'u2' }] }, whole: {}, cursors: { members: 'c2' } },
      { data: { members: [{ $uuid: 'u3' }] }, whole: {} },
    ]
    const calls = []
    let n = 0
    const fetch = vi.fn(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) })
      const page = pages[n]; n += 1
      return { ok: true, status: 200, json: async () => page }
    })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve({ ...list, exhaustive: true })

    expect(result.data).toEqual([{ $uuid: 'u1' }, { $uuid: 'u2' }, { $uuid: 'u3' }])
    expect(calls).toHaveLength(3)
    expect(calls[0].body.members).not.toHaveProperty('cursor')
    expect(calls[1].body.members.cursor).toBe('c1')
    expect(calls[2].body.members.cursor).toBe('c2')
    // Exhausted, so nothing is partial; the page count rides for a caller
    // that wants to know it cost three round trips.
    expect(result.meta.partial).toBeUndefined()
    expect(result.meta.pages).toBe(3)
  })

  it('an exhaustive caller stops at its own bound and says so, rather than spinning', async () => {
    // A service that always answers with a cursor: the loop must terminate.
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { members: [{ $uuid: 'x' }] }, whole: {}, cursors: { members: 'always' } }),
    }))
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve({ ...list, exhaustive: true })
    expect(result.meta.partial).toBe(true)
    expect(result.data.length).toBe(result.meta.pages)
    expect(fetch.mock.calls.length).toBe(result.meta.pages)
  })

  it("the three-question batch from backend's tests, answered per key", async () => {
    const answer = {
      data: {
        staff: [{ $uuid: 'u1', $name: 'ada', name: 'Ada Lovelace', featured: true }],
        top: [{ $uuid: 'u2', $name: 'bob', name: 'Bob' }],
        ada: [{ $uuid: 'u1', $name: 'ada', name: 'Ada Lovelace', bio: { text: '…' }, roles: [{ title: '…' }] }],
      },
      whole: { ada: true},
      cursors: { top: '…' },
    }
    const { fetch, calls } = doorStub(answer)
    const f = createDefaultFetcher({ fetch })
    const ask = '/_records/_query/en'
    const [staff, top, ada] = await Promise.all([
      f.resolve({ ask, query: 'staff', schema: '@std/person', as: 'staff', scope: 'members', where: { featured: true }, locale: 'en' }),
      f.resolve({ ask, query: 'top', schema: '@std/person', as: 'top', scope: 'members', sort: '-rank', limit: 1, locale: 'en' }),
      f.resolve({ ask, query: 'ada', schema: '@std/person', as: 'ada', where: { $name: 'ada' }, whole: true, locale: 'en' }),
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/_records/_query/en')
    expect(calls[0].body).toEqual({
      staff: { schema: '@std/person', scope: 'members', where: { featured: true } },
      top: { schema: '@std/person', scope: 'members', sort: '-rank', limit: 1 },
      ada: { schema: '@std/person', where: { $name: 'ada' }, whole: true },
    })
    expect(staff.data).toEqual(answer.data.staff)
    // `top` carried a cursor, so its answer is reported as not the whole population.
    expect(top.meta).toEqual({ partial: true })
    expect(ada.data[0].bio).toEqual({ text: '…' })
    expect(ada.meta).toEqual({ whole: true })
  })
})

describe('⛔ a ask with no Model ref refuses before any request', () => {
  it('says which query and why, and makes no request', async () => {
    const { fetch } = doorStub({ data: {} })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve({ ask: '/_records/_query/en', query: 'members', schema: null, as: 'members', locale: 'en' })
    expect(result.data).toBeNull()
    expect(result.error).toMatch(/no Model ref for query "members"/)
    expect(result.error).toMatch(/config\.queries/)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('the answers service — one question per request, answered from the host\'s cache', () => {
  // A stub that answers by address: the answers service, and the records service behind it.
  function hostStub({ answers, records = { data: {} } }) {
    const calls = []
    const fetch = vi.fn(async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : null
      calls.push({ url, body })
      const reply = url.includes('/_answers/') ? answers : records
      const out = typeof reply === 'function' ? reply(body) : reply
      if (out && out.__status) {
        const headers = { get: (name) => (out.headers || {})[name] ?? null }
        return { ok: false, status: out.__status, statusText: 'Nope', headers, json: async () => ({}), text: async () => JSON.stringify(out.body ?? {}) }
      }
      return { ok: true, status: 200, statusText: 'OK', headers: { get: () => 'application/json' }, json: async () => out, text: async () => JSON.stringify(out) }
    })
    return { fetch, calls }
  }
  const HASH = '0f3a9c'
  const listViaAnswers = { ...list, ask: '/_query/en', answers: '/_answers/en' }

  it('⭐ posts the question ALONE — the body the records service would get under a key — and reads the one key back', async () => {
    const { fetch, calls } = hostStub({ answers: { data: { [HASH]: [{ $uuid: 'u1', $name: 'ada' }] } } })
    const f = createDefaultFetcher({ basePath: '/site', fetch })
    const result = await f.resolve(listViaAnswers)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/site/_answers/en')
    expect(calls[0].body).toEqual({ schema: '@std/person', where: { published: true }, sort: '-name', limit: 20 })
    expect(result).toEqual({ data: [{ $uuid: 'u1', $name: 'ada' }], meta: { whole: false } })
  })

  it('a record request goes too — `match` and `whole` are in the question, so they are in the host\'s key', async () => {
    const { fetch, calls } = hostStub({ answers: { data: { [HASH]: [{ $uuid: 'u1', bio: 'Full' }] }, whole: { [HASH]: true } } })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve({ ...record, ask: '/_query/en', answers: '/_answers/en', match: { $name: 'ada' } })
    expect(calls[0].body).toMatchObject({ match: { $name: 'ada' }, whole: true })
    expect(result.meta).toEqual({ whole: true })
  })

  it('nothing is batched: two questions are two requests', async () => {
    const { fetch, calls } = hostStub({ answers: (q) => ({ data: { [q.limit ?? 'x']: [] } }) })
    const f = createDefaultFetcher({ fetch })
    await Promise.all([f.resolve(listViaAnswers), f.resolve({ ...listViaAnswers, limit: 3 })])
    expect(calls).toHaveLength(2)
  })

  it('a cursor and a partial source mark the answer partial, as they do from the records service', async () => {
    const unavailable = { source: 'portal-b', code: 'source_unavailable', detail: 'down' }
    const { fetch } = hostStub({ answers: { data: { [HASH]: [] }, cursors: { [HASH]: 'next' }, partial: { [HASH]: unavailable } } })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve(listViaAnswers)
    expect(result.meta).toMatchObject({ partial: true, unavailable })
  })

  it('⛔ an exhaustive walk is not sent — it pages with cursors, on the records service', async () => {
    const { fetch, calls } = hostStub({ answers: { data: {} }, records: { data: { members: [] } } })
    const f = createDefaultFetcher({ fetch })
    await f.resolve({ ...listViaAnswers, exhaustive: true })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/_query/en')
  })

  it('when the answers service itself refuses, or is not served, the question goes to the records service', async () => {
    for (const refusal of [
      { __status: 400, headers: { 'X-Uniweb-Error': 'answer-request' } },
      { __status: 502, headers: { 'X-Uniweb-Error': 'answer-upstream' } },
      { __status: 404 },
    ]) {
      const { fetch, calls } = hostStub({ answers: refusal, records: { data: { members: [{ $uuid: 'u1' }] } } })
      const f = createDefaultFetcher({ fetch })
      const result = await f.resolve(listViaAnswers)
      expect(calls.map((c) => c.url)).toEqual(['/_answers/en', '/_query/en'])
      expect(result.data).toEqual([{ $uuid: 'u1' }])
    }
  })

  it('the records service\'s own refusal, passed through, is reported — not asked twice', async () => {
    const { fetch, calls } = hostStub({ answers: { __status: 400, body: { detail: 'query: unknown field `foo`' } } })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve(listViaAnswers)
    expect(calls).toHaveLength(1)
    expect(result.error).toBe('HTTP 400: query: unknown field `foo`')
  })

  it('an answer under anything but one key is an error, never a guess', async () => {
    const { fetch } = hostStub({ answers: { data: { a: [], b: [] } } })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve(listViaAnswers)
    expect(result.error).toMatch(/2 keys/)
  })

  it('CONTROL — with no answers address, the question is batched to the records service as before', async () => {
    const { fetch, calls } = hostStub({ answers: { data: {} }, records: { data: { members: [] } } })
    const f = createDefaultFetcher({ fetch })
    await f.resolve({ ...list, ask: '/_query/en' })
    expect(calls[0].url).toBe('/_query/en')
    expect(calls[0].body).toHaveProperty('members')
  })
})
