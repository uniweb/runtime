/**
 * ⭐ THE DATA STEP ASKS FOR WHAT THE RENDER READS — no less, and nothing else.
 *
 * The edge prerenders the page a visit starts on, and that render is synchronous: a section reads
 * its data from the cache and never waits (`EntityStore.resolve`). So the step before it has to ask
 * for exactly what the render will look for. ⛔ Until 2026-09-19 a host's prefetch worked that out
 * from the payload alone, and could not: it did not know which keys a component declares, which
 * layout the page draws, or which transport a key is routed to. The four cases below are the ones
 * measured against that copy; each renders empty in
 * the served HTML and fills in later in the browser, so nobody clicking the site ever sees it.
 *
 * ⚖️ **The assertion is made against the render's own reader, not against a list.** After the step,
 * every block the page draws must `resolve` to `ready` — `resolve` is the only data call the SSR
 * renderer makes (`ssr-renderer.js::renderBlock`) — and every key the step fetched must be one the
 * render looked up. A list of expected addresses would only ever agree with whoever wrote it.
 */
import { describe, it, expect, vi } from 'vitest'
import DataStore, { deriveCacheKey } from '@uniweb/core/datastore'
import { initPrerender } from '../src/ssr-renderer.js'
import { getComponentMeta } from '../src/prepare-props.js'
import { hydrateDataStore } from '../src/wire-foundation.js'
import { loadPageData } from '../src/load-page-data.js'
import { createPageRenderer } from '../src/page-renderer.js'

const POSTS = [
  { $name: 'a', title: 'A' },
  { $name: 'b', title: 'B' },
]
const ITEMS = [{ id: '7', $name: 'seven', title: 'Seven' }]

/** A transport the SITE selects for one key — a foundation's, which a payload cannot know about. */
const siteTransport = { resolve: vi.fn(async () => ({ data: [{ label: 'Home' }] })) }

const foundation = {
  default: {
    meta: {
      PostList: { data: { posts: null } },
      PostDetail: { data: { posts: null } },
      // expects its record WHOLE (2026-09-27; `whole: true` since 2026-10-07), so the page's record is
      // asked by its own file
      ItemDetail: { data: { items: { schema: '@test/items', whole: true } } },
      Nav: { data: { menu: null } },
      Toc: { data: { toc: null } },
      Plain: {}, // declares nothing, so nothing reaches it
    },
    capabilities: { transports: { mine: siteTransport } },
  },
}

const section = (type, over = {}) => ({ type, content: {}, params: {}, ...over })

function site(overrides = {}) {
  return {
    config: {
      name: 'T',
      defaultLanguage: 'en',
      queries: {
        posts: { schema: '@/post', path: '/data/posts.json' },
        items: { schema: '@/item', path: '/data/items.json', deferred: ['body'] },
      },
      fetcher: { transports: { menu: 'mine' } },
      ...(overrides.config || {}),
    },
    theme: {},
    layouts: {
      default: {
        header: { route: '/layout/header', sections: [section('Nav', { fetch: { path: '/data/menu.json', as: 'menu' } })] },
        left: { route: '/layout/left', sections: [section('Toc', { fetch: { path: '/data/toc.json', as: 'toc' } })] },
      },
    },
    pages: [
      { route: '/', isIndex: true, title: 'Home', sections: [section('Plain')] },
      {
        route: '/posts',
        title: 'Posts',
        fetch: { query: 'posts', as: 'posts' },
        sections: [section('PostList')],
      },
      // a static child of a page that declares a query: the query reaches its sections, and none
      // of them declares the key
      { route: '/posts/about', parent: '/posts', title: 'About', sections: [section('Plain')] },
      {
        route: '/posts/:slug',
        parent: '/posts',
        isDynamic: true,
        paramName: 'slug',
        title: 'Post',
        sections: [section('PostDetail')],
      },
      // an `[id]` route over a `deferred:` query — the record's own file is named by the RECORD
      { route: '/items', title: 'Items', fetch: { query: 'items', as: 'items' }, sections: [section('Plain')] },
      {
        route: '/items/:id',
        parent: '/items',
        isDynamic: true,
        paramName: 'id',
        title: 'Item',
        sections: [section('ItemDetail')],
      },
      // names a layout the site has no folder for: the runtime draws the DEFAULT set's areas
      { route: '/guide', title: 'Guide', layout: { name: 'Blog' }, sections: [section('Plain')] },
      // hides an area: its sections are not drawn
      { route: '/quiet', title: 'Quiet', layout: { hide: ['left'] }, sections: [section('Plain')] },
      ...(overrides.pages || []),
    ],
  }
}

