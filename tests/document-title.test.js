/**
 * The document title — one rule, two writers, and they must agree.
 *
 * The SPA sets `document.title` in `useHeadMeta`; every prerender lane writes `<title>` in
 * `injectPageContent`. Until 2026-09-14 the SPA wrote `<page> | <site>` and the prerender
 * `<page>` alone, so a prerendered page changed its title the moment the bundle loaded and
 * a crawler that runs no script indexed the shorter one. Both now call `documentTitle`,
 * and the parity block below drives BOTH writers with the same page and compares what
 * each produced — not what each was meant to produce.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The SPA half runs `useHeadMeta`'s effect in place: React's two hooks become synchronous
// stand-ins. Everything else in `react` stays real — ssr-renderer.js renders with it.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useEffect: (effect) => { effect() }, useRef: (value) => ({ current: value }) }
})

import { documentTitle } from '../src/document-title.js'
import { useHeadMeta } from '../src/hooks/useHeadMeta.js'
import { injectPageContent } from '../src/ssr-renderer.js'

const SHELL = '<!doctype html><html><head><title>shell</title></head><body><div id="root"></div></body></html>'

/** The few DOM calls `useHeadMeta` makes, and a title to read back. */
function fakeDocument() {
  const element = () => ({ setAttribute() {}, remove() {} })
  return { title: 'shell', querySelector: () => null, createElement: element, head: { appendChild() {} } }
}

/** A page as `injectPageContent` reads one: its title, and the website it belongs to. */
const pageOf = (title, siteName) => ({
  title,
  getTitle: () => title,
  description: '',
  route: '/about',
  website: { name: siteName, themeData: {} },
})

/** What the prerender wrote into `<title>`. */
const prerendered = (title, siteName) =>
  injectPageContent(SHELL, '<p>x</p>', pageOf(title, siteName)).match(/<title>(.*?)<\/title>/)[1]

/** What the SPA set `document.title` to, for the same page. */
function spa(title, siteName) {
  useHeadMeta({ title, description: '' }, { siteName })
  return globalThis.document.title
}

beforeEach(() => { globalThis.document = fakeDocument() })
afterEach(() => { delete globalThis.document })

describe('documentTitle — the rule', () => {
  it('is the page title, then the site name', () => {
    expect(documentTitle('About', 'Acme')).toBe('About | Acme')
  })

  it('is the page title alone when the site has no name', () => {
    expect(documentTitle('About', '')).toBe('About')
    expect(documentTitle('About', undefined)).toBe('About')
  })

  it('is empty when the page has no title — the caller keeps the title it has', () => {
    expect(documentTitle('', 'Acme')).toBe('')
    expect(documentTitle(null, 'Acme')).toBe('')
  })

  it('carries a numeric page title as text', () => {
    expect(documentTitle(2024, 'Acme')).toBe('2024 | Acme')
  })
})

describe('the prerendered <title>', () => {
  it('carries the site name, as the browser tab does', () => {
    expect(prerendered('About', 'Acme')).toBe('About | Acme')
  })

  it('is escaped whole — the site name as much as the page title', () => {
    expect(prerendered('R&D', 'A <B>')).toBe('R&amp;D | A &lt;B&gt;')
  })

  it('leaves the shell\'s title alone for a page with no title', () => {
    expect(prerendered('', 'Acme')).toBe('shell')
  })
})

describe('⭐ parity — the SPA keeps the title the prerender wrote', () => {
  const cases = [
    ['About', 'Acme'],
    ['About', ''],
    ['Alice Nguyen', 'flow-marketing'],
    ['', 'Acme'],
  ]

  it.each(cases)('page %j on site %j', (title, siteName) => {
    expect(spa(title, siteName)).toBe(prerendered(title, siteName))
  })
})
