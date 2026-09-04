/**
 * The default fetcher's QUESTION-door client — dark until a host stamps the
 * door, pinned here against a stub that speaks backend's contract
 * (kb/backend/records-query-contract.md §2, §5).
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

const list = { door: '/_records/ask/en', query: 'members', schema: '@std/person', as: 'members', where: { published: true }, sort: 'name desc', limit: 20, depth: 'brief', locale: 'en' }
const record = { door: '/_records/ask/en', query: 'members', schema: '@std/person', as: 'members', where: { published: true, $name: 'ada' }, depth: 'full', locale: 'en', dynamicContext: { paramName: 'slug', paramValue: 'ada' } }

describe('one question — the request map and the answer', () => {
  it('POSTs the question map to the door under the site base, in the door\'s vocabulary', async () => {
    const { fetch, calls } = doorStub({ data: { members: [{ $uuid: 'u1', $name: 'ada' }] }, depths: { members: 'brief' } })
    const f = createDefaultFetcher({ basePath: '/site', fetch })
    const result = await f.resolve(list)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/site/_records/ask/en')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].body).toEqual({
      members: { schema: '@std/person', where: { published: true }, sort: '-name', limit: 20, depth: 'brief' },
    })
    expect(result).toEqual({ data: [{ $uuid: 'u1', $name: 'ada' }], meta: { depth: 'brief' } })
  })

  it('`depths` says what was SERVED — a brief asked of a Model with no brief comes back full, and is filed full', async () => {
    const { fetch } = doorStub({ data: { members: [{ $uuid: 'u1' }] }, depths: { members: 'full' } })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve(list)
    expect(result.meta).toEqual({ depth: 'full' })
  })

  it('a key in `errors` is an error, and its data is NOT `[]`', async () => {
    const { fetch } = doorStub({ data: {}, errors: { members: 'sort field "name" is not in the brief' } })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve(list)
    expect(result.error).toMatch(/not in the brief/)
    expect(result.data).toBeNull()
  })

  it('a key absent from BOTH data and errors is a protocol violation, reported as an error', async () => {
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
    const { fetch } = doorStub({ data: { members: [] }, depths: { members: 'brief' } })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve(list)
    expect(result.data).toEqual([])
    expect(result.error).toBeUndefined()
  })
})

describe('the door\'s vocabulary — what crosses as written and what is respelled', () => {
  it('`nin` crosses as `not_in`; everything else as authored', async () => {
    const { fetch, calls } = doorStub({ data: { members: [] } })
    const f = createDefaultFetcher({ fetch })
    await f.resolve({ ...list, where: { status: { nin: ['draft'] }, or: [{ a: 1 }, { b: { in: [2] } }] } })
    expect(calls[0].body.members.where).toEqual({ status: { not_in: ['draft'] }, or: [{ a: 1 }, { b: { in: [2] } }] })
  })

  it('a top-level `path: { under }` — the file lane\'s folder branch — becomes the door\'s `scope`', async () => {
    const { fetch, calls } = doorStub({ data: { members: [] } })
    const f = createDefaultFetcher({ fetch })
    await f.resolve({ ...list, where: { path: { under: 'research' }, published: true } })
    expect(calls[0].body.members.scope).toBe('research')
    expect(calls[0].body.members.where).toEqual({ published: true })
  })

  it('an authored `scope` wins, and a bare `sort` field is ascending', async () => {
    const { fetch, calls } = doorStub({ data: { members: [] } })
    const f = createDefaultFetcher({ fetch })
    await f.resolve({ ...list, scope: 'team', sort: 'name', where: undefined })
    expect(calls[0].body.members).toEqual({ schema: '@std/person', scope: 'team', sort: 'name', limit: 20, depth: 'brief' })
  })

  it('what the door does not accept is sent as written, to be refused there by name — never approximated', async () => {
    const { fetch, calls } = doorStub({ data: {}, errors: { members: 'unknown operator "like"' } })
    const f = createDefaultFetcher({ fetch })
    const result = await f.resolve({ ...list, where: { name: { like: 'A*' } } })
    expect(calls[0].body.members.where).toEqual({ name: { like: 'A*' } })
    expect(result.error).toMatch(/like/)
  })
})

describe('A6 — the misses of one tick ride one POST, and each gets its own answer', () => {
  it('batches a list and its record into one request under distinct keys', async () => {
    const { fetch, calls } = doorStub({
      data: { members: [{ $uuid: 'u1', $name: 'ada' }], 'members#2': [{ $uuid: 'u1', $name: 'ada', bio: 'Full' }] },
      depths: { members: 'brief', 'members#2': 'full' },
    })
    const f = createDefaultFetcher({ fetch })
    const [a, b] = await Promise.all([f.resolve(list), f.resolve(record)])
    expect(calls).toHaveLength(1)
    expect(Object.keys(calls[0].body)).toEqual(['members', 'members#2'])
    expect(calls[0].body['members#2']).toEqual({ schema: '@std/person', where: { published: true, $name: 'ada' }, depth: 'full' })
    expect(a).toEqual({ data: [{ $uuid: 'u1', $name: 'ada' }], meta: { depth: 'brief' } })
    expect(b).toEqual({ data: [{ $uuid: 'u1', $name: 'ada', bio: 'Full' }], meta: { depth: 'full' } })
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
    await Promise.all([f.resolve(list), f.resolve({ ...list, door: '/_records/ask/fr', locale: 'fr' })])
    expect(calls.map((c) => c.url).sort()).toEqual(['/_records/ask/en', '/_records/ask/fr'])
  })

  it('the cache key of a door request is the question, so the dispatcher dedups by it', () => {
    const f = createDefaultFetcher()
    expect(f.cacheKey(list)).toBe(f.cacheKey({ ...list }))
    expect(f.cacheKey(list)).not.toBe(f.cacheKey(record))
  })
})