/** The transport a host hands in, per request. Answers by path; records what was asked. */
function transport() {
  const asked = []
  const fetch = vi.fn(async (url) => {
    asked.push(String(url))
    // The service answers an envelope keyed by the question's key, and says which keys came whole.
    const body = String(url).includes('/_records/')
      ? { data: { posts: [{ $uuid: 'u1', $name: 'b', title: 'B', body: 'Full' }] }, whole: { posts: true } }
      : String(url).includes('/data/posts.json') ? POSTS
      : String(url).includes('/data/items.json') ? ITEMS
      : String(url).includes('/data/items/seven.json') ? { ...ITEMS[0], body: 'Full' }
      : String(url).includes('/data/menu.json') ? [{ label: 'Home' }]
      : String(url).includes('/data/toc.json') ? [{ label: 'Intro' }]
      : null
    return {
      ok: body !== null,
      status: body === null ? 404 : 200,
      headers: { get: () => 'application/json' },
      json: async () => body,
      text: async () => JSON.stringify(body),
    }
  })
  return { fetch, asked }
}

/** The same answers from records synced once: each carries a `$uuid`, so the record index files it. */
function syncedTransport() {
  const { fetch: answer, asked } = transport()
  const synced = (body) => (Array.isArray(body) ? body.map(synced)
    : body?.$name ? { $uuid: `u-${body.$name}`, ...body }
    : body)
  const fetch = async (url, init) => {
    const response = await answer(url, init)
    const body = synced(await response.json())
    return { ...response, json: async () => body, text: async () => JSON.stringify(body) }
  }
  return { fetch, asked }
}

/** Every block the page draws, as the renderer reaches them. */
function blocksOf(page) {
  const out = []
  const walk = (list) => {
    for (const block of list || []) {
      if (!block) continue
      out.push(block)
      walk(block.childBlocks)
      walk(block.insets)
    }
  }
  walk(page.getBodyBlocks())
  for (const area of Object.values(page.getLayoutAreas() || {})) walk(area)
  return out
}

/**
 * Run the step for a route, hydrate as a host does, then read the page back the way the SSR
 * renderer does. Returns what was asked and what the render found.
 */
async function serve(route, content = site()) {
  const uniweb = initPrerender(content, foundation, [])
  const website = uniweb.activeWebsite
  const { fetch, asked } = transport()

  const entries = await loadPageData({ website, route, fetch })
  hydrateDataStore(website, entries)

  // The render's own reads: the page (which names itself from its record) and every block.
  // ⚖️ Instrumented on the prototype because a DataStore instance is sealed — and read through
  // the real store, so what the render finds is what was hydrated, not what a stub says.
  const peeked = []
  const get = DataStore.prototype.get
  vi.spyOn(DataStore.prototype, 'get').mockImplementation(function (key) {
    peeked.push(key)
    return get.call(this, key)
  })
  const page = website.getPage(route)
  const statuses = page
    ? blocksOf(page).map((block) => ({
        type: block.type,
        status: website.entityStore.resolve(block, getComponentMeta(block.type)).status,
      }))
    : []
  vi.restoreAllMocks()

  return { entries, asked, page, statuses, peeked, website }
}

