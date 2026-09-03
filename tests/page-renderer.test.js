import { describe, it, expect, vi } from 'vitest'

// ⭐ MOCKED AT THE SEAM, DELIBERATELY. `page-renderer.js` contains composition and
// outcome mapping and nothing else — each step it calls is covered by its own file
// (`ssr-page-resolution.test.js`, `prefetch.test.js`). Driving a real `renderPage`
// here would need a real Website, a real layout and a real React tree, and would
// then be testing those, not the join. Stubbing the four imported steps tests the
// only thing this module owns: which outcome each of their answers becomes.
vi.mock('../src/ssr-renderer.js', () => ({
  resolvePage: (website, route) => website.getPage(route),
  renderPage: (page, website) => website.__render(page),
  classifyRenderError: (err) => ({ type: 'classified', message: err.message }),
  injectPageContent: (shell, content, page, opts) =>
    shell.replace('<!--SLOT-->', `${content}|${page.route}|${opts.sectionOverrideCSS || ''}|${opts.extra || ''}`),
}))

const { createPageRenderer, prefetchAndHydrate } = await import('../src/page-renderer.js')

const SHELL = '<!DOCTYPE html><html><body><div id="root"><!--SLOT--></div></body></html>'
const page = (route) => ({ route })

/**
 * A Website stub whose `__render` says what `renderPage` answered for a route:
 * an ok result, a returned `{error}`, or a throw.
 */
function websiteStub(routes, answers = {}) {
  return {
    getPage: (route) => (routes.includes(route) ? page(route) : undefined),
    pages: routes.map(page),
    __render: (p) => {
      const a = answers[p.route]
      if (a === 'throw') throw new Error('Invalid hook call')
      if (a === 'error') return { error: { type: 'content-not-loaded', message: 'no sections' } }
      return { renderedContent: `<h1>${p.route}</h1>`, sectionOverrideCSS: '.s{}' }
    },
  }
}

describe('createPageRenderer — the guards', () => {
  it('refuses a missing website and a non-string shell', () => {
    expect(() => createPageRenderer({ shell: SHELL })).toThrow(/website/)
    expect(() => createPageRenderer({ website: websiteStub([]), shell: null })).toThrow(/shell/)
    // A shell arriving as an object is the shape of a caller passing a Response or
    // a config by mistake; failing here beats injecting into "[object Object]".
    expect(() => createPageRenderer({ website: websiteStub([]), shell: {} })).toThrow(/shell/)
  })
})

