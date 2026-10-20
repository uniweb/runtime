/**
 * A section that stays in view — `sticky:`, one of a section's own settings (2026-10-19).
 *
 * No box a component draws can stick: `position: sticky` moves an element only within its
 * parent's box, and a component's markup sits in boxes as tall as itself. So the runtime makes
 * sticky the box that can — a body section's own wrapper; for any other area, the zone in the
 * built-in layout, the area wrapper in a foundation's — and both renderers make the same one.
 */
import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { initPrerender, renderLayout } from '../src/ssr-renderer.js'
import Layout from '../src/components/Layout.jsx'
import { stickyStyle, areaStickiness, layoutStickiness, sectionStickyStyle, STICKY_SECTION_TOP } from '../src/sticky.js'
import { areaWrapperStyle, resolveLayoutLayers } from '../src/area-wrappers.js'
import { canStick, clippingAncestor } from '../src/sticky-check.js'
import { measureStickyTop } from '../src/sticky-top.js'
import { ChildBlocks } from '../src/components/PageRenderer.jsx'

describe('the boxes, decided once (sticky.js)', () => {
  it('a sticky box keeps its layer, at the top unless a type says how far below', () => {
    expect(stickyStyle(null, 1)).toEqual({ position: 'sticky', top: '0px', zIndex: 1 })
    expect(stickyStyle('4rem')).toEqual({ position: 'sticky', top: '4rem' })
  })

  it('an area sticks when ANY of its sections does, at the first sticky one’s top', () => {
    expect(areaStickiness([{ sticky: false }, { sticky: true, stickyTop: '2rem' }])).toEqual({ top: '2rem' })
    expect(areaStickiness([{ sticky: false }])).toBeNull()
    expect(areaStickiness(undefined)).toBeNull()
  })

  it('a section’s wrapper sticks below what is stuck at the top, above the sections after it, top-aligned', () => {
    expect(sectionStickyStyle({ sticky: true, stickyTop: null })).toEqual({
      position: 'sticky', top: 'var(--uw-sticky-top, 0px)', zIndex: 1, alignSelf: 'start',
    })
    expect(STICKY_SECTION_TOP).toBe('var(--uw-sticky-top, 0px)')
    // A type's own `top` wins.
    expect(sectionStickyStyle({ sticky: true, stickyTop: '6rem' }).top).toBe('6rem')
    expect(sectionStickyStyle({ sticky: false })).toBeNull()
  })

  it('an area wrapper that sticks keeps its transition name and its layer, in place of `relative`', () => {
    const transitions = { header: 'uw-header' }
    expect(areaWrapperStyle('header', transitions, { header: 1 }, { top: '0px' })).toEqual({
      viewTransitionName: 'uw-header', position: 'sticky', top: '0px', zIndex: 1,
    })
    // CONTROL — not sticky: as before
    expect(areaWrapperStyle('header', transitions, { header: 1 })).toEqual({
      viewTransitionName: 'uw-header', position: 'relative', zIndex: 1,
    })
  })

  it('each area’s stickiness, read from its sections', () => {
    expect(layoutStickiness({ header: [{ sticky: true }], footer: [{ sticky: false }] })).toEqual({
      header: { top: '0px' }, footer: null,
    })
  })
})

describe('a sticky area is lifted above the areas that scroll under it (resolveLayoutLayers)', () => {
  const areas = ['header', 'footer']
  const stuck = { header: { top: '0px' }, footer: null }

  it('⭐ one above every area that does not stick — a tall footer cannot paint over a stuck header', () => {
    expect(resolveLayoutLayers(areas, undefined, stuck)).toEqual({ header: 2, footer: 1 })
    // CONTROL — nothing sticks: the areas are equal, as they always were
    expect(resolveLayoutLayers(areas, undefined, { header: null, footer: null })).toEqual({ header: 1, footer: 1 })
    expect(resolveLayoutLayers(areas)).toEqual({ header: 1, footer: 1 })
  })

  it('above the highest a layout gives the others', () => {
    expect(resolveLayoutLayers(['header', 'left', 'footer'], { left: 3 }, { header: { top: '0px' } })).toEqual({
      header: 4, left: 3, footer: 1,
    })
  })

  it('the layout’s `layers` still rank a sticky area they name, and `false` still opts out', () => {
    expect(resolveLayoutLayers(areas, { header: 1 }, stuck)).toEqual({ header: 1, footer: 1 })
    expect(resolveLayoutLayers(areas, { header: null }, stuck)).toEqual({ header: null, footer: 1 })
    expect(resolveLayoutLayers(areas, false, stuck)).toEqual({})
  })
})

