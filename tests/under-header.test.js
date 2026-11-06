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
import { createPageRenderer } from '../src/page-renderer.js'
import { headerOutOfFlow } from '../src/sticky-check.js'

const Nav = () => React.createElement('nav', null, 'Menu')
const Hero = () => React.createElement('h1', null, 'Hello')
const Text = () => React.createElement('p', null, 'Text')
const Credits = () => React.createElement('small', null, 'Credits')

/** A layout that places its header directly in its page column. */
function Placed({ header, body, footer }) {
  return React.createElement('div', { 'data-layout': 'placed' }, header, React.createElement('main', null, body), footer)
}

function foundation({ meta = {}, layout = false, transitions } = {}) {
  return {
    default: {
      meta: { Nav: { sticky: true, height: '4rem' }, Hero: { underHeader: true }, Text: {}, Credits: {}, ...meta },
      capabilities: layout ? { layouts: { Placed }, defaultLayout: 'Placed' } : {},
      ...(layout ? { layoutMeta: { Placed: transitions ? { transitions } : {} } } : {}),
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

describe('a header the layout asks to name, over the opening section', () => {
  it('⭐ is left unnamed there: a box with no height is captured as nothing — the same in both renderers', () => {
    const { browser, prerender } = bothWays(site(), { layout: true, transitions: { header: 'site-header' } })
    expect(prerender).toBe(browser)
    expect(prerender).toContain('data-uw-header="over"')
    expect(prerender).not.toContain('view-transition-name')
  })

  it('CONTROL — on a page with nothing under it, the header has the name the layout asked for', () => {
    const { browser, prerender } = bothWays(site([section('Text')]), { layout: true, transitions: { header: 'site-header' } })
    expect(prerender).toBe(browser)
    expect(prerender).toContain('view-transition-name:site-header')
    expect(prerender).not.toContain('data-uw-header')
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

describe('uniweb dev names a header over the opening section whose bar is out of the flow', () => {
  const rect = (top, height) => ({ top, height, bottom: top + height, left: 0, width: 1000, right: 1000 })
  function doc({ barInFlow }) {
    // The bar the header draws, and the section's wrapper around it, the box's child.
    const bar = { getBoundingClientRect: () => rect(0, 65) }
    const wrapper = { getBoundingClientRect: () => rect(0, barInFlow ? 65 : 0) }
    const box = {
      children: [wrapper],
      querySelectorAll: () => [wrapper, bar],
      getAttribute: (name) => (name === 'data-uw-header' ? 'over' : null),
      getBoundingClientRect: () => rect(0, 0),
    }
    return { querySelector: (selector) => (selector.includes('over') ? box : null) }
  }

  it('⭐ a bar made fixed or absolute: what the header holds measures 0px, though it is drawn', () => {
    expect(headerOutOfFlow(doc({ barInFlow: false }))).toBeTruthy()
  })

  it('CONTROL — a bar in the flow is measured, and named nowhere', () => {
    expect(headerOutOfFlow(doc({ barInFlow: true }))).toBeNull()
  })

  it('CONTROL — a page with no header over its opening section', () => {
    expect(headerOutOfFlow({ querySelector: () => null })).toBeNull()
  })
})

describe('the header and the runtime read the same page', () => {
  // A header that says what it reads on its next block, the page's opening section.
  const Reader = ({ block }) => React.createElement('nav', null, `under:${Boolean(block.getNextBlockInfo()?.underHeader)}`)
  const SHELL = '<html><head></head><body><div id="root"></div></body></html>'

  function reader() {
    const f = foundation({ meta: { Reader: { sticky: true, height: '4rem' } } })
    f.Reader = Reader
    const content = site()
    content.layouts.default.header.sections = [section('Reader')]
    content.pages.push({ route: '/404', title: 'Not found', sections: [section('Text')] })
    const website = initPrerender(structuredClone(content), f, []).activeWebsite
    return { website, renderer: createPageRenderer({ website, shell: SHELL }) }
  }

  it('⭐ on the not-found page, after a page that opens under the header, the header reads the not-found page', () => {
    // Home opens with a Hero under the header; a missing page opens with a Text. ⛔ Until 2026-11-06
    // the not-found page rendered with another page active, so the header read that page's Hero and
    // painted itself see-through while the runtime kept it in the flow.
    const { renderer } = reader()
    const home = renderer.render('/', { fetchedData: [] }).html
    expect(home).toContain('under:true')
    expect(home).toContain('data-uw-header="over"')
    const missing = renderer.render('/no-such-page', { fetchedData: [] })
    expect(missing.outcome).toBe('notFound')
    expect(missing.html).toContain('under:false')
    expect(missing.html).not.toContain('data-uw-header')
  })
})