describe('createPageRenderer — the outcome triple', () => {
  it('renders a route through the same matcher the browser uses, and injects into the shell', () => {
    const r = createPageRenderer({ website: websiteStub(['/blog/1']), shell: SHELL }).render('/blog/1')

    expect(r.outcome).toBe('rendered')
    expect(r.page.route).toBe('/blog/1')
    expect(r.error).toBeNull()
    // Injected INTO the shell it was given, not a document of our own.
    expect(r.html).toContain('<!DOCTYPE html>')
    expect(r.html).toContain('<h1>/blog/1</h1>')
    // The per-page override CSS reaches injectPageContent — dropping it renders a
    // page whose theme pinning is silently missing.
    expect(r.html).toContain('.s{}')
  })

  it('accepts an already-resolved Page — what the build lane holds in its own loop', () => {
    // The build iterates `website.pages`; making it re-derive a route only to look
    // the same page back up would be a worse interface than the one it replaced.
    const r = createPageRenderer({ website: websiteStub(['/about']), shell: SHELL }).render(page('/about'))
    expect(r.outcome).toBe('rendered')
  })

  it('forwards extra inject options without losing its own', () => {
    const r = createPageRenderer({ website: websiteStub(['/a']), shell: SHELL })
      .render('/a', { inject: { extra: 'X' } })
    expect(r.html).toContain('.s{}')
    expect(r.html).toContain('X')
  })

  it('an unmatched route is `notFound`, NOT `failed`', () => {
    // The distinction a caller keys a status code on. `notFound` means nothing
    // matched — a 404 the host serves its own page for; `failed` means a page
    // matched and rendering it broke, which is a 500 or a client-side fallback.
    const r = createPageRenderer({ website: websiteStub(['/a']), shell: SHELL }).render('/nope')
    expect(r.outcome).toBe('notFound')
    expect(r.page).toBeNull()
    expect(r.error).toBeNull()
    expect(r.html).toBeNull()
  })

  it('a returned render error is `failed`, and carries the classification through', () => {
    const r = createPageRenderer({ website: websiteStub(['/bad'], { '/bad': 'error' }), shell: SHELL }).render('/bad')
    expect(r.outcome).toBe('failed')
    expect(r.error.type).toBe('content-not-loaded')
    expect(r.page.route).toBe('/bad')
    expect(r.html).toBeNull()
  })

  it('a THROWING render is `failed` and classified, never propagated', () => {
    // renderPage handles its own errors, but a foundation can throw where it does
    // not. One broken section must not fail a whole build loop or an isolate request.
    const r = createPageRenderer({ website: websiteStub(['/bad'], { '/bad': 'throw' }), shell: SHELL }).render('/bad')
    expect(r.outcome).toBe('failed')
    expect(r.error.type).toBe('classified')
  })

  it('CONTROL — the three outcomes are distinguishable without reading `html`', () => {
    // If a caller had to infer the case from a null html, the two null cases would
    // be one case, which is exactly the collapse this triple prevents.
    const r = createPageRenderer({ website: websiteStub(['/ok', '/bad'], { '/bad': 'throw' }), shell: SHELL })
    expect([r.render('/ok').outcome, r.render('/bad').outcome, r.render('/x').outcome])
      .toEqual(['rendered', 'failed', 'notFound'])
  })
})

describe('prefetchAndHydrate', () => {
  // The payload shape a backend publishes, matching tests/prefetch.test.js.
  const CONTENT = {
    config: {
      base: '/site',
      defaultLanguage: 'en',
      languages: ['en'],
      queries: { members: { name: 'members', schema: '@std/person' } },
      records: { list: '/_records/{path}', record: '/_records/{path}/{param}', envelope: { records: 'entries' } },
    },
    pages: [{ route: '/team', parent: null, isDynamic: false, fetch: { query: 'members', as: 'people' }, sections: [] }],
  }

  const okFetch = (body) => vi.fn(async () => ({
    ok: true, status: 200, statusText: 'OK',
    headers: { get: () => 'application/json' },
    json: async () => body, text: async () => JSON.stringify(body),
  }))

  it('hydrates what it fetched and hands the outcomes back', async () => {
    const set = vi.fn()
    const out = await prefetchAndHydrate({
      website: { dataStore: { set } }, content: CONTENT, route: '/team',
      fetch: okFetch({ entries: [{ id: 1 }] }),
    })

    expect(out).toHaveLength(1)
    expect(out[0].outcome).toBe('fetched')
    // The whole point of the helper: the host never assembles `{config, data}`
    // itself, and never keys the store — hydrateDataStore derives the key.
    expect(set).toHaveBeenCalledTimes(1)
  })

  it('CONTROL — a transport failure hydrates nothing and is reported, not thrown', async () => {
    // "nothing was tried" and "everything tried failed" are different cache
    // decisions; a swallowed error would make them the same.
    const set = vi.fn()
    const out = await prefetchAndHydrate({
      website: { dataStore: { set } }, content: CONTENT, route: '/team',
      fetch: vi.fn(async () => { throw new Error('upstream down') }),
    })

    expect(out[0].outcome).toBe('failed')
    expect(set).not.toHaveBeenCalled()
  })

  it('CONTROL — an unknown route fetches nothing at all', async () => {
    const fetch = okFetch({ entries: [] })
    const out = await prefetchAndHydrate({
      website: { dataStore: { set: vi.fn() } }, content: CONTENT, route: '/nope', fetch,
    })
    expect(out).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })
})
