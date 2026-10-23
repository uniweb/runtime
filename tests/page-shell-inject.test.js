import { describe, it, expect } from 'vitest'
import { injectPageContent } from '../src/ssr-renderer.js'
import { pageShell } from '@uniweb/core/page-shell'

/**
 * The shell a host serves (`pageShell`) is what an isolate renders into (`createPageRenderer` →
 * `injectPageContent`), so the render must find in it what it fills: an empty `#root`, a
 * `<title>`, a `</head>` — and must leave `__DATA__` parsing. Each half is tested in its own
 * package; this is the join.
 */
const shell = pageShell({
  content: {
    config: { name: 'Uniweb', activeLocale: 'en', base: '/' },
    pages: [{ route: '/about', sections: [{ text: 'see <!-- this --> and </script>' }] }],
  },
  route: '/about',
  foundation: { url: 'https://assets.test/f/1.0.0/entry.js' },
  runtime: { base: 'https://cdn.test/runtime/1.1.15/', manifest: { entry: 'assets/index.js', preloads: [], importMap: {} } },
})

const page = {
  route: '/about',
  title: 'About',
  description: 'Who we are.',
  website: { name: 'Uniweb', themeData: { css: ':root{--x:1}' } },
}

describe('injectPageContent renders into pageShell', () => {
  const html = injectPageContent(shell, '<h1>About</h1>', page, {})

  it('fills the root and titles the page', () => {
    expect(html).toContain('<div id="root"><h1>About</h1></div>')
    expect(html).toMatch(/<title>About[^<]*<\/title>/)
    expect(html).toContain('<meta name="description" content="Who we are.">')
    expect(html).toContain('<style id="uniweb-theme">')
  })

  it('leaves __DATA__ whole and parsing', () => {
    const data = JSON.parse(html.match(/<script id="__DATA__" type="application\/json">([\s\S]*?)<\/script>/)[1])
    expect(data.content.pages[0].sections[0].text).toBe('see <!-- this --> and </script>')
    expect(data.foundation.cssUrl).toBe('https://assets.test/f/1.0.0/assets/style.css')
  })
})
