/**
 * A page's head tags — one source, two writers, and they must agree.
 *
 * The prerender writes them into the HTML (`injectPageContent`) and the browser sets them on every
 * page it shows (`useHeadMeta`), both from `Page#getHeadMeta`. Until 2026-10-25 the static build
 * also wrote the HOME page's into the one shell every page is rendered into, and the prerender
 * appended each page's after them: every page named the home page its canonical, with two og:title
 * and two og:url, the home page's first — and the browser then deleted the canonical of every page
 * that did not author one. The parity block drives both writers with the same page and compares
 * what each produced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The browser half runs `useHeadMeta`'s effect in place, as tests/document-title.test.js does.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useEffect: (effect) => { effect() }, useRef: (value) => ({ current: value }) }
})

import { Website } from '@uniweb/core'
import { useHeadMeta } from '../src/hooks/useHeadMeta.js'
import { injectPageContent } from '../src/ssr-renderer.js'

const ADDRESS = 'https://octocat.github.io/handbook/'

// A shell as the static build wrote it until 2026-10-25: the home page's tags in every page.
const STALE_SHELL = [
  '<!doctype html><html><head><title>shell</title>',
  `<link rel="canonical" href="${ADDRESS}">`,
  '<meta property="og:title" content="Acme">',
  `<meta property="og:url" content="${ADDRESS}">`,
  '<meta name="twitter:title" content="Acme">',
  '<link rel="alternate" hreflang="en" href="https://example.com/">',
  '</head><body><div id="root"></div></body></html>',
].join('\n')

function site(config = {}) {
  return new Website({
    content: {
      config: { name: 'Acme', defaultLanguage: 'en', seo: { image: '/og/default.png' }, ...config },
      theme: {},
      pages: [
        { route: '/', isIndex: true, title: 'Home', sections: [] },
        { route: '/books', title: 'Books', sections: [] },
        { route: '/books/field-guide', title: 'Field Guide', description: 'A book.', sections: [] },
      ],
    },
  })
}

const pageOf = (website, route) => website.pages.find((p) => p.route === route)

/** The head's SEO tags, as `kind key value` lines. */
function headTags(html) {
  const head = html.slice(0, html.indexOf('</head>'))
  const tags = []
  for (const [, attr, key, value] of head.matchAll(/<meta (name|property)="([^"]+)" content="([^"]*)">/g)) {
    tags.push(`meta ${attr}=${key} ${value}`)
  }
  for (const [tag] of head.matchAll(/<link [^>]*>/g)) {
    const rel = tag.match(/rel="([^"]+)"/)?.[1]
    const hreflang = tag.match(/hreflang="([^"]+)"/)?.[1] || ''
    tags.push(`link ${rel}${hreflang ? ` ${hreflang}` : ''} ${tag.match(/href="([^"]+)"/)?.[1]}`)
  }
  return tags.sort()
}

/** A document holding the head's tags: the few DOM calls `useHeadMeta` makes. */
function fakeDocument(seedHtml = '') {
  const nodes = []
  const node = (tag, attrs = {}) => ({
    tag,
    attrs: { ...attrs },
    setAttribute(key, value) { this.attrs[key] = String(value) },
    remove() { const i = nodes.indexOf(this); if (i !== -1) nodes.splice(i, 1) },
  })
  const matches = (n, selector) => {
    const [, tag, rest] = selector.match(/^(\w+)((?:\[[^\]]+\])*)$/)
    if (n.tag !== tag) return false
    for (const [, key, value] of rest.matchAll(/\[([\w:-]+)(?:="([^"]*)")?\]/g)) {
      if (value === undefined ? !(key in n.attrs) : n.attrs[key] !== value) return false
    }
    return true
  }
  const head = seedHtml.slice(0, seedHtml.indexOf('</head>'))
  for (const [, attr, key, value] of head.matchAll(/<meta (name|property)="([^"]+)" content="([^"]*)">/g)) {
    nodes.push(node('meta', { [attr]: key, content: value }))
  }
  for (const [tag] of head.matchAll(/<link [^>]*>/g)) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]))
    nodes.push(node('link', attrs))
  }
  return {
    title: '',
    head: { appendChild(n) { nodes.push(n) } },
    createElement: (tag) => node(tag),
    querySelector: (selector) => nodes.find((n) => matches(n, selector)) || null,
    querySelectorAll: (selector) => nodes.filter((n) => matches(n, selector)),
    tags() {
      return nodes.map((n) => n.tag === 'meta'
        ? `meta ${'property' in n.attrs ? `property=${n.attrs.property}` : `name=${n.attrs.name}`} ${n.attrs.content}`
        : `link ${n.attrs.rel}${n.attrs.hreflang ? ` ${n.attrs.hreflang}` : ''} ${n.attrs.href}`).sort()
    },
  }
}

