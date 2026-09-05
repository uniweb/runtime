import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDefaultFetcher } from '../src/default-fetcher.js'

/**
 * Tests for the runtime's default fetcher — TWO lanes and no site-level
 * vocabulary for a backend of the author's own:
 *   - a compiled file / a plain `url:`: GET, JSON, transform, basePath,
 *     `method: POST` + body + placeholder substitution from dynamicContext,
 *     every operator evaluated locally with the one evaluator;
 *   - the host's question door (`door:`) — `query-door.test.js`.
 * (The host's ADDRESS door — `endpoint:` — was retired 2026-09-04.)
 *
 * ⛔ `fetcher.baseUrl` / `headers` / `envelope` / `supports` / `request.*`
 * were RETIRED on 2026-09-04: a third party's conventions are a foundation
 * transport. The last group here pins that the fetcher does not read them.
 */

// ─── Test helpers ───────────────────────────────────────────────────────────

function stubFetch({ status = 200, body = [], contentType = 'application/json' } = {}) {
  const calls = []
  let response = buildResponse({ status, body, contentType })

  const impl = (input, init) => {
    calls.push({ input, init })
    return Promise.resolve(response)
  }

  const original = globalThis.fetch
  globalThis.fetch = vi.fn(impl)

  return {
    calls,
    setResponse: (opts) => {
      response = buildResponse(opts)
    },
    restore: () => {
      globalThis.fetch = original
    },
  }
}