describe('the dev warning’s rule — a sticky element needs room in the direction it sticks', () => {
  const prev = globalThis.getComputedStyle
  afterEach(() => { globalThis.getComputedStyle = prev })
  const box = ({ height, width = 1000, style = {}, parent = null }) => ({
    _style: { display: 'block', position: 'static', top: 'auto', bottom: 'auto', left: 'auto', right: 'auto', ...style },
    parentElement: parent,
    getBoundingClientRect: () => ({ height, width }),
  })
  const stuck = (el) => {
    globalThis.getComputedStyle = (node) => node._style
    return canStick(el)
  }

  it('cannot move when its parent is no taller — a component’s own `sticky top-0`', () => {
    const parent = box({ height: 65 })
    expect(stuck(box({ height: 65, style: { position: 'sticky', top: '0px' }, parent }))).toBe(false)
  })

  it('CONTROL — moves when its parent spans the page', () => {
    const parent = box({ height: 2000 })
    expect(stuck(box({ height: 65, style: { position: 'sticky', top: '0px' }, parent }))).toBe(true)
  })

  it('looks past a parent that draws no box (`display: contents`)', () => {
    const page = box({ height: 2000 })
    const contents = box({ height: 0, style: { display: 'contents' }, parent: page })
    expect(stuck(box({ height: 65, style: { position: 'sticky', top: '0px' }, parent: contents }))).toBe(true)
  })

  it('a table part sticks within its table, so it is left alone', () => {
    const row = box({ height: 40, style: { display: 'table-row' } })
    expect(stuck(box({ height: 40, style: { display: 'table-cell', position: 'sticky', top: '0px' }, parent: row }))).toBe(true)
  })

  it('one that sticks sideways needs room sideways', () => {
    const parent = box({ height: 40, width: 2000 })
    expect(stuck(box({ height: 40, width: 200, style: { position: 'sticky', left: '0px' }, parent }))).toBe(true)
  })
})

// ─── Real pages, rendered both ways ─────────────────────────────────────────

const Nav = () => React.createElement('nav', null, 'Menu')
const Hero = () => React.createElement('h1', null, 'Hello')
const SubNav = () => React.createElement('div', null, 'On this page')
const Credits = () => React.createElement('small', null, 'Credits')

/** A layout that places its header directly in its page column — and says whether it sticks. */
function Placed({ page, header, body, footer }) {
  return React.createElement('div', { 'data-layout': 'placed', 'data-sticky': String(page.isSticky('header')) }, header, React.createElement('main', null, body), footer)
}

function foundation({ meta = {}, layout = false } = {}) {
  const types = { Nav: {}, Hero: {}, SubNav: {}, Credits: {}, ...meta }
  return {
    default: {
      meta: types,
      capabilities: layout ? { layouts: { Placed }, defaultLayout: 'Placed' } : {},
      ...(layout ? { layoutMeta: { Placed: {} } } : {}),
    },
    Nav, Hero, SubNav, Credits, Placed,
  }
}

const section = (type, params = {}) => ({ type, content: {}, params })