describe('the step asks for what the render reads', () => {
  it('a list page: every block resolves, and nothing was asked that the render did not look up', async () => {
    const { entries, statuses, peeked } = await serve('/posts')

    expect(statuses.length).toBeGreaterThan(0)
    expect(statuses.every((s) => s.status !== 'pending')).toBe(true)
    // exactness the other way: each request is one the render looked for
    for (const entry of entries) expect(peeked).toContain(deriveCacheKey(entry.config))
  })

  it('a parametric page: its record resolves, and the page names itself from it', async () => {
    const { page, statuses } = await serve('/posts/b')
    expect(statuses.every((s) => s.status !== 'pending')).toBe(true)
    expect(page.title).toBe('B')
    expect(page.notFound).toBeFalsy()
  })

  it('a URL naming no record is a not-found, because the page’s own record is asked for', async () => {
    const { page } = await serve('/posts/zzz')
    expect(page.notFound).toBe(true)
  })

  it('…and the renderer says so to its caller — the outcome is `notFound`, not `rendered`', async () => {
    // The isolate's whole sequence on a real Website: the data step, then the render. A host
    // keys its status on the outcome, so a page naming no record must reach it as `notFound`;
    // until 2026-09-30 it arrived as `rendered`, and a host sent 200 for it.
    const shell = '<html><head></head><body><div id="root"></div></body></html>'
    const missing = await serve('/posts/zzz')
    expect(createPageRenderer({ website: missing.website, shell }).render('/posts/zzz').outcome).toBe('notFound')
    // CONTROL — a record that exists is not a not-found.
    const found = await serve('/posts/b')
    expect(createPageRenderer({ website: found.website, shell }).render('/posts/b').outcome).not.toBe('notFound')
  })

  it('⭐ a URL naming no page asks for the site’s not-found page’s data — the page its render draws', async () => {
    // The page the browser shows for such a URL and `render` draws for it, so its data is what the
    // step asks for: here what its layout's header and left areas declare, as for any page.
    const content = { ...site(), notFound: { route: '/404', title: 'Not found', sections: [section('Plain')] } }
    const website = initPrerender(content, foundation, []).activeWebsite
    const { fetch } = transport()
    const keys = (entries) => entries.map((e) => [deriveCacheKey(e.config), e.outcome])
    const byRoute = await loadPageData({ website, route: '/no-such-page', fetch })
    const byPage = await loadPageData({ website, route: website.getNotFoundPage(), fetch })
    expect(byRoute.length).toBeGreaterThan(0)
    expect(keys(byRoute)).toEqual(keys(byPage))
  })

  it('…and asks nothing for a site with no not-found page', async () => {
    const website = initPrerender(site(), foundation, []).activeWebsite
    expect(website.getNotFoundPage()).toBeFalsy()
    expect(await loadPageData({ website, route: '/no-such-page', fetch: transport().fetch })).toEqual([])
  })

  it('⛔ a fetch NO section declares is not asked — a parent page’s query on a child that does not read it', async () => {
    const { entries, asked, statuses } = await serve('/posts/about')
    expect(statuses.every((s) => s.status !== 'pending')).toBe(true)
    // its layout is drawn, so the layout's keys ARE asked for — and the parent's query is not,
    // because no section on this page declares it
    expect(entries.map((e) => e.config.as)).toEqual(expect.arrayContaining(['menu', 'toc']))
    expect(entries.map((e) => e.config.as)).not.toContain('posts')
    expect(asked.some((url) => url.includes('/data/posts.json'))).toBe(false)
  })

  it('⛔ the record of an `[id]` route over a `deferred:` query is asked for by the RECORD’s handle', async () => {
    const { asked, statuses } = await serve('/items/7')
    // the set, then the record's own file — named `seven`, not the route's `7` and not `{slug}`
    expect(asked.some((url) => url.includes('/data/items/seven.json'))).toBe(true)
    expect(asked.some((url) => url.includes('{slug}'))).toBe(false)
    expect(statuses.every((s) => s.status !== 'pending')).toBe(true)
  })

  it('⛔ a layout the site has no folder for: the render draws the DEFAULT set, so its data is asked for', async () => {
    const { statuses, asked } = await serve('/guide')
    // the header and left areas of the default set are drawn
    expect(statuses.map((s) => s.type)).toEqual(expect.arrayContaining(['Nav', 'Toc']))
    expect(statuses.every((s) => s.status !== 'pending')).toBe(true)
    expect(asked.some((url) => url.includes('/data/toc.json'))).toBe(true)
  })

  it('⛔ an area the page hides is not drawn, so its data is not asked for', async () => {
    const { statuses, asked } = await serve('/quiet')
    expect(statuses.map((s) => s.type)).not.toContain('Toc')
    expect(asked.some((url) => url.includes('/data/toc.json'))).toBe(false)
    expect(statuses.every((s) => s.status !== 'pending')).toBe(true)
  })

  it('⛔ a key the SITE routes to a foundation transport goes through that transport', async () => {
    siteTransport.resolve.mockClear()
    const { asked } = await serve('/posts')
    expect(siteTransport.resolve).toHaveBeenCalled()
    // and the framework default never fetched the menu itself
    expect(asked.some((url) => url.includes('/data/menu.json'))).toBe(false)
  })

  it('⭐ on a records service the page’s record is ONE question, and the page names itself from its answer', async () => {
    // The lane a hosted site is served on: no compiled file, a question door instead. The record is
    // the query's set narrowed by the route's handle, so it is one question and no list beside it.
    const hosted = site({
      config: {
        services: { records: '/_records/ask/{locale}' },
        queries: { posts: { schema: '@/post', sort: 'title', limit: 20 } },
      },
    })
    const { entries, asked, page, statuses } = await serve('/posts/b', hosted)

    expect(asked.filter((url) => url.includes('/_records/'))).toHaveLength(1)
    expect(asked.some((url) => url.includes('/data/posts.json'))).toBe(false) // no list beside it
    expect(entries.every((e) => e.outcome === 'fetched')).toBe(true)
    expect(statuses.every((s) => s.status !== 'pending')).toBe(true)
    expect(page.title).toBe('B')
  })

  it('⭐ a shared cache reads each address once, and every page still reports every request it made', async () => {
    // What a static build needs: N pages of one site, each asking for the site's and its parent's
    // data. ⛔ The entries must stay complete even when an answer came from the cache — a caller
    // embedding them per page would otherwise ship a page that asks the browser for what the build
    // already had.
    const website = initPrerender(site(), foundation, []).activeWebsite
    const { fetch, asked } = transport()
    const cache = new DataStore()

    const list = await loadPageData({ website, route: '/posts', fetch, cache })
    const record = await loadPageData({ website, route: '/posts/b', fetch, cache })

    expect(asked.filter((url) => url.includes('/data/posts.json'))).toHaveLength(1)
    expect(list.some((e) => e.config.as === 'posts')).toBe(true)
    expect(record.some((e) => e.config.as === 'posts')).toBe(true)
    expect(record.every((e) => e.outcome === 'fetched')).toBe(true)
  })

  it('⛔ …and a record an EARLIER page fetched whole is still asked for by the page that shows it', async () => {
    // Records synced once carry a `$uuid`, so the record index files one fetched whole by it, and a
    // page about that record asks first whether it is held whole already. Over a shared cache the
    // answer was another page's: the record page asked nothing for its record and carried none, and
    // its prerender read the record from a store the browser's never holds. What a page asks must
    // not depend on which pages asked before it.
    const featured = { route: '/featured', title: 'Featured', fetch: { query: 'items', as: 'items' }, sections: [section('ItemDetail')] }
    const website = initPrerender(site({ pages: [featured] }), foundation, []).activeWebsite
    const { fetch, asked } = syncedTransport()
    const cache = new DataStore()

    const list = await loadPageData({ website, route: '/featured', fetch, cache })
    const record = await loadPageData({ website, route: '/items/7', fetch, cache })

    const wholeOf = (entries) => entries.find((e) => e.config.path?.endsWith('/data/items/seven.json'))
    expect(wholeOf(list)?.outcome).toBe('fetched') // CONTROL: the list page fetched the record whole
    expect(wholeOf(record)?.outcome).toBe('fetched')
    expect(wholeOf(record)?.data).toMatchObject({ $uuid: 'u-seven', body: 'Full' })
    // still read once: the record page's answer came from the cache
    expect(asked.filter((url) => url.includes('/data/items/seven.json'))).toHaveLength(1)
  })

  it('CONTROL — an unknown route asks for nothing', async () => {
    const { entries, asked } = await serve('/nope')
    expect(entries).toEqual([])
    expect(asked).toEqual([])
  })

  it('⛔ a locale that disagrees with the Website is refused, not applied', async () => {
    // A Website is sliced for one locale and resolves every address in it. Taking a second locale
    // here would prerender a page in one language with the data of another, and nothing downstream
    // would see it — so the mistake is reported where it is made.
    const uniweb = initPrerender(site(), foundation, [])
    await expect(
      loadPageData({ website: uniweb.activeWebsite, route: '/posts', fetch: transport().fetch, locale: 'fr' }),
    ).rejects.toThrow(/locale-sliced/)
    // CONTROL — its own locale is accepted
    await expect(
      loadPageData({ website: uniweb.activeWebsite, route: '/posts', fetch: transport().fetch, locale: 'en' }),
    ).resolves.toBeInstanceOf(Array)
  })

  it('⛔ a transport that did not arrive is REFUSED, not replaced by the ambient fetch', async () => {
    // The default fetcher falls back to `globalThis.fetch`, so in an isolate a lost transport would
    // become the isolate's own network, and with an absolute address the request would come back
    // `fetched`. Refused before the route is resolved, so an unknown route cannot hide it.
    const website = initPrerender(site(), foundation, []).activeWebsite
    for (const bad of [undefined, null, {}, 'fetch']) {
      await expect(loadPageData({ website, route: '/posts', fetch: bad })).rejects.toThrow(/loadPageData: `fetch` must be a function/)
    }
    await expect(loadPageData({ website, route: '/nope' })).rejects.toThrow(/must be a function/)
  })

  it('CONTROL — the ambient fetch is still reachable, by saying so', async () => {
    // The refusal removes the accident, not the option.
    const { fetch, asked } = transport()
    const prev = globalThis.fetch
    globalThis.fetch = fetch
    try {
      const website = initPrerender(site(), foundation, []).activeWebsite
      const entries = await loadPageData({ website, route: '/posts', fetch: globalThis.fetch })
      expect(entries.some((e) => e.outcome === 'fetched')).toBe(true)
      expect(asked.some((url) => url.includes('/data/posts.json'))).toBe(true)
    } finally {
      globalThis.fetch = prev
    }
  })
})
