/**
 * ⭐ A PAGE'S SECTION OVERRIDES ARE PART OF ITS FIRST RENDER, IN THE BROWSER AS IN THE PRERENDER.
 *
 * The page stylesheet, `<style id="uniweb-page-overrides">`, holds each section's component vars
 * (its type's `meta.js` `vars:` defaults, with the section's own `vars:` over them) and its `theme:`
 * map. A section's component vars are known once its component is (`Block#initComponent`), so the
 * stylesheet is built from blocks set up first, whichever renderer asks (`page-overrides.js`).
 *
 * ⛔ Until 2026-11-12 the browser built it before `Layout` set its page's blocks up, and kept it until
 * the page changed. A page's first render in the browser had no component vars: every page under
 * `uniweb dev`, every page reached by a click, and the page a visit started on when a section's
 * `theme:` map left the stylesheet something else to hold, since the browser then wrote its own
 * over the prerendered one. Measured under `uniweb dev` on a site's hero (`--visual-strength`
 * empty on the first load, `0.6` after a click away and back).
 *
 * The browser's half is rendered here as it ships, through `PageRenderer` under a router;
 * `@uniweb/theming` is wrapped only to read the stylesheet that render built, since the browser
 * writes it from an effect, which a render to a string never runs.
 */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@uniweb/theming', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, buildSectionOverrides: vi.fn(real.buildSectionOverrides) }
})

const { buildSectionOverrides } = await import('@uniweb/theming')
const { initUniweb } = await import('../src/setup.js')
const { initPrerender, renderPage } = await import('../src/ssr-renderer.js')
const { default: PageRenderer } = await import('../src/components/PageRenderer.jsx')
const { pageOverrideCSS, writePageOverrides, PAGE_OVERRIDES_ID } = await import('../src/page-overrides.js')

const h = React.createElement

const Probe = () => h('div', { className: 'probe' }, 'probe')
const Plain = () => h('p', null, 'plain')
const Holder = ({ block }) => h('div', { className: 'holder' }, h(globalThis.uniweb.childBlockRenderer, { from: block }))

const foundation = {
  default: {
    meta: {
      Probe: { vars: { 'probe-size': { default: '1px' } } },
      Plain: {},
      Holder: {},
    },
  },
  Probe,
  Plain,
  Holder,
}

const section = (type, params = {}, more = {}) => ({ type, content: {}, params, ...more })

const site = {
  config: { name: 'T', defaultLanguage: 'en' },
  theme: {},
  pages: [
    {
      route: '/',
      isIndex: true,
      title: 'Home',
      sections: [
        section('Probe', { vars: { 'probe-size': '2px' } }, { stableId: 'set' }),
        section('Probe', {}, { stableId: 'default' }),
        // A section's `theme:` map: the stylesheet holds something besides the component vars.
        section('Plain', { theme: { section: 'neutral-100' } }, { stableId: 'pinned' }),
      ],
    },
    { route: '/about', title: 'About', sections: [section('Probe', { vars: { 'probe-size': '4px' } }, { stableId: 'about' })] },
    {
      route: '/nested',
      title: 'Nested',
      sections: [
        section('Holder', {}, {
          stableId: 'holder',
          subsections: [section('Probe', { vars: { 'probe-size': '3px' } }, { stableId: 'child' })],
        }),
      ],
    },
  ],
}

/** A rule of the stylesheet for `#section-<id>` declaring `--<name>: <value>`. */
const declares = (css, id, name, value) =>
  new RegExp(`(^|\\n)#section-${id} \\{[^}]*--${name}: ${value.replace('.', '\\.')};`).test(css)

/** The browser, booted as a page loads: nothing rendered yet, no block set up. */
function bootBrowser() {
  return initUniweb({ content: { ...structuredClone(site), fetchedData: [] }, foundation }).activeWebsite
}

/** The stylesheet the browser's render of `path` built, through `PageRenderer`, as it ships. */
function browserRender(path) {
  buildSectionOverrides.mockClear()
  renderToString(h(MemoryRouter, { initialEntries: [path] }, h(PageRenderer)))
  const results = buildSectionOverrides.mock.results
  return results.length ? results[results.length - 1].value : ''
}

