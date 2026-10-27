/**
 * ⭐ THE PAGE THE BROWSER RENDERS AT BOOT IS THE PAGE THE PRERENDER WROTE.
 *
 * The browser does not hydrate a prerendered page: it renders the page again and puts that in its
 * place (`createRoot`, `index.jsx`). So a difference between the two renderers is a change a visitor
 * sees at boot, and for a crawler, which runs no script, the prerendered page is the whole site.
 *
 * This renders whole pages both ways, each booted as it is in its own lane: the browser's `Layout`
 * over the singleton `initUniweb` builds (`setup.js`, with its `ChildBlocks` and `Background`), and
 * the prerender's `renderLayout` over the one `initPrerender` builds. Both go through
 * `renderToString`, so a difference in the markup is a difference between the renderers, not between
 * serializers. `Layout` is where the browser's page markup comes from — `PageRenderer` adds no
 * element — so the Router and `PageRenderer` are left out, as in `default-layout-parity.test.js`.
 *
 * ⛔ Measured before 2026-10-25, the two disagreed on a page whose data the browser fetches (the
 * prerender painted the empty state, the browser the loading one), on an overlay gradient at
 * `angle: 0`, on a video background (the prerender drew none), and on the `className` a component
 * passes for a background it paints itself.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { deriveCacheKey } from '@uniweb/core/datastore'
import { initPrerender, renderLayout, renderPage } from '../src/ssr-renderer.js'
import { initUniweb } from '../src/setup.js'
import { hydrateDataStore } from '../src/wire-foundation.js'
import { loadPageData } from '../src/load-page-data.js'
import { createPageRenderer } from '../src/page-renderer.js'
import { getComponentMeta } from '../src/prepare-props.js'
import { videoMoves } from '../src/background.js'
import Layout from '../src/components/Layout.jsx'

const h = React.createElement

// Section types written as plain components, so what is under test is the runtime's two renderers.
const Hero = ({ params }) => h('h1', null, params.title || 'Hello')
const Posts = ({ content, block }) =>
  block.dataLoading
    ? h('p', { className: 'loading' }, 'Loading posts…')
    : h('ul', null, (content.data.posts || []).map((p) => h('li', { key: p.$name }, p.title)))
// Paints its own background, where it wants it, the way kit's `SectionBackground` does.
const Painted = ({ block }) =>
  h('div', { className: 'relative' },
    h(globalThis.uniweb.backgroundRenderer, { ...block.background, className: 'painted' }),
    h('p', null, 'Self'))
const Grid = ({ block }) => h('div', { className: 'grid' }, h(globalThis.uniweb.childBlockRenderer, { from: block }))
const Nav = () => h('nav', null, 'Menu')
const Docs = ({ header, body, left, footer }) =>
  h('div', { className: 'docs' }, header, h('aside', null, left), h('main', null, body), footer)
// Reads the store itself on its first render, as kit's `useFetched` does, for a key its page does
// not declare. `peekKey` is the posts list's key, set by the test that renders it.
let peekKey = null
const Peek = () => {
  const held = peekKey ? globalThis.uniweb.activeWebsite.dataStore.get(peekKey) : null
  return h('p', { className: 'peek' }, held ? `held ${held.data.length}` : 'nothing held')
}
// A parametric page's title, which it takes from its record when it is made.
const PostTitle = ({ block }) => h('h2', null, block.page.title)
// Reaches the site through the global, as kit's `useWebsite` does: `getUniweb().activeWebsite`.
const Who = () => h('p', { className: 'who' }, globalThis.uniweb.activeWebsite.name)
// The page the site holds as active while it renders, as a header marking the current page reads it.
const Active = () => h('p', { className: 'active' }, globalThis.uniweb.activeWebsite.activePage?.route)

const foundation = {
  default: {
    meta: { Hero: {}, Posts: { data: { posts: null } }, Painted: { background: 'self' }, Grid: {}, Nav: {}, Peek: {}, PostTitle: {}, Who: {}, Active: {} },
    capabilities: { layouts: { Docs } },
  },
  Hero,
  Posts,
  Painted,
  Grid,
  Nav,
  Peek,
  PostTitle,
  Who,
  Active,
}

const section = (type, params = {}, more = {}) => ({ type, content: {}, params, ...more })
const POSTS = [{ $name: 'a', title: 'A' }, { $name: 'b', title: 'B' }]

const site = {
  config: {
    name: 'T',
    defaultLanguage: 'en',
    queries: { posts: { path: '/data/posts.json' } },
  },
  theme: {},
  layouts: {
    default: {
      header: { route: '/layout/header', sections: [section('Nav')] },
      left: { route: '/layout/left', sections: [section('Nav')] },
    },
  },
  pages: [
    {
      route: '/',
      isIndex: true,
      title: 'Backgrounds',
      sections: [
        section('Hero', { background: { mode: 'color', color: '#123' } }),
        section('Hero', { background: { gradient: { start: '#000', end: '#fff', angle: 45, startOpacity: 0.5 } } }),
        section('Hero', { background: 'linear-gradient(to bottom, #000, #333)' }),
        section('Hero', { background: '/img/hero.jpg' }),
        section('Hero', { background: { mode: 'video', video: { src: '/v/loop.mp4', poster: '/v/poster.jpg' } } }),
        section('Hero', { background: '/v/no-poster.webm' }),
        section('Hero', { background: { color: '#123', overlay: 0.4 } }),
        // `0` is an angle and a position, not "unset" — the prerender read it as 180deg and 100%
        section('Hero', {
          background: { mode: 'color', color: '#123', overlay: { enabled: true, gradient: { start: 'black', end: 'white', angle: 0, endPosition: 0 } } },
        }),
        section('Hero', { theme: 'dark', background: { mode: 'color', color: '#000' } }),
        section('Painted', { background: { mode: 'image', image: { src: '/img/self.jpg' } } }),
      ],
    },
    { route: '/posts', title: 'Posts', fetch: { query: 'posts', as: 'posts' }, sections: [section('Posts')] },
    {
      route: '/grid',
      title: 'Grid',
      sections: [section('Grid', {}, { subsections: [section('Hero', { title: 'One' }), section('Hero', { title: 'Two' })] })],
    },
    { route: '/docs', title: 'Docs', layout: { name: 'Docs' }, sections: [section('Hero')] },
    { route: '/peek', title: 'Peek', sections: [section('Peek')] },
    { route: '/who', title: 'Who', sections: [section('Who')] },
    { route: '/posts/:slug', isDynamic: true, paramName: 'slug', title: 'Post', sections: [section('PostTitle')] },
  ],
  notFound: { route: '/404', title: 'Not found', sections: [section('Active')] },
}

/** The transport the data step reads through: this site's one file. */
const files = {
  fetch: vi.fn(async (url) => ({
    ok: String(url).includes('/data/posts.json'),
    status: String(url).includes('/data/posts.json') ? 200 : 404,
    headers: { get: () => 'application/json' },
    json: async () => POSTS,
    text: async () => JSON.stringify(POSTS),
  })),
}