afterEach(() => { delete globalThis.document })

describe('the prerendered head', () => {
  const website = site({ url: ADDRESS, trailingSlash: true })
  const html = injectPageContent(STALE_SHELL, '<p>x</p>', pageOf(website, '/books/field-guide'))
  const tags = headTags(html)

  it('⭐ names the page ITSELF as its canonical and og:url — once, whatever the shell carried', () => {
    const own = `${ADDRESS}books/field-guide/`
    expect(tags.filter((t) => t.startsWith('link canonical'))).toEqual([`link canonical ${own}`])
    expect(tags.filter((t) => t.startsWith('meta property=og:url'))).toEqual([`meta property=og:url ${own}`])
    expect(tags.filter((t) => t.startsWith('meta property=og:title'))).toEqual(['meta property=og:title Field Guide'])
    expect(tags.filter((t) => t.startsWith('meta name=twitter:title'))).toEqual(['meta name=twitter:title Field Guide'])
  })

  it('states the social card absolutely, with the base path, and names the site', () => {
    expect(tags).toContain(`meta property=og:image ${ADDRESS}og/default.png`)
    expect(tags).toContain('meta property=og:site_name Acme')
  })

  it('drops the shell’s hreflang for a site in one locale, and writes a multilingual page’s own', () => {
    expect(tags.some((t) => t.startsWith('link alternate'))).toBe(false)
    const two = site({ url: 'https://example.com', languages: ['en', 'fr'] })
    expect(headTags(injectPageContent(STALE_SHELL, '<p>x</p>', pageOf(two, '/books')))
      .filter((t) => t.startsWith('link alternate'))).toEqual([
      'link alternate en https://example.com/books',
      'link alternate fr https://example.com/fr/books',
      'link alternate x-default https://example.com/books',
    ])
  })

  it('states no canonical or og:url when the address is unknown — and removes a stale one', () => {
    const unknown = headTags(injectPageContent(STALE_SHELL, '<p>x</p>', pageOf(site(), '/books')))
    expect(unknown.some((t) => t.startsWith('link canonical'))).toBe(false)
    expect(unknown.some((t) => t.startsWith('meta property=og:url'))).toBe(false)
    expect(unknown).toContain('meta property=og:image /og/default.png')
  })

  it('edits the head alone — a page’s content that reads like a tag is left as it is', () => {
    const body = '<p>&lt;link rel="canonical" href="x"&gt;</p><meta property="og:title" content="in the body">'
    const out = injectPageContent(STALE_SHELL, body, pageOf(website, '/books'))
    expect(out).toContain('<meta property="og:title" content="in the body">')
  })
})

describe('⭐ parity — hydrating the page changes nothing a crawler read', () => {
  for (const [label, config, route] of [
    ['a record page under a base path', { url: ADDRESS, trailingSlash: true }, '/books/field-guide'],
    ['the home page', { url: ADDRESS, trailingSlash: true, description: 'Software architect.' }, '/'],
    ['a page in two locales', { url: 'https://example.com', languages: ['en', 'fr'] }, '/books'],
    ['a page whose address is unknown', {}, '/books'],
  ]) {
    it(label, () => {
      const website = site(config)
      const page = pageOf(website, route)
      const html = injectPageContent(STALE_SHELL, '<p>x</p>', page)
      globalThis.document = fakeDocument(html)
      useHeadMeta(page.getHeadMeta(), { siteName: website.name })
      expect(globalThis.document.tags()).toEqual(headTags(html))
    })
  }
})

describe('⭐ parity — navigating leaves exactly the next page’s tags, none of the last one’s', () => {
  // Hydration alone cannot fail for a writer that does nothing; a navigation can.
  for (const [label, config, from, to] of [
    ['from a record page to the home page', { url: ADDRESS, trailingSlash: true }, '/books/field-guide', '/'],
    ['between pages in two locales', { url: 'https://example.com', languages: ['en', 'fr'] }, '/', '/books'],
    ['to a page with no description', { url: ADDRESS }, '/books/field-guide', '/books'],
  ]) {
    it(label, () => {
      const website = site(config)
      globalThis.document = fakeDocument(injectPageContent(STALE_SHELL, '<p>x</p>', pageOf(website, from)))
      const next = pageOf(website, to)
      useHeadMeta(next.getHeadMeta(), { siteName: website.name })
      expect(globalThis.document.tags()).toEqual(headTags(injectPageContent(STALE_SHELL, '<p>x</p>', next)))
    })
  }
})