function site({ header = {}, body = [section('Hero')] } = {}) {
  return {
    config: { name: 'T', defaultLanguage: 'en' },
    theme: {},
    layouts: {
      default: {
        header: { route: '/layout/header', sections: [section('Nav', header)] },
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
    browser: renderToStaticMarkup(React.createElement(Layout, { page, website })),
    prerender: renderToStaticMarkup(renderLayout(page, website)),
  }
}

const STICKY_ZONE = '<header style="position:sticky;top:0px;z-index:2" data-uw-sticky="area">'

describe('the built-in layout: a sticky header’s zone is the box that sticks', () => {
  it('⭐ the author’s `sticky: true` — the zone sticks, the same in both renderers', () => {
    const { browser, prerender } = bothWays(site({ header: { sticky: true } }))
    expect(prerender).toBe(browser)
    expect(prerender).toContain(STICKY_ZONE)
    // The area wrapper inside it carries the same layer; the section's own wrapper does not stick.
    expect(prerender).toMatch(/<header style="position:sticky;top:0px;z-index:2" data-uw-sticky="area"><div style="view-transition-name:uw-header;position:relative;z-index:2"><section id="section-[^"]*" class="">/)
    // ⭐ The footer stays on the layer below it, so it scrolls under the stuck header.
    expect(prerender).toContain('<footer><div style="view-transition-name:uw-footer;position:relative;z-index:1">')
  })

  it('its type’s default, and the author’s `false` over it', () => {
    const typed = { meta: { Nav: { sticky: { default: true } } } }
    // The prerender knows a type's default before it decides the layers, as the browser does.
    const byType = bothWays(site(), typed)
    expect(byType.prerender).toBe(byType.browser)
    expect(byType.prerender).toContain(STICKY_ZONE)
    const { browser, prerender } = bothWays(site({ header: { sticky: false } }), typed)
    expect(prerender).toBe(browser)
    expect(prerender).not.toContain('position:sticky')
  })

  it('a type’s `top`, for one that sits below another', () => {
    const { prerender } = bothWays(site(), { meta: { Nav: { sticky: { default: true, top: '2rem' } } } })
    expect(prerender).toContain('<header style="position:sticky;top:2rem;z-index:2" data-uw-sticky="area">')
  })

  it('CONTROL — no setting, no sticky box', () => {
    const { browser, prerender } = bothWays(site())
    expect(prerender).toBe(browser)
    expect(prerender).toContain('<header><div style="view-transition-name:uw-header;position:relative;z-index:1">')
    expect(prerender).not.toContain('position:sticky')
  })
})

describe('in the body: the section’s own wrapper sticks', () => {
  it('a sticky body section — its wrapper, above the sections after it, the same both ways', () => {
    const body = [section('Hero'), section('SubNav', { sticky: true }), section('Hero')]
    const { browser, prerender } = bothWays(site({ body }))
    expect(prerender).toBe(browser)
    expect(prerender).toMatch(/<section id="section-[^"]*" style="position:sticky;top:var\(--uw-sticky-top, 0px\);z-index:1;align-self:start"[^>]*data-uw-sticky="section"[^>]*><div>On this page<\/div><\/section>/)
    expect(prerender).toContain('<header><div') // the header does not
  })
})

describe('a foundation’s layout: the area wrapper sticks, and the layout can ask', () => {
  it('⭐ an area placed in the layout’s column — its wrapper is sticky, in place of `relative`', () => {
    const { browser, prerender } = bothWays(site({ header: { sticky: true } }), { layout: true })
    expect(prerender).toBe(browser)
    expect(prerender).toContain('data-sticky="true"')
    expect(prerender).toContain('<div style="view-transition-name:uw-header;position:sticky;top:0px;z-index:2" data-uw-sticky="area">')
    expect(prerender).toContain('<div style="view-transition-name:uw-footer;position:relative;z-index:1">')
  })

  it('CONTROL — not sticky, the layout is told so', () => {
    const { prerender } = bothWays(site(), { layout: true })
    expect(prerender).toContain('data-sticky="false"')
    expect(prerender).not.toContain('position:sticky')
  })
})

describe('a child section: its own wrapper sticks, within the box its parent places it in', () => {
  const Panel = () => React.createElement('aside', null, 'Contents')
  function childOf(params) {
    const content = site({ body: [{ type: 'Hero', content: {}, params: {}, subsections: [{ type: 'Panel', content: {}, params }] }] })
    const fdn = foundation({ meta: { Panel: {} } })
    fdn.Panel = Panel
    fdn.default.meta.Panel = {}
    const website = initPrerender(structuredClone(content), fdn, []).activeWebsite
    const parent = website.getPage('/').getBodyBlocks()[0]
    return parent.childBlocks?.[0] || null
  }

  it('⭐ rendered as a section (`wrapAs`, as ChildGrid does), the same both ways', () => {
    const child = childOf({ sticky: true })
    expect(child, 'the fixture builds a child section').toBeTruthy()
    const browser = renderToStaticMarkup(React.createElement(ChildBlocks, { blocks: [child], wrapAs: 'div' }))
    const prerender = renderToStaticMarkup(React.createElement(React.Fragment, null, globalThis.uniweb.childBlockRenderer({ blocks: [child], wrapAs: 'div' })))
    expect(prerender).toBe(browser)
    expect(prerender).toMatch(/^<div id="section-[^"]*" style="position:sticky;top:var\(--uw-sticky-top, 0px\);z-index:1;align-self:start"[^>]*data-uw-sticky="child"/)
  })

  it('rendered bare there is no box of the runtime’s, so the component reads `block.sticky` itself', () => {
    const child = childOf({ sticky: true })
    const bare = renderToStaticMarkup(React.createElement(ChildBlocks, { blocks: [child] }))
    expect(bare).toBe('<aside>Contents</aside>')
    expect(child.sticky).toBe(true)
  })

  it('CONTROL — a child that does not stick', () => {
    const child = childOf({})
    const html = renderToStaticMarkup(React.createElement(ChildBlocks, { blocks: [child], wrapAs: 'div' }))
    expect(html).not.toContain('sticky')
  })
})

describe('--uw-sticky-top: how far down the stuck chrome over the body reaches', () => {
  const rect = (top, height, left = 0, width = 1000) => ({ top, height, bottom: top + height, left, width, right: left + width })
  // A page of boxes in document order: each knows its place, its rect and its computed `top`.
  function page({ header, footer, rail, body }) {
    const order = ['header', 'rail', 'body', 'footer']
    const make = (name, spec) => spec && {
      name,
      top: spec.top,
      getBoundingClientRect: () => spec.rect,
      contains: () => false,
      compareDocumentPosition: (other) => (order.indexOf(other.name) > order.indexOf(name) ? 4 : 2),
    }
    const boxes = { header: make('header', header), rail: make('rail', rail), footer: make('footer', footer) }
    const doc = {
      querySelectorAll: () => Object.values(boxes).filter(Boolean),
      defaultView: { getComputedStyle: (node) => ({ top: node.top ?? '0px' }) },
    }
    return { doc, body: make('body', body) }
  }

  it('⭐ a header over the body: its top and its height', () => {
    const { doc, body } = page({ header: { rect: rect(0, 64) }, body: { rect: rect(64, 2000) } })
    expect(measureStickyTop(doc, body)).toBe(64)
  })

  it('a footer that sticks follows the body, and a rail stuck beside it covers no content', () => {
    const { doc, body } = page({
      rail: { rect: rect(64, 900, 0, 240) },
      body: { rect: rect(64, 2000, 240, 760) },
      footer: { rect: rect(2064, 300) },
    })
    expect(measureStickyTop(doc, body)).toBe(0)
  })

  it('a header that sticks below the top reaches its top plus its height', () => {
    const { doc, body } = page({ header: { rect: rect(0, 64), top: '32px' }, body: { rect: rect(64, 2000) } })
    expect(measureStickyTop(doc, body)).toBe(96)
  })

  it('no body section, nothing to measure', () => {
    const { doc } = page({ header: { rect: rect(0, 64) } })
    expect(measureStickyTop(doc, null)).toBe(0)
  })
})

describe('the dev warning’s second rule — a box that clips without scrolling', () => {
  const prev = globalThis.getComputedStyle
  afterEach(() => { globalThis.getComputedStyle = prev })
  const node = (style, parent = null, scroll = { scrollHeight: 100, clientHeight: 100 }) => ({
    _style: { overflowX: 'visible', overflowY: 'visible', ...style }, parentElement: parent, ownerDocument: null, ...scroll,
  })
  const clip = (el) => {
    globalThis.getComputedStyle = (n) => n._style
    return clippingAncestor(el)
  }

  it('`overflow: hidden` — the element sticks to the box, which never scrolls', () => {
    const box = node({ overflowX: 'hidden', overflowY: 'hidden' })
    expect(clip(node({}, box))).toBe(box)
  })

  it('`overflow-x: hidden` alone — it makes the box a vertical scroller too, one that does not scroll', () => {
    const box = node({ overflowX: 'hidden', overflowY: 'auto' })
    expect(clip(node({}, box))).toBe(box)
  })

  it('CONTROL — a box that really scrolls is the element’s scroller, and `overflow: clip` clips without one', () => {
    const scroller = node({ overflowY: 'auto' }, null, { scrollHeight: 3000, clientHeight: 800 })
    expect(clip(node({}, scroller))).toBeNull()
    const clipped = node({ overflowX: 'clip', overflowY: 'clip' })
    expect(clip(node({}, clipped))).toBeNull()
  })
})