/**
 * The page at `route`, rendered by the browser and by the prerender, each over its own lane's boot.
 * `fetchedData` is what both lanes were handed — the data step's answers, as a page carries them.
 */
function bothWays(route, { fetchedData = [] } = {}) {
  const prerenderSite = initPrerender(structuredClone(site), foundation, []).activeWebsite
  hydrateDataStore(prerenderSite, fetchedData)
  prerenderSite.setActivePage(route)
  const prerender = renderToString(renderLayout(prerenderSite.getPage(route), prerenderSite))

  return { browser: browserFirst(route, fetchedData), prerender }
}

/** The browser's first render of the page at `route`, booted with the data the page carries. */
function browserFirst(route, fetchedData) {
  const browserSite = initUniweb({ content: { ...structuredClone(site), fetchedData }, foundation }).activeWebsite
  browserSite.setActivePage(route)
  return renderToString(h(Layout, { page: browserSite.getPage(route), website: browserSite }))
}

/**
 * The browser's first render at a `path` that names no page, or names a page served from elsewhere
 * that the host did not proxy: the boot makes the page the path names active, so none for the
 * first (`index.jsx`), and `PageRenderer` draws the site's not-found page through the same `Layout`.
 */
function browserNotFound(path, content = site) {
  const browserSite = initUniweb({ content: { ...structuredClone(content), fetchedData: [] }, foundation }).activeWebsite
  browserSite.setActivePage(path)
  return renderToString(h(Layout, { page: browserSite.getNotFoundPage(), website: browserSite }))
}

