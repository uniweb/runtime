/**
 * ⭐ WHAT A PAGE SAYS IS WHAT ITS PRERENDERED HTML SAYS, `$` and all.
 *
 * `injectPageContent` puts a page's render, its title, its theme and its scripts into the shell. In a
 * replacement STRING, `$$`, `$&`, `` $` `` and `$'` are patterns, so each insertion takes a replacer
 * function. ⛔ Until 2026-11-11 the render and the title went in as strings: a page saying `$$x$$`
 * was served as `$x$`, and `$&` as the `<div id="root"></div>` it replaced, on every lane that
 * prerenders, a static build's and a host's alike — what a crawler, a link preview and the first
 * paint read. The browser's own render then put the words right, so nothing looked wrong in it.
 */
import { describe, it, expect } from 'vitest'
import { injectPageContent } from '../src/ssr-renderer.js'

const SHELL = '<html><head><title>Site</title></head><body><div id="root"></div></body></html>'
// Every pattern a replacement string has, beside text that is only a `$`.
const WORDS = 'Display math is $$x^2$$; in a regex $& is the match, $` what is before it and $\' what is after; $1 and $<name> too. It costs $5.'

const page = (title, themeData = {}) => ({
  title,
  getTitle() { return this.title },
  getHeadMeta() { return {} },
  website: { name: 'Site', themeData },
})

describe('injectPageContent keeps a page\'s words as written', () => {
  it('in the page', () => {
    const html = injectPageContent(SHELL, `<p>${WORDS}</p>`, page('Home'))
    expect(html).toContain(`<div id="root"><p>${WORDS}</p></div>`)
  })

  it('in its title', () => {
    const html = injectPageContent(SHELL, '<p>x</p>', page('Save $$ — $& more'))
    expect(html).toContain('<title>Save $$ — $&amp; more | Site</title>')
  })

  it('in the theme it carries', () => {
    const css = ':root { --price: "$$"; } .x::after { content: "$&"; }'
    const html = injectPageContent(SHELL, '<p>x</p>', page('Home', { css }))
    expect(html).toContain(css)
  })
})