function buildResponse({ status = 200, body, contentType = 'application/json' }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Not OK',
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('createDefaultFetcher — baseline (no config)', () => {
  let fetchStub

  beforeEach(() => {
    fetchStub = stubFetch({ body: [{ id: 1 }] })
  })
  afterEach(() => fetchStub.restore())

  it('fetches a local path with no basePath', async () => {
    const f = createDefaultFetcher()
    const result = await f.resolve({ path: '/data/team.json' })
    expect(fetchStub.calls[0].input).toBe('/data/team.json')
    expect(result.data).toEqual([{ id: 1 }])
  })

  it('fetches an absolute URL unchanged', async () => {
    const f = createDefaultFetcher()
    await f.resolve({ url: 'https://api.example.com/articles' })
    expect(fetchStub.calls[0].input).toBe('https://api.example.com/articles')
  })

  it('returns { data: [], error } on HTTP failure', async () => {
    fetchStub.setResponse({ status: 500, body: {} })
    const f = createDefaultFetcher()
    const result = await f.resolve({ url: 'https://api.example.com/missing' })
    expect(result.data).toEqual([])
    expect(result.error).toMatch(/^HTTP 500/)
  })

  it('returns { data: [], error } on empty request', async () => {
    const f = createDefaultFetcher()
    const result = await f.resolve({})
    expect(result).toEqual({ data: [], error: 'No path, url or door specified' })
  })

  it('returns { data: null } on null request', async () => {
    const f = createDefaultFetcher()
    const result = await f.resolve(null)
    expect(result).toEqual({ data: null })
  })

  it('applies request.transform dot-path to response', async () => {
    fetchStub.setResponse({ body: { data: { items: [{ id: 1 }] } } })
    const f = createDefaultFetcher()
    const result = await f.resolve({ url: 'https://api.example.com/x', transform: 'data.items' })
    expect(result.data).toEqual([{ id: 1 }])
  })

  it('surfaces AbortError as { error: "aborted" }', async () => {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(() => Promise.reject(Object.assign(new Error('abort'), { name: 'AbortError' })))
    const f = createDefaultFetcher()
    const result = await f.resolve({ url: 'https://api.example.com/x' })
    expect(result).toEqual({ data: [], error: 'aborted' })
    globalThis.fetch = original
  })

  it('sends no headers option when there is no config (baseline preserved)', async () => {
    const f = createDefaultFetcher()
    await f.resolve({ url: 'https://api.example.com/x' })
    expect(fetchStub.calls[0].init.headers).toBeUndefined()
  })

  it('sends GET method by default', async () => {
    const f = createDefaultFetcher()
    await f.resolve({ url: 'https://api.example.com/x' })
    expect(fetchStub.calls[0].init.method).toBe('GET')
  })
})

describe('createDefaultFetcher — basePath (subpath deploys)', () => {
  let fetchStub
  beforeEach(() => { fetchStub = stubFetch({ body: [] }) })
  afterEach(() => fetchStub.restore())

  it('prepends basePath to local absolute paths', async () => {
    const f = createDefaultFetcher({ basePath: '/docs/' })
    await f.resolve({ path: '/data/team.json' })
    expect(fetchStub.calls[0].input).toBe('/docs/data/team.json')
  })

  it('strips trailing slash on basePath', async () => {
    const f = createDefaultFetcher({ basePath: '/docs/' })
    await f.resolve({ path: '/data/x.json' })
    expect(fetchStub.calls[0].input).toBe('/docs/data/x.json')
  })

  it('does not apply basePath to remote URLs', async () => {
    const f = createDefaultFetcher({ basePath: '/docs/' })
    await f.resolve({ url: 'https://api.example.com/x' })
    expect(fetchStub.calls[0].input).toBe('https://api.example.com/x')
  })

  it('does not apply basePath to protocol-relative URLs', async () => {
    const f = createDefaultFetcher({ basePath: '/docs/' })
    await f.resolve({ url: '//cdn.example.com/x.json' })
    expect(fetchStub.calls[0].input).toBe('//cdn.example.com/x.json')
  })
})


describe('createDefaultFetcher — a per-request envelope (the object form of detail:)', () => {
  // A per-request envelope describes ONE response — the record a template
  // page asked for — not a backend. It is the only envelope the default
  // fetcher reads besides the host's stamp: the site-level `fetcher.envelope`
  // was retired 2026-09-04.
  let fetchStub
  beforeEach(() => { fetchStub = stubFetch({ body: {} }) })
  afterEach(() => fetchStub.restore())

  it('envelope.item unwraps a detail response', async () => {
    fetchStub.setResponse({ body: { data: { article: { id: 42 } } } })
    const f = createDefaultFetcher()
    const result = await f.resolve({
      url: 'https://api.example.com/articles/42',
      envelope: { list: 'data.items', item: 'data.article' },
      dynamicContext: { paramName: 'slug', paramValue: '42', schema: 'articles' },
    })
    expect(result.data).toEqual({ id: 42 })
  })

  it('envelope.list unwraps a list response', async () => {
    fetchStub.setResponse({ body: { data: { items: [{ id: 1 }, { id: 2 }] } } })
    const f = createDefaultFetcher()
    const result = await f.resolve({ url: 'https://api.example.com/articles', envelope: { list: 'data.items' } })
    expect(result.data).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('per-fetch transform wins over envelope.list', async () => {
    fetchStub.setResponse({ body: { a: { b: [1, 2] }, data: { items: [3, 4] } } })
    const f = createDefaultFetcher()
    const result = await f.resolve({ url: 'https://api.example.com/x', transform: 'a.b', envelope: { list: 'data.items' } })
    expect(result.data).toEqual([1, 2])
  })

  it('envelope.error extracts error text from a non-2xx body', async () => {
    fetchStub.setResponse({ status: 404, body: { errors: [{ message: 'article not found' }] } })
    const f = createDefaultFetcher()
    const result = await f.resolve({ url: 'https://api.example.com/x', envelope: { error: 'errors.0.message' } })
    expect(result.data).toEqual([])
    expect(result.error).toBe('article not found')
  })

  it('envelope.error falls back to status text when the path is missing', async () => {
    fetchStub.setResponse({ status: 404, body: { other: 'shape' } })
    const f = createDefaultFetcher()
    const result = await f.resolve({ url: 'https://api.example.com/x', envelope: { error: 'errors.0.message' } })
    expect(result.error).toMatch(/^HTTP 404/)
  })

  it('envelope.error falls back when the body is not JSON', async () => {
    fetchStub.setResponse({ status: 500, body: 'raw text', contentType: 'text/plain' })
    const f = createDefaultFetcher()
    const result = await f.resolve({ url: 'https://api.example.com/x', envelope: { error: 'errors.0.message' } })
    expect(result.error).toMatch(/^HTTP 500/)
  })

  it('an empty envelope is a no-op', async () => {
    fetchStub.setResponse({ body: [{ id: 1 }] })
    const f = createDefaultFetcher()
    const result = await f.resolve({ url: 'https://api.example.com/x', envelope: {} })
    expect(result.data).toEqual([{ id: 1 }])
  })
})

describe('createDefaultFetcher — method + body (POST)', () => {
  let fetchStub, warnSpy
  beforeEach(() => {
    fetchStub = stubFetch({ body: { data: { results: [] } } })
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    fetchStub.restore()
    warnSpy.mockRestore()
  })

  it('sends a POST with JSON-serialized body', async () => {
    const f = createDefaultFetcher()
    await f.resolve({
      url: 'https://api.example.com/search',
      method: 'POST',
      body: { filter: { status: 'published' }, limit: 10 },
    })
    expect(fetchStub.calls[0].init.method).toBe('POST')
    expect(fetchStub.calls[0].init.body).toBe(
      JSON.stringify({ filter: { status: 'published' }, limit: 10 }),
    )
  })

  it('defaults Content-Type to application/json on POST', async () => {
    const f = createDefaultFetcher()
    await f.resolve({ url: 'https://api.example.com/x', method: 'POST', body: { q: 1 } })
    expect(fetchStub.calls[0].init.headers['Content-Type']).toBe('application/json')
  })

  it('accepts string body passed through unchanged', async () => {
    const f = createDefaultFetcher()
    await f.resolve({ url: 'https://api.example.com/graphql', method: 'POST', body: '{ articles { id } }' })
    expect(fetchStub.calls[0].init.body).toBe('{ articles { id } }')
  })

  it('substitutes {paramName} placeholders in body using dynamicContext', async () => {
    const f = createDefaultFetcher()
    await f.resolve({
      url: 'https://api.example.com/graphql',
      method: 'POST',
      body: {
        query: 'query Article($slug: String!) { article(slug: $slug) { id } }',
        variables: { slug: '{slug}' },
      },
      dynamicContext: { paramName: 'slug', paramValue: 'hello-world', schema: 'articles' },
    })
    const sent = JSON.parse(fetchStub.calls[0].init.body)
    expect(sent.variables.slug).toBe('hello-world')
    // GraphQL query body preserved — `$slug` is a GraphQL variable reference,
    // and `{ id }` is a selection set that must not match the placeholder pattern.
    expect(sent.query).toBe('query Article($slug: String!) { article(slug: $slug) { id } }')
  })

  it('GET request with body is a no-op (body dropped)', async () => {
    const f = createDefaultFetcher()
    await f.resolve({ url: 'https://api.example.com/articles', body: { x: 1 } })
    expect(fetchStub.calls[0].init.body).toBeUndefined()
  })

  it('warns and falls back to GET for unsupported method', async () => {
    const f = createDefaultFetcher()
    await f.resolve({ url: 'https://api.example.com/articles', method: 'DELETE' })
    expect(fetchStub.calls[0].init.method).toBe('GET')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not supported'))
  })

  it('method is case-insensitive', async () => {
    const f = createDefaultFetcher()
    await f.resolve({ url: 'https://api.example.com/x', method: 'post', body: { q: 1 } })
    expect(fetchStub.calls[0].init.method).toBe('POST')
  })

  it('a per-request envelope unwraps a POSTed detail response', async () => {
    fetchStub.setResponse({ body: { data: { article: { id: 7 } }, other: [] } })
    const f = createDefaultFetcher()
    const result = await f.resolve({
      url: 'https://api.example.com/x',
      method: 'POST',
      body: { q: 'article' },
      envelope: { item: 'data.article' },
      dynamicContext: { paramName: 'slug', paramValue: '7', schema: 'articles' },
    })
    expect(result.data).toEqual({ id: 7 })
  })
})

// ─── where / limit / sort — evaluated locally, over what arrived ────────────


describe('createDefaultFetcher — the query is evaluated locally over what the source returned', () => {
  let fetchStub
  beforeEach(() => {
    fetchStub = stubFetch({
      body: [
        { id: 1, name: 'a', tenured: true, year: 1850 },
        { id: 2, name: 'b', tenured: false, year: 1860 },
        { id: 3, name: 'c', tenured: true, year: 1870 },
      ],
    })
  })
  afterEach(() => fetchStub.restore())

  it('applies where locally — the URL is sent exactly as written', async () => {
    const f = createDefaultFetcher()
    const result = await f.resolve({ url: 'https://api.example.com/x', where: { tenured: true } })
    expect(result.data.map((r) => r.id)).toEqual([1, 3])
    expect(fetchStub.calls[0].input).toBe('https://api.example.com/x')
  })

  it('applies limit and sort locally', async () => {
    const f = createDefaultFetcher()
    const result = await f.resolve({ url: 'https://api.example.com/x', sort: 'year desc', limit: 2 })
    expect(result.data.map((r) => r.id)).toEqual([3, 2])
  })

  it('the cache identity is the ADDRESS — a different where shares the entry', async () => {
    const f = createDefaultFetcher()
    const k1 = f.cacheKey({ url: 'https://api.example.com/x', where: { tenured: true } })
    const k2 = f.cacheKey({ url: 'https://api.example.com/x', where: { tenured: false } })
    expect(k1).toBe(k2)
  })
})


describe('createDefaultFetcher — the fallback sort is the ONE evaluator, single-key', () => {
  let fetchStub
  beforeEach(() => {
    fetchStub = stubFetch({
      body: [
        { id: 1, name: 'Banana', year: 1850 },
        { id: 2, name: 'apple', year: 1860 },
        { id: 3, name: 'cherry', year: 1870 },
      ],
    })
  })
  afterEach(() => fetchStub.restore())

  it('orders strings the way the build does — localeCompare, so case does not scatter them', async () => {
    const f = createDefaultFetcher()
    const result = await f.resolve({ url: 'https://api.example.com/x', sort: 'name' })
    expect(result.data.map((r) => r.name)).toEqual(['apple', 'Banana', 'cherry'])
  })

  it("accepts the door's `-field` spelling", async () => {
    const f = createDefaultFetcher()
    const result = await f.resolve({ url: 'https://api.example.com/x', sort: '-year' })
    expect(result.data.map((r) => r.id)).toEqual([3, 2, 1])
  })

  it('⛔ a multi-key sort throws in dev — an authoring error is seen, not half-honoured', async () => {
    const f = createDefaultFetcher({ dev: true })
    await expect(f.resolve({ url: 'https://api.example.com/x', sort: 'year desc, name asc' }))
      .resolves.toMatchObject({ error: expect.stringMatching(/more than one key/) })
  })

  it('in production a multi-key sort delivers the records unsorted and logs once', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = createDefaultFetcher()
    const a = await f.resolve({ url: 'https://api.example.com/x', sort: 'year desc, name asc' })
    const b = await f.resolve({ url: 'https://api.example.com/x', sort: 'year desc, name asc' })
    expect(a.error).toBeUndefined()
    expect(a.data.map((r) => r.id)).toEqual([1, 2, 3])
    expect(b.data.map((r) => r.id)).toEqual([1, 2, 3])
    const lines = error.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('more than one key'))
    expect(lines).toHaveLength(1)
    error.mockRestore()
  })
})


describe('createDefaultFetcher — the depth a request asked for is echoed', () => {
  let fetchStub
  beforeEach(() => { fetchStub = stubFetch({ body: {} }) })
  afterEach(() => fetchStub.restore())

  it('echoes the depth a list asked for', async () => {
    fetchStub.setResponse({ body: [{ $uuid: 'u1' }] })
    const f = createDefaultFetcher()
    const result = await f.resolve({ url: 'https://api.example.com/members', as: 'members', depth: 'brief' })
    expect(result.data).toEqual([{ $uuid: 'u1' }])
    expect(result.meta).toEqual({ depth: 'brief' })
  })

  it('a single-record request is not unwrapped with a list key, and echoes full', async () => {
    fetchStub.setResponse({ body: { $uuid: 'u1', slug: 'ada', bio: 'Full' } })
    const f = createDefaultFetcher()
    const result = await f.resolve({
      url: 'https://api.example.com/members/ada', as: 'members', depth: 'full',
      dynamicContext: { paramName: 'slug', paramValue: 'ada' },
    })
    expect(result.data).toEqual({ $uuid: 'u1', slug: 'ada', bio: 'Full' })
    expect(result.meta).toEqual({ depth: 'full' })
  })

  it('CONTROL — a request with no depth carries no meta', async () => {
    fetchStub.setResponse({ body: [{ id: 1 }] })
    const f = createDefaultFetcher()
    const result = await f.resolve({ url: 'https://api.example.com/x' })
    expect(result.meta).toBeUndefined()
  })
})

describe('⛔ the retired site-level vocabulary is NOT read (2026-09-04)', () => {
  // `fetcher.baseUrl` / `headers` / `envelope` / `supports` / `request.*` used
  // to turn this fetcher into a client for the author's backend. A backend
  // with its own conventions is a foundation TRANSPORT now; this fetcher takes
  // no `config` option at all. A site still declaring the keys gets a build
  // warning and they are dropped from the payload — and even handed in here
  // directly, nothing reads them.
  let fetchStub
  beforeEach(() => {
    fetchStub = stubFetch({ body: [{ id: 1, tenured: true }, { id: 2, tenured: false }] })
  })
  afterEach(() => fetchStub.restore())

  const RETIRED = {
    baseUrl: 'https://my-own-api.example',
    headers: { 'X-Tenant': 'acme' },
    envelope: { list: 'data.items' },
    supports: ['where', 'limit', 'sort'],
    request: { style: 'json-body', rename: { limit: 'pageSize' } },
  }

  it('a relative url: is sent as written — no baseUrl is joined', async () => {
    const f = createDefaultFetcher({ config: RETIRED })
    await f.resolve({ url: '/things' })
    expect(fetchStub.calls[0].input).toBe('/things')
  })

  it('no static headers ride on a remote request', async () => {
    const f = createDefaultFetcher({ config: RETIRED })
    await f.resolve({ url: 'https://api.example.com/x' })
    expect(fetchStub.calls[0].init.headers).toBeUndefined()
  })

  it('where is evaluated locally — nothing is pushed onto the wire', async () => {
    const f = createDefaultFetcher({ config: RETIRED })
    const result = await f.resolve({ url: 'https://api.example.com/x', where: { tenured: true }, limit: 5 })
    expect(fetchStub.calls[0].input).toBe('https://api.example.com/x')
    expect(result.data.map((r) => r.id)).toEqual([1])
  })

  it('a site-level envelope does not unwrap — the body is read as-is', async () => {
    fetchStub.setResponse({ body: { data: { items: [3, 4] } } })
    const f = createDefaultFetcher({ config: RETIRED })
    const result = await f.resolve({ url: 'https://api.example.com/x' })
    expect(result.data).toEqual({ data: { items: [3, 4] } })
  })

  it('the cache key is the address alone — no style segment, no operator projection', () => {
    const f = createDefaultFetcher({ config: RETIRED })
    const key = f.cacheKey({ url: 'https://api.example.com/x', where: { tenured: true }, limit: 5 })
    expect(key).toBe(createDefaultFetcher().cacheKey({ url: 'https://api.example.com/x' }))
    expect(key).not.toContain('style=')
  })
})

describe('⛔ the retired address door is not a lane (2026-09-04)', () => {
  let fetchStub
  beforeEach(() => { fetchStub = stubFetch({ body: [{ id: 1 }] }) })
  afterEach(() => fetchStub.restore())

  it('a request carrying only `endpoint` names no source, and nothing is fetched', async () => {
    const f = createDefaultFetcher()
    const out = await f.resolve({ endpoint: '/_records/members', as: 'members', locale: 'fr' })
    expect(out.error).toBe('No path, url or door specified')
    expect(fetchStub.calls).toHaveLength(0)
  })
})