describe('a whole page renders the same in the browser as in the prerender', () => {
  it('⭐ backgrounds, every kind — color, gradient, image, video, overlays, a painted one', () => {
    const { browser, prerender } = bothWays('/')
    expect(prerender).toBe(browser)
  })

  it('an overlay at angle 0 and position 0 is drawn at 0 — not read as unset', () => {
    const { prerender } = bothWays('/')
    expect(prerender).toContain('linear-gradient(0deg, black 0%, white 0%)')
    expect(prerender).not.toContain('linear-gradient(180deg, black')
  })

  it('a video background is its poster in both, and a video with no poster draws nothing', () => {
    const { prerender } = bothWays('/')
    expect(prerender).toContain('background-image:url(/v/poster.jpg)')
    expect(prerender).not.toContain('<video')
    expect(prerender).toMatch(/<div class="background background--video" [^>]*><\/div>/)
  })

  it('the class a component passes for the background it paints is the layer’s, in both', () => {
    const { prerender } = bothWays('/')
    expect(prerender).toContain('class="background background--image painted"')
  })

  it('⭐ a section whose data the browser fetches renders its LOADING state in both', () => {
    const { browser, prerender } = bothWays('/posts')
    expect(prerender).toBe(browser)
    expect(prerender).toContain('Loading posts…')
  })

  it('the same section with its data in the page renders the data in both', async () => {
    const website = initPrerender(structuredClone(site), foundation, []).activeWebsite
    const fetchedData = await loadPageData({ website, route: '/posts', fetch: files.fetch })
    const { browser, prerender } = bothWays('/posts', { fetchedData })
    expect(prerender).toBe(browser)
    expect(prerender).toContain('<li>A</li><li>B</li>')
  })

  it('child sections, through each lane’s own child renderer', () => {
    const { browser, prerender } = bothWays('/grid')
    expect(prerender).toBe(browser)
    expect(prerender).toContain('One')
  })

  it('a foundation’s own layout, with its areas', () => {
    const { browser, prerender } = bothWays('/docs')
    expect(prerender).toBe(browser)
    expect(prerender).toMatch(/^<div class="docs">/)
  })
})

