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
 * ⛔ Measured before 2026-10-25, the two disagreed on an overlay gradient at `angle: 0`, on a video
 * background (the prerender drew none), and on the `className` a component passes for a background
 * it paints itself.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { initPrerender, renderLayout } from '../src/ssr-renderer.js'
import { initUniweb } from '../src/setup.js'
import { videoMoves } from '../src/background.js'
import Layout from '../src/components/Layout.jsx'

const h = React.createElement

// Section types written as plain components, so what is under test is the runtime's two renderers.
const Hero = ({ params }) => h('h1', null, params.title || 'Hello')
// Paints its own background, where it wants it, the way kit's `SectionBackground` does.
const Painted = ({ block }) =>
  h('div', { className: 'relative' },
    h(globalThis.uniweb.backgroundRenderer, { ...block.background, className: 'painted' }),
    h('p', null, 'Self'))
const Grid = ({ block }) => h('div', { className: 'grid' }, h(globalThis.uniweb.childBlockRenderer, { from: block }))
const Nav = () => h('nav', null, 'Menu')
const Docs = ({ header, body, left, footer }) =>
  h('div', { className: 'docs' }, header, h('aside', null, left), h('main', null, body), footer)

const foundation = {
  default: {
    meta: { Hero: {}, Painted: { background: 'self' }, Grid: {}, Nav: {} },
    capabilities: { layouts: { Docs } },
  },
  Hero,
  Painted,
  Grid,
  Nav,
}

const section = (type, params = {}, more = {}) => ({ type, content: {}, params, ...more })

const site = {
  config: { name: 'T', defaultLanguage: 'en' },
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
    {
      route: '/grid',
      title: 'Grid',
      sections: [section('Grid', {}, { subsections: [section('Hero', { title: 'One' }), section('Hero', { title: 'Two' })] })],
    },
    { route: '/docs', title: 'Docs', layout: { name: 'Docs' }, sections: [section('Hero')] },
  ],
}

/** The page at `route`, rendered by the browser and by the prerender, each over its own lane's boot. */
function bothWays(route) {
  const prerenderSite = initPrerender(structuredClone(site), foundation, []).activeWebsite
  prerenderSite.setActivePage(route)
  const prerender = renderToString(renderLayout(prerenderSite.getPage(route), prerenderSite))

  const browserSite = initUniweb({ content: structuredClone(site), foundation }).activeWebsite
  browserSite.setActivePage(route)
  const browser = renderToString(h(Layout, { page: browserSite.getPage(route), website: browserSite }))

  return { browser, prerender }
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
