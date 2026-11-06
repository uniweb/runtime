/**
 * The header laid over a page's opening section — `underHeader`, a setting of the section
 * (2026-11-06, `src/under-header.js`).
 *
 * A page that opens with a section under the header has the header's box take no room in the flow,
 * in the built-in layout's zone or a foundation layout's area wrapper, and both renderers build the
 * same page. The opening section clears the header by `--uw-header-height`: the header type's
 * `height` on the first paint, then what the browser measures.
 */
import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { initPrerender, renderLayout } from '../src/ssr-renderer.js'
import Layout from '../src/components/Layout.jsx'
import { headerOverlay, overlayBoxProps, underHeaderProps } from '../src/under-header.js'
import { measureStickyTop, measureHeaderOverlay } from '../src/sticky-top.js'

const Nav = () => React.createElement('nav', null, 'Menu')
const Hero = () => React.createElement('h1', null, 'Hello')
const Text = () => React.createElement('p', null, 'Text')
const Credits = () => React.createElement('small', null, 'Credits')

/** A layout that places its header directly in its page column. */
function Placed({ header, body, footer }) {
  return React.createElement('div', { 'data-layout': 'placed' }, header, React.createElement('main', null, body), footer)
}

function foundation({ meta = {}, layout = false } = {}) {
  return {
    default: {
      meta: { Nav: { sticky: true, height: '4rem' }, Hero: { underHeader: true }, Text: {}, Credits: {}, ...meta },
      capabilities: layout ? { layouts: { Placed }, defaultLayout: 'Placed' } : {},
      ...(layout ? { layoutMeta: { Placed: {} } } : {}),
    },
    Nav, Hero, Text, Credits, Placed,
  }
}

const section = (type, params = {}) => ({ type, content: {}, params })

function site(body = [section('Hero'), section('Text')]) {
  return {
    config: { name: 'T', defaultLanguage: 'en' },
    theme: {},
    layouts: {
      default: {
        header: { route: '/layout/header', sections: [section('Nav')] },
        footer: { route: '/layout/footer', sections: [section('Credits')] },
      },
    },
    pages: [{ route: '/', isIndex: true, title: 'Home', sections: body }],
  }
}

function bothWays(content, opts) {
  const website = initPrerender(structuredClone(content), foundation(opts), []).activeWebsite
  const page = website.getPage('/')
  return {
    page,
    browser: renderToStaticMarkup(React.createElement(Layout, { page, website })),
    prerender: renderToStaticMarkup(renderLayout(page, website)),
  }
}

describe('the built-in layout: the header’s zone over the opening section', () => {
  it('⭐ takes no room, keeps its stickiness, and says so — the same in both renderers', () => {
    const { browser, prerender } = bothWays(site())
    expect(prerender).toBe(browser)
    expect(prerender).toContain('<header style="position:sticky;top:0px;z-index:2;height:0;min-height:0" data-uw-sticky="area" data-uw-header="over">')
  })

  it('⭐ the opening section clears it by --uw-header-height: the declared height until measured', () => {
    const { prerender } = bothWays(site())
    expect(prerender).toContain('<section id="section-0" style="scroll-margin-top:var(--uw-sticky-top, 0px);--uw-header-height:var(--uw-header-measured, 4rem)" class="" data-uw-under-header=""><h1>Hello</h1>')
    // only the opening section
    expect(prerender.match(/data-uw-under-header/g)).toHaveLength(1)
  })

  it("the author's `underHeader: false` keeps the header above the section", () => {
    const { browser, prerender } = bothWays(site([section('Hero', { underHeader: false }), section('Text')]))
    expect(prerender).toBe(browser)
    expect(prerender).not.toContain('data-uw-header')
    expect(prerender).not.toContain('--uw-header-height')
  })

  it('CONTROL — a page that opens with a section not under the header, and one under it further down', () => {
    const { prerender } = bothWays(site([section('Text'), section('Hero')]))
    expect(prerender).not.toContain('data-uw-header')
    expect(prerender).not.toContain('data-uw-under-header')
  })

  it('a header type with no `height` is cleared from 0px until the browser measures it', () => {
    const { prerender } = bothWays(site(), { meta: { Nav: { sticky: true } } })
    expect(prerender).toContain('--uw-header-height:var(--uw-header-measured, 0px)')
  })

  it('a header that does not stick lies over the section too', () => {
    const { prerender } = bothWays(site(), { meta: { Nav: { height: '4rem' } } })
    expect(prerender).toContain('<header style="height:0;min-height:0" data-uw-header="over">')
  })
})

describe("a foundation's layout: the header's area wrapper over the opening section", () => {
  it('⭐ is the box that takes no room, the same in both renderers', () => {
    const { browser, prerender } = bothWays(site(), { layout: true })
    expect(prerender).toBe(browser)
    expect(prerender).toContain('data-uw-sticky="area" data-uw-header="over"')
    expect(prerender).toMatch(/<div style="position:sticky;top:0px;z-index:2;height:0;min-height:0"/)
  })
})

describe('headerOverlay — the page’s decision', () => {
  it('sums the heights of a header with several sections', () => {
    const page = {
      getBodyBlocks: () => [{ underHeader: true }],
      getLayoutAreas: () => ({ header: [{ height: '2rem' }, { height: '4rem' }, {}] }),
    }
    expect(headerOverlay(page)).toEqual({ height: 'calc(2rem + 4rem)' })
  })

  it('CONTROL — no header area, no overlay', () => {
    expect(headerOverlay({ getBodyBlocks: () => [{ underHeader: true }], getLayoutAreas: () => ({}) })).toBeNull()
  })

  it('keeps what a box already has', () => {
    expect(overlayBoxProps({ style: { zIndex: 2 }, 'data-uw-sticky': 'area' })).toEqual({
      style: { zIndex: 2, height: 0, minHeight: 0 }, 'data-uw-sticky': 'area', 'data-uw-header': 'over',
    })
    expect(underHeaderProps({ height: '4rem' }).style).toEqual({ '--uw-header-height': 'var(--uw-header-measured, 4rem)' })
  })
})

describe('the measurement: a header over the opening section reaches what it holds', () => {
  const rect = (top, height, left = 0, width = 1000) => ({ top, height, bottom: top + height, left, width, right: left + width })
  function page({ overHeader }) {
    const child = { getBoundingClientRect: () => rect(0, 65) }
    const header = {
      name: 'header',
      top: '0px',
      children: [child],
      getAttribute: (name) => (name === 'data-uw-header' && overHeader ? 'over' : null),
      getBoundingClientRect: () => rect(0, overHeader ? 0 : 65),
      contains: () => false,
      compareDocumentPosition: () => 4,
    }
    const body = { name: 'body', getBoundingClientRect: () => rect(0, 2000) }
    const doc = {
      querySelectorAll: () => [header],
      querySelector: (selector) => (selector.includes('over') && overHeader ? header : null),
      defaultView: { getComputedStyle: (node) => ({ top: node.top }) },
    }
    return { doc, body }
  }

  it('⭐ --uw-sticky-top is the header’s height, though its box takes no room', () => {
    const { doc, body } = page({ overHeader: true })
    expect(measureStickyTop(doc, body)).toBe(65)
    expect(measureHeaderOverlay(doc)).toBe(65)
  })

  it('CONTROL — a header in the flow is measured by its own box, and no overlay is measured', () => {
    const { doc, body } = page({ overHeader: false })
    expect(measureStickyTop(doc, body)).toBe(65)
    expect(measureHeaderOverlay(doc)).toBeNull()
  })
})