describe('⭐ one Website reused across requests renders each against what its page carries', () => {
  // A host renders request after request on one Website. The browser boots each page with the
  // data that page carries and nothing else, so the render must read that and nothing else.
  const SHELL = '<html><head></head><body><div id="root"></div></body></html>'
  const rootOf = (html) => html.match(/<div id="root">([\s\S]*)<\/div><\/body>/)[1]
  const reused = async () => {
    const website = initPrerender(structuredClone(site), foundation, []).activeWebsite
    const posts = await loadPageData({ website, route: '/posts', fetch: files.fetch })
    peekKey = deriveCacheKey(posts.find((e) => e.outcome === 'fetched').config)
    return { website, renderer: createPageRenderer({ website, shell: SHELL }), posts }
  }

  it('a section reading the store finds only its own page’s answers, and the browser agrees', async () => {
    const { renderer, posts } = await reused()
    renderer.render('/posts', { fetchedData: posts })
    const second = rootOf(renderer.render('/peek', { fetchedData: [] }).html)
    expect(second).toBe(browserFirst('/peek', []))
    expect(second).toContain('nothing held')
  })

  it('CONTROL — hydrated on top of the request before, it shows that request’s answers', async () => {
    const { website, renderer, posts } = await reused()
    hydrateDataStore(website, posts)
    renderer.render('/posts')
    const second = rootOf(renderer.render('/peek').html)
    expect(second).toContain('held 2')
    expect(second).not.toBe(browserFirst('/peek', []))
  })

  // The same post, edited between two requests: the second carries the new title.
  const edited = (posts) => posts.map((e) =>
    Array.isArray(e.data) ? { ...e, data: e.data.map((p) => (p.$name === 'a' ? { ...p, title: 'A, edited' } : p)) } : e)

  it('a parametric page is made from the answers its request carries, not an earlier one’s', async () => {
    const { renderer, posts } = await reused()
    expect(rootOf(renderer.render('/posts/a', { fetchedData: posts }).html)).toContain('<h2>A</h2>')
    const second = rootOf(renderer.render('/posts/a', { fetchedData: edited(posts) }).html)
    expect(second).toBe(browserFirst('/posts/a', edited(posts)))
    expect(second).toContain('<h2>A, edited</h2>')
  })

  it('CONTROL — emptying the store alone keeps the page the first request’s answers made', async () => {
    const { website, renderer, posts } = await reused()
    hydrateDataStore(website, posts)
    renderer.render('/posts/a')
    website.dataStore.clear()
    hydrateDataStore(website, edited(posts))
    const second = rootOf(renderer.render('/posts/a').html)
    expect(second).toContain('<h2>A</h2>')
    expect(second).not.toBe(browserFirst('/posts/a', edited(posts)))
  })

  it('⭐ a URL naming no page is the site’s not-found page, with the active page the browser starts with', async () => {
    // A request after another one: the not-found page has no route to be made active by, so it
    // renders with the page the Website started with, as the browser's first render does there.
    const { renderer } = await reused()
    renderer.render('/who', { fetchedData: [] })
    const r = renderer.render('/no-such-page', { fetchedData: [] })
    expect(r.outcome).toBe('notFound')
    expect(rootOf(r.html)).toBe(browserNotFound('/no-such-page'))
    expect(rootOf(r.html)).toContain('<p class="active">/</p>')
  })

  it('…and so is the not-found page handed in as a Page, after another request', async () => {
    const { website, renderer } = await reused()
    renderer.render('/who', { fetchedData: [] })
    const html = rootOf(renderer.render(website.getNotFoundPage(), { fetchedData: [] }).html)
    expect(html).toBe(browserNotFound('/no-such-page'))
    expect(html).toContain('<p class="active">/</p>')
  })

  it('…and on a site whose root parametric page matches `/404`, that page is not made active', () => {
    // The not-found page's own route, `/404`, names a page here: `/:slug` with slug `404`. A path
    // of two segments names nothing, so it is the not-found page that renders.
    const slugSite = { ...site, pages: [...site.pages, { route: '/:slug', isDynamic: true, paramName: 'slug', title: 'Slug', sections: [section('Hero')] }] }
    const website = initPrerender(structuredClone(slugSite), foundation, []).activeWebsite
    const r = createPageRenderer({ website, shell: SHELL }).render('/no/such-page', { fetchedData: [] })
    expect(r.outcome).toBe('notFound')
    expect(rootOf(r.html)).toBe(browserNotFound('/no/such-page', slugSite))
    expect(rootOf(r.html)).toContain('<p class="active">/</p>')
  })

  // A page served from elsewhere, which the host did not proxy: a request for it reached the renderer.
  const shopSite = { ...site, pages: [...site.pages, { route: '/shop', title: 'Shop', rewrite: 'https://shop.example.com/', sections: [section('Hero', { title: 'Shop' })] }] }

  it('⭐ a URL naming a page served from elsewhere is the not-found page, with that page active, as in the browser', async () => {
    // The browser's first load of it draws the not-found page, and its boot has made the page the URL
    // names active (`index.jsx`, `PageRenderer.jsx`). After another request, as a host renders.
    const website = initPrerender(structuredClone(shopSite), foundation, []).activeWebsite
    const renderer = createPageRenderer({ website, shell: SHELL })
    renderer.render('/who', { fetchedData: [] })
    const r = renderer.render('/shop', { fetchedData: [] })
    expect(r.outcome).toBe('notFound')
    expect(rootOf(r.html)).toBe(browserNotFound('/shop', shopSite))
    expect(rootOf(r.html)).toContain('<p class="active">/shop</p>')
    expect(rootOf(r.html)).not.toContain('<h1>Shop</h1>')
  })

  it('CONTROL — the not-found page handed in as a Page has the start page active, as the browser does not there', () => {
    // A Page carries no URL, so nothing names the page the browser has active at `/shop`.
    const website = initPrerender(structuredClone(shopSite), foundation, []).activeWebsite
    const html = rootOf(createPageRenderer({ website, shell: SHELL }).render(website.getNotFoundPage(), { fetchedData: [] }).html)
    expect(html).toContain('<p class="active">/</p>')
    expect(html).not.toBe(browserNotFound('/shop', shopSite))
  })

  it('CONTROL — rendered past the door after another page, the not-found page keeps that page active', async () => {
    // What `generate404Html` does: `renderPage` alone, which cannot make the not-found page active.
    const { website, renderer } = await reused()
    renderer.render('/who', { fetchedData: [] })
    expect(renderPage(website.getNotFoundPage(), website).renderedContent).toContain('<p class="active">/who</p>')
  })
})

