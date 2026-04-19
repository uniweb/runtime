import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDefaultFetcher } from '../src/default-fetcher.js'

/**
 * Tests for the runtime's default fetcher. Covers:
 *   - Baseline: plain GET, JSON, transform, basePath (today's behavior).
 *   - baseUrl: relative URL resolution for remote fetches.
 *   - envelope: collection / item / error dot-paths.
 *   - method: POST + body + placeholder substitution from dynamicContext.
 *
 * Auth headers / passthrough / env-var tokens are intentionally not part
 * of the default fetcher's vocabulary — see the architecture doc.
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
    expect(result).toEqual({ data: [], error: 'No path or url specified' })
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

describe('createDefaultFetcher — config.baseUrl', () => {
  let fetchStub
  beforeEach(() => { fetchStub = stubFetch({ body: [{ id: 1 }] }) })
  afterEach(() => fetchStub.restore())

  it('prepends baseUrl to relative URLs starting with /', async () => {
    const f = createDefaultFetcher({ config: { baseUrl: 'https://api.example.com' } })
    await f.resolve({ url: '/articles' })
    expect(fetchStub.calls[0].input).toBe('https://api.example.com/articles')
  })

  it('prepends baseUrl to relative URLs without a leading slash', async () => {
    const f = createDefaultFetcher({ config: { baseUrl: 'https://api.example.com' } })
    await f.resolve({ url: 'articles/featured' })
    expect(fetchStub.calls[0].input).toBe('https://api.example.com/articles/featured')
  })

  it('strips trailing slash on baseUrl', async () => {
    const f = createDefaultFetcher({ config: { baseUrl: 'https://api.example.com/' } })
    await f.resolve({ url: '/articles' })
    expect(fetchStub.calls[0].input).toBe('https://api.example.com/articles')
  })

  it('passes through absolute URLs (https://…) unchanged', async () => {
    const f = createDefaultFetcher({ config: { baseUrl: 'https://api.example.com' } })
    await f.resolve({ url: 'https://other.example.com/x' })
    expect(fetchStub.calls[0].input).toBe('https://other.example.com/x')
  })

  it('passes through http:// URLs unchanged', async () => {
    const f = createDefaultFetcher({ config: { baseUrl: 'https://api.example.com' } })
    await f.resolve({ url: 'http://legacy.example.com/x' })
    expect(fetchStub.calls[0].input).toBe('http://legacy.example.com/x')
  })

  it('passes through protocol-relative (//…) URLs unchanged', async () => {
    const f = createDefaultFetcher({ config: { baseUrl: 'https://api.example.com' } })
    await f.resolve({ url: '//cdn.example.com/x.json' })
    expect(fetchStub.calls[0].input).toBe('//cdn.example.com/x.json')
  })

  it('does not touch local paths even when baseUrl is set', async () => {
    const f = createDefaultFetcher({
      basePath: '/docs/',
      config: { baseUrl: 'https://api.example.com' },
    })
    await f.resolve({ path: '/data/team.json' })
    expect(fetchStub.calls[0].input).toBe('/docs/data/team.json')
  })

  it('baseUrl is a no-op when empty (baseline behavior preserved)', async () => {
    const f = createDefaultFetcher({ config: {} })
    await f.resolve({ url: '/articles' })
    expect(fetchStub.calls[0].input).toBe('/articles')
  })

  it('handles non-string baseUrl gracefully', async () => {
    const f = createDefaultFetcher({ config: { baseUrl: null } })
    await f.resolve({ url: '/articles' })
    expect(fetchStub.calls[0].input).toBe('/articles')
  })
})

describe('createDefaultFetcher — config.headers', () => {
  let fetchStub
  beforeEach(() => { fetchStub = stubFetch({ body: [] }) })
  afterEach(() => fetchStub.restore())

  it('sends static headers on remote requests', async () => {
    const f = createDefaultFetcher({
      config: {
        baseUrl: 'https://api.example.com',
        headers: { 'X-Tenant': 'acme', Accept: 'application/json' },
      },
    })
    await f.resolve({ url: '/articles' })
    expect(fetchStub.calls[0].init.headers).toEqual({
      'X-Tenant': 'acme',
      Accept: 'application/json',
    })
  })

  it('does NOT send headers on local path requests', async () => {
    const f = createDefaultFetcher({
      config: { headers: { 'X-Tenant': 'acme' } },
    })
    await f.resolve({ path: '/data/team.json' })
    expect(fetchStub.calls[0].init.headers).toBeUndefined()
  })

  it('stringifies header values', async () => {
    const f = createDefaultFetcher({
      config: { headers: { 'X-Retry-Count': 3 } },
    })
    await f.resolve({ url: 'https://api.example.com/x' })
    expect(fetchStub.calls[0].init.headers).toEqual({ 'X-Retry-Count': '3' })
  })

  it('skips null / undefined header values', async () => {
    const f = createDefaultFetcher({
      config: { headers: { 'X-Keep': 'yes', 'X-Drop-Null': null, 'X-Drop-Undef': undefined } },
    })
    await f.resolve({ url: 'https://api.example.com/x' })
    expect(fetchStub.calls[0].init.headers).toEqual({ 'X-Keep': 'yes' })
  })

  it('site headers.Content-Type wins over POST default on POST requests', async () => {
    const f = createDefaultFetcher({
      config: {
        baseUrl: 'https://api.example.com',
        headers: { 'Content-Type': 'application/graphql' },
      },
    })
    await f.resolve({ url: '/graphql', method: 'POST', body: '{ articles { id } }' })
    expect(fetchStub.calls[0].init.headers['Content-Type']).toBe('application/graphql')
  })

  it('case-insensitive content-type override', async () => {
    const f = createDefaultFetcher({
      config: { headers: { 'content-type': 'application/graphql' } },
    })
    await f.resolve({ url: 'https://api.example.com/x', method: 'POST', body: 'raw' })
    expect(fetchStub.calls[0].init.headers['content-type']).toBe('application/graphql')
    expect(fetchStub.calls[0].init.headers['Content-Type']).toBeUndefined()
  })
})

describe('createDefaultFetcher — config.envelope', () => {
  let fetchStub
  beforeEach(() => { fetchStub = stubFetch({ body: {} }) })
  afterEach(() => fetchStub.restore())

  it('envelope.collection unwraps collection responses', async () => {
    fetchStub.setResponse({ body: { data: { items: [{ id: 1 }, { id: 2 }] } } })
    const f = createDefaultFetcher({
      config: { envelope: { collection: 'data.items' } },
    })
    const result = await f.resolve({ url: 'https://api.example.com/articles' })
    expect(result.data).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('envelope.item unwraps detail responses', async () => {
    fetchStub.setResponse({ body: { data: { article: { id: 42 } } } })
    const f = createDefaultFetcher({
      config: { envelope: { collection: 'data.items', item: 'data.article' } },
    })
    const result = await f.resolve({
      url: 'https://api.example.com/articles/42',
      dynamicContext: { paramName: 'slug', paramValue: '42', schema: 'articles' },
    })
    expect(result.data).toEqual({ id: 42 })
  })

  it('per-fetch transform wins over envelope.collection', async () => {
    fetchStub.setResponse({ body: { a: { b: [1, 2] }, data: { items: [3, 4] } } })
    const f = createDefaultFetcher({
      config: { envelope: { collection: 'data.items' } },
    })
    const result = await f.resolve({ url: 'https://api.example.com/x', transform: 'a.b' })
    expect(result.data).toEqual([1, 2])
  })

  it('envelope.error extracts error text from non-2xx body', async () => {
    fetchStub.setResponse({
      status: 404,
      body: { errors: [{ message: 'article not found' }] },
    })
    const f = createDefaultFetcher({
      config: { envelope: { error: 'errors.0.message' } },
    })
    const result = await f.resolve({ url: 'https://api.example.com/x' })
    expect(result.data).toEqual([])
    expect(result.error).toBe('article not found')
  })

  it('envelope.error falls back to status text when path missing', async () => {
    fetchStub.setResponse({ status: 404, body: { other: 'shape' } })
    const f = createDefaultFetcher({
      config: { envelope: { error: 'errors.0.message' } },
    })
    const result = await f.resolve({ url: 'https://api.example.com/x' })
    expect(result.error).toMatch(/^HTTP 404/)
  })

  it('envelope.error falls back when body is not JSON', async () => {
    fetchStub.setResponse({ status: 500, body: 'raw text', contentType: 'text/plain' })
    const f = createDefaultFetcher({
      config: { envelope: { error: 'errors.0.message' } },
    })
    const result = await f.resolve({ url: 'https://api.example.com/x' })
    expect(result.error).toMatch(/^HTTP 500/)
  })

  it('empty envelope behaves like today (no-op)', async () => {
    fetchStub.setResponse({ body: [{ id: 1 }] })
    const f = createDefaultFetcher({ config: { envelope: {} } })
    const result = await f.resolve({ url: 'https://api.example.com/x' })
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
    const f = createDefaultFetcher({ config: { baseUrl: 'https://api.example.com' } })
    await f.resolve({
      url: '/search',
      method: 'POST',
      body: { filter: { status: 'published' }, limit: 10 },
    })
    expect(fetchStub.calls[0].init.method).toBe('POST')
    expect(fetchStub.calls[0].init.body).toBe(
      JSON.stringify({ filter: { status: 'published' }, limit: 10 }),
    )
  })

  it('defaults Content-Type to application/json on POST', async () => {
    const f = createDefaultFetcher({ config: { baseUrl: 'https://api.example.com' } })
    await f.resolve({ url: '/x', method: 'POST', body: { q: 1 } })
    expect(fetchStub.calls[0].init.headers['Content-Type']).toBe('application/json')
  })

  it('accepts string body passed through unchanged', async () => {
    const f = createDefaultFetcher({ config: { baseUrl: 'https://api.example.com' } })
    await f.resolve({ url: '/graphql', method: 'POST', body: '{ articles { id } }' })
    expect(fetchStub.calls[0].init.body).toBe('{ articles { id } }')
  })

  it('substitutes {paramName} placeholders in body using dynamicContext', async () => {
    const f = createDefaultFetcher({ config: { baseUrl: 'https://api.example.com' } })
    await f.resolve({
      url: '/graphql',
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
    const f = createDefaultFetcher({ config: { baseUrl: 'https://api.example.com' } })
    await f.resolve({ url: '/articles', body: { x: 1 } })
    expect(fetchStub.calls[0].init.body).toBeUndefined()
  })

  it('warns and falls back to GET for unsupported method', async () => {
    const f = createDefaultFetcher({ config: { baseUrl: 'https://api.example.com' } })
    await f.resolve({ url: '/articles', method: 'DELETE' })
    expect(fetchStub.calls[0].init.method).toBe('GET')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not supported'))
  })

  it('method is case-insensitive', async () => {
    const f = createDefaultFetcher({ config: { baseUrl: 'https://api.example.com' } })
    await f.resolve({ url: '/x', method: 'post', body: { q: 1 } })
    expect(fetchStub.calls[0].init.method).toBe('POST')
  })

  it('per-request envelope overrides site-level envelope', async () => {
    fetchStub.setResponse({ body: { data: { article: { id: 7 } }, other: [] } })
    const f = createDefaultFetcher({
      config: { envelope: { collection: 'data.x' } }, // site-level
    })
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

// ─── supports: capability declaration + where/limit/sort ────────────────────

describe('createDefaultFetcher — supports: [] (default, runtime fallback)', () => {
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

  it('applies where as runtime fallback (no pushdown)', async () => {
    const f = createDefaultFetcher()
    const result = await f.resolve({ url: 'https://api.example.com/x', where: { tenured: true } })
    expect(result.data.map((r) => r.id)).toEqual([1, 3])
    expect(fetchStub.calls[0].input).toBe('https://api.example.com/x')
  })

  it('applies limit and sort as runtime fallback', async () => {
    const f = createDefaultFetcher()
    const result = await f.resolve({ url: 'https://api.example.com/x', sort: 'year desc', limit: 2 })
    expect(result.data.map((r) => r.id)).toEqual([3, 2])
  })

  it('cache key does not include operators when none are pushed down', async () => {
    const f = createDefaultFetcher()
    const k1 = f.cacheKey({ url: 'https://api.example.com/x', where: { tenured: true } })
    const k2 = f.cacheKey({ url: 'https://api.example.com/x', where: { tenured: false } })
    expect(k1).toBe(k2)
  })
})

describe('createDefaultFetcher — supports: [where] (predicate pushdown)', () => {
  let fetchStub
  beforeEach(() => {
    fetchStub = stubFetch({ body: [{ id: 99, filtered: true }] })
  })
  afterEach(() => fetchStub.restore())

  it('appends ?_where= to GET URLs when where is pushed down', async () => {
    const f = createDefaultFetcher({ config: { supports: ['where'] } })
    await f.resolve({ url: 'https://api.example.com/x', where: { tenured: true } })
    const url = fetchStub.calls[0].input
    expect(url).toContain('_where=')
    expect(decodeURIComponent(url.split('_where=')[1])).toBe(JSON.stringify({ tenured: true }))
  })

  it('returns the source response unchanged when where is pushed down', async () => {
    const f = createDefaultFetcher({ config: { supports: ['where'] } })
    const result = await f.resolve({ url: 'https://api.example.com/x', where: { tenured: true } })
    expect(result.data).toEqual([{ id: 99, filtered: true }])
  })

  it('cache key includes where when pushed down', async () => {
    const f = createDefaultFetcher({ config: { supports: ['where'] } })
    const k1 = f.cacheKey({ url: 'https://api.example.com/x', where: { tenured: true } })
    const k2 = f.cacheKey({ url: 'https://api.example.com/x', where: { tenured: false } })
    expect(k1).not.toBe(k2)
  })

  it('does not push down on local path: requests', async () => {
    const f = createDefaultFetcher({ config: { supports: ['where'] } })
    await f.resolve({ path: '/data/local.json', where: { tenured: true } })
    expect(fetchStub.calls[0].input).toBe('/data/local.json')
  })
})

describe('createDefaultFetcher — supports: partial (mixed pushdown + fallback)', () => {
  let fetchStub
  beforeEach(() => {
    fetchStub = stubFetch({
      body: [
        { id: 1, year: 1850, tenured: true },
        { id: 2, year: 1860, tenured: false },
        { id: 3, year: 1870, tenured: true },
      ],
    })
  })
  afterEach(() => fetchStub.restore())

  it('pushes down sort but applies where as fallback', async () => {
    const f = createDefaultFetcher({ config: { supports: ['sort'] } })
    const result = await f.resolve({
      url: 'https://api.example.com/x',
      where: { tenured: true },
      sort: 'year desc',
    })
    const url = fetchStub.calls[0].input
    expect(url).toContain('_sort=')
    expect(url).not.toContain('_where=')
    // Where is applied client-side after the source returned everything.
    expect(result.data.map((r) => r.id)).toEqual([1, 3])
  })

  it('appends _limit= when limit is pushed down', async () => {
    const f = createDefaultFetcher({ config: { supports: ['limit'] } })
    await f.resolve({ url: 'https://api.example.com/x', limit: 5 })
    expect(fetchStub.calls[0].input).toContain('_limit=5')
  })
})

describe('createDefaultFetcher — POST with where pushdown', () => {
  let fetchStub
  beforeEach(() => {
    fetchStub = stubFetch({ body: [{ id: 1 }] })
  })
  afterEach(() => fetchStub.restore())

  it('merges where into POST body when pushed down', async () => {
    const f = createDefaultFetcher({ config: { supports: ['where'] } })
    await f.resolve({
      url: 'https://api.example.com/search',
      method: 'POST',
      body: { token: 'abc' },
      where: { tenured: true },
    })
    const body = JSON.parse(fetchStub.calls[0].init.body)
    expect(body.token).toBe('abc')
    expect(body.where).toEqual({ tenured: true })
  })

  it('sends a body with only operators when no author body is supplied', async () => {
    const f = createDefaultFetcher({ config: { supports: ['where', 'limit'] } })
    await f.resolve({
      url: 'https://api.example.com/search',
      method: 'POST',
      where: { tenured: true },
      limit: 5,
    })
    const body = JSON.parse(fetchStub.calls[0].init.body)
    expect(body).toEqual({ where: { tenured: true }, limit: 5 })
  })
})

describe('createDefaultFetcher — supports: validation', () => {
  let fetchStub
  beforeEach(() => {
    fetchStub = stubFetch({ body: [] })
  })
  afterEach(() => fetchStub.restore())

  it('ignores unknown operators in supports with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = createDefaultFetcher({ config: { supports: ['where', 'unknownOp'] } })
    await f.resolve({ url: 'https://api.example.com/x', where: { id: 1 } })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown operator'))
    warn.mockRestore()
  })

  it('non-array supports treated as empty', async () => {
    const f = createDefaultFetcher({ config: { supports: 'where' } })
    const result = await f.resolve({ url: 'https://api.example.com/x', where: { id: 1 } })
    // No pushdown — request URL has no _where= param, response is filtered locally.
    expect(fetchStub.calls[0].input).toBe('https://api.example.com/x')
    expect(result.data).toEqual([])
  })
})