describe('the browser builds a page’s overrides with its component vars on its first render', () => {
  it('⭐ the page a visit starts on: each section’s value, and the type’s default where it sets none', () => {
    bootBrowser()
    const css = browserRender('/')
    expect(declares(css, 'set', 'probe-size', '2px')).toBe(true)
    expect(declares(css, 'default', 'probe-size', '1px')).toBe(true)
  })

  it('⭐ beside a section’s theme map, so the browser never writes a stylesheet without them over the prerendered one', () => {
    bootBrowser()
    const css = browserRender('/')
    expect(css).toMatch(/#section-pinned \{[^}]*--section:/)
    expect(declares(css, 'set', 'probe-size', '2px')).toBe(true)
  })

  it('⭐ a page reached by a click, rendered first in the browser', () => {
    bootBrowser()
    browserRender('/')
    const css = browserRender('/about')
    expect(declares(css, 'about', 'probe-size', '4px')).toBe(true)
  })

  it('a section nested in another', () => {
    bootBrowser()
    const css = browserRender('/nested')
    expect(declares(css, 'child', 'probe-size', '3px')).toBe(true)
  })

  it('the stylesheet the browser builds is the one the prerender writes, page by page', () => {
    for (const route of ['/', '/about', '/nested']) {
      bootBrowser()
      const browser = browserRender(route)

      const prerenderSite = initPrerender(structuredClone(site), foundation, []).activeWebsite
      prerenderSite.setActivePage(route)
      const { sectionOverrideCSS } = renderPage(prerenderSite.getPage(route), prerenderSite)

      expect(browser).not.toBe('')
      expect(browser).toBe(sectionOverrideCSS)
    }
  })
})

describe('pageOverrideCSS — one build, whichever renderer asks first', () => {
  it('sets up each block it reads, child sections included, before it builds', () => {
    const page = bootBrowser().getPage('/nested')
    const [holder] = page.getBodyBlocks()
    expect(holder.childBlocks[0].componentVars).toBe(null)

    const css = pageOverrideCSS(page, {})
    expect(holder.childBlocks[0].componentVars).toEqual({ 'probe-size': '3px' })
    expect(declares(css, 'child', 'probe-size', '3px')).toBe(true)
  })

  it('is empty for a page with nothing to override', () => {
    const website = initUniweb({
      content: { ...structuredClone(site), pages: [{ route: '/', isIndex: true, title: 'Home', sections: [section('Plain')] }], fetchedData: [] },
      foundation,
    }).activeWebsite
    expect(pageOverrideCSS(website.getPage('/'), {})).toBe('')
  })
})

/**
 * A `<head>` as the browser's commit meets it: the theme's stylesheet, maybe the overrides the
 * prerender wrote, and something after them. Only what `writePageOverrides` touches.
 */
function stubDocument({ prerendered = null, theme = true } = {}) {
  const children = []
  const head = {
    children,
    appendChild(el) {
      el.parentNode = head
      children.push(el)
      return el
    },
    insertBefore(el, ref) {
      el.parentNode = head
      const at = ref ? children.indexOf(ref) : -1
      if (at < 0) children.push(el)
      else children.splice(at, 0, el)
      return el
    },
  }
  const element = (id, textContent = '') => ({
    id,
    textContent,
    parentNode: null,
    get nextSibling() {
      return children[children.indexOf(this) + 1] || null
    },
    remove() {
      const at = children.indexOf(this)
      if (at >= 0) children.splice(at, 1)
      this.parentNode = null
    },
  })
  if (theme) head.appendChild(element('uniweb-theme', ':root {}'))
  if (prerendered != null) head.appendChild(element(PAGE_OVERRIDES_ID, prerendered))
  head.appendChild(element('later'))
  return {
    head,
    getElementById: (id) => children.find((c) => c.id === id) || null,
    createElement: () => element(''),
    ids: () => children.map((c) => c.id),
  }
}

describe('writePageOverrides — the browser takes over the prerendered stylesheet', () => {
  it('⭐ writes into the element the prerender wrote, and makes no second one', () => {
    const doc = stubDocument({ prerendered: '\n#section-a { --x: 1px; }\n' })
    writePageOverrides(doc, '#section-b { --x: 2px; }\n')
    expect(doc.ids()).toEqual(['uniweb-theme', PAGE_OVERRIDES_ID, 'later'])
    expect(doc.getElementById(PAGE_OVERRIDES_ID).textContent).toBe('#section-b { --x: 2px; }\n')
  })

  it('⭐ removes it for a page with nothing to override, so the first page’s rules end with it', () => {
    const doc = stubDocument({ prerendered: '#section-a { --x: 1px; }\n' })
    writePageOverrides(doc, '')
    expect(doc.getElementById(PAGE_OVERRIDES_ID)).toBe(null)
  })

  it('with none written, places one right after the theme’s stylesheet, so its rules come later', () => {
    const doc = stubDocument()
    writePageOverrides(doc, '#section-a { --x: 1px; }\n')
    expect(doc.ids()).toEqual(['uniweb-theme', PAGE_OVERRIDES_ID, 'later'])
  })

  it('with no theme stylesheet either, at the end of the head', () => {
    const doc = stubDocument({ theme: false })
    writePageOverrides(doc, '#section-a { --x: 1px; }\n')
    expect(doc.ids()).toEqual(['later', PAGE_OVERRIDES_ID])
  })

  it('writes nothing for a page with nothing to override and nothing written', () => {
    const doc = stubDocument()
    writePageOverrides(doc, '')
    expect(doc.ids()).toEqual(['uniweb-theme', 'later'])
  })
})