describe('⭐ several graphs in one process — each door reads its own', () => {
  // `globalThis.uniweb` names one Uniweb, and every graph built points it at itself. A host holds
  // several in one isolate (sites, publishes, locales), so the render and the step point it back.
  const SHELL = '<html><head></head><body><div id="root"></div></body></html>'
  const rootOf = (html) => html.match(/<div id="root">([\s\S]*)<\/div><\/body>/)[1]
  const graph = (content = site, f = foundation) => initPrerender(structuredClone(content), f, []).activeWebsite
  const another = () => graph({ ...site, config: { ...site.config, name: 'Other' } })

  it('a section reaching the site through the global finds the graph it renders, not the newest', () => {
    const website = graph()
    another()
    const html = rootOf(createPageRenderer({ website, shell: SHELL }).render('/who', { fetchedData: [] }).html)
    expect(html).toBe(browserFirst('/who', []))
    expect(html).toContain('<p class="who">T</p>')
  })

  it('CONTROL — rendered past the door, it reads the newest graph', () => {
    const website = graph()
    another()
    website.setActivePage('/who')
    expect(renderToString(renderLayout(website.getPage('/who'), website))).toContain('<p class="who">Other</p>')
  })

  it('the data step asks what its own foundation declares, not the newest graph’s', async () => {
    const website = graph()
    // a graph whose foundation declares no data for `Posts`, built after it
    graph(site, { ...foundation, default: { ...foundation.default, meta: { ...foundation.default.meta, Posts: {} } } })
    expect(getComponentMeta('Posts').data).toBeUndefined()
    const asked = await loadPageData({ website, route: '/posts', fetch: files.fetch })
    expect(asked.some((e) => e.outcome === 'fetched' && e.config.as === 'posts')).toBe(true)
  })
})

describe('a video background starts once the browser has mounted it', () => {
  it('it plays, unless the visitor prefers reduced motion and there is a poster to keep', () => {
    expect(videoMoves({ src: '/v.mp4', poster: '/p.jpg' }, false)).toBe(true)
    expect(videoMoves({ src: '/v.mp4', poster: '/p.jpg' }, true)).toBe(false)
    // no poster to show instead: it plays, as it always has
    expect(videoMoves({ src: '/v.mp4' }, true)).toBe(true)
    expect(videoMoves({ poster: '/p.jpg' }, false)).toBe(false)
  })
})

describe('neither renderer draws a background of its own', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

  it('the browser’s Background draws the shared one, and reads no preference while rendering', () => {
    const src = read('../src/components/Background.jsx')
    expect(src).toMatch(/from '\.\.\/background\.js'/)
    expect(src).not.toMatch(/linear-gradient/)
    // the reduced-motion preference is read in an effect — `videoMoves(…, prefersReducedMotion())`
    expect(src).toMatch(/useEffect\(\(\) => \{\s*setMoving\(videoMoves\(video, prefersReducedMotion\(\)\)\)/)
  })

  it('the prerender’s renderBackground draws the shared one', () => {
    const src = read('../src/ssr-renderer.js')
    expect(src).toMatch(/import \{ Background \} from '\.\/background\.js'/)
    expect(src).not.toMatch(/linear-gradient/)
  })
})
