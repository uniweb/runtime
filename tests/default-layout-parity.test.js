/**
 * ⭐ THE BUILT-IN LAYOUT IS ONE LAYOUT, IN THE BROWSER AND IN THE PRERENDER.
 *
 * The runtime renders a page twice over its life: the prerender (`ssr-renderer.js`, behind
 * `uniweb build` and a host's prerender) writes the HTML a visit's first paint and a crawler get,
 * and the browser (`components/Layout.jsx`) renders over it — replacing it, not hydrating it. So
 * any difference between the two is a visible change at boot.
 *
 * ⛔ Until 2026-10-07 each wrote its own built-in layout, and the prerender's had no full-height
 * column: a short page's footer sat right under its content, then jumped to the bottom when the
 * browser took over. Now both render `default-layout.js`; this renders one real page both ways and
 * asks for the same markup.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { initPrerender, renderLayout } from '../src/ssr-renderer.js'
import Layout from '../src/components/Layout.jsx'

const Nav = () => React.createElement('nav', null, 'Menu')
const Hero = () => React.createElement('h1', null, 'Hello')
const Notes = () => React.createElement('aside', null, 'Notes')
const Credits = () => React.createElement('small', null, 'Credits')

/** A foundation with section types and no layout of its own — every page gets the built-in one. */
function foundation({ viewTransitions } = {}) {
  return {
    default: { meta: { Nav: {}, Hero: {}, Notes: {}, Credits: {} }, capabilities: viewTransitions === false ? { viewTransitions: false } : {} },
    Nav,
    Hero,
    Notes,
    Credits,
  }
}

const section = (type) => ({ type, content: {}, params: {} })

const site = {
  config: { name: 'T', defaultLanguage: 'en' },
  theme: {},
  layouts: {
    default: {
      header: { route: '/layout/header', sections: [section('Nav')] },
      footer: { route: '/layout/footer', sections: [section('Credits')] },
      // an area the built-in layout does not draw, in either renderer
      left: { route: '/layout/left', sections: [section('Notes')] },
    },
  },
  pages: [
    { route: '/', isIndex: true, title: 'Home', sections: [section('Hero')] },
    { route: '/quiet', title: 'Quiet', layout: { hide: ['header'] }, sections: [section('Hero')] },
  ],
}

/** The page at `route`, rendered by the browser's Layout and by the prerender's. */
function bothWays(route, opts) {
  const website = initPrerender(structuredClone(site), foundation(opts), []).activeWebsite
  const page = website.getPage(route)
  return {
    browser: renderToStaticMarkup(React.createElement(Layout, { page, website })),
    prerender: renderToStaticMarkup(renderLayout(page, website)),
  }
}

describe('the built-in layout renders the same page both ways', () => {
  it('⭐ header, body and footer in one full-height column — the same markup', () => {
    const { browser, prerender } = bothWays('/')
    expect(prerender).toBe(browser)
    expect(prerender).toMatch(/^<div style="display:flex;flex-direction:column;min-height:100vh">/)
    expect(prerender).toMatch(/<main style="flex:1">/)
    expect(prerender).toMatch(/<header>.*Menu.*<\/header>/)
    expect(prerender).toMatch(/<footer>.*Credits.*<\/footer>/)
  })

  it('draws no area but the header and the footer — `left` is passed, and not drawn', () => {
    const { browser, prerender } = bothWays('/')
    expect(browser).not.toContain('Notes')
    expect(prerender).not.toContain('Notes')
  })

  it('the same with view transitions off, when no area is wrapped', () => {
    const { browser, prerender } = bothWays('/', { viewTransitions: false })
    expect(prerender).toBe(browser)
    expect(prerender).not.toContain('view-transition-name')
  })

  it('the same when the page hides an area', () => {
    const { browser, prerender } = bothWays('/quiet')
    expect(prerender).toBe(browser)
    expect(prerender).not.toContain('<header>')
  })
})

describe('neither renderer writes a layout of its own', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

  for (const file of ['../src/components/Layout.jsx', '../src/ssr-renderer.js']) {
    it(`${file} renders the shared DefaultLayout and defines none`, () => {
      const src = read(file)
      expect(src).toMatch(/import \{ DefaultLayout \} from '\.{1,2}\/default-layout\.js'/)
      expect(src).not.toMatch(/function DefaultLayout\b/)
      // A hand-built column is the copy this replaced.
      expect(src).not.toMatch(/flexDirection:\s*'column'/)
    })
  }
})
