/**
 * `loadFoundationCSS` — the skip that lets a host own the `<link>`.
 *
 * ⭐ **Written because a peer lane shipped against this and nothing asserted it.**
 * The site-hosting edge now emits `<link rel="stylesheet">` for the foundation
 * in the assembled head, so the sheet applies during HTML parse rather than
 * after the runtime boots. That is only safe because this function skips a link
 * it finds already present — and on 2026-08-19 that behaviour had **zero**
 * tests. A refactor would have given their lane two tags and two fetches with
 * every test in this package still green.
 *
 * Each case below was confirmed by reintroducing the bug it guards, not written
 * against code that already passed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadFoundationCSS } from '../src/foundation-loader.js'

const HREF = 'https://cdn.example.com/foundations/acme/site/1.0.0/style.css'

/** A document just real enough for a querySelector-and-append loader. */
function fakeDocument(existing = []) {
  const links = [...existing]
  return {
    links,
    head: { appendChild: (el) => links.push(el) },
    createElement: () => ({ rel: '', href: '', onload: null, onerror: null }),
    querySelector: (sel) => {
      const m = /^link\[rel="stylesheet"\]\[href="(.*)"\]$/.exec(sel)
      if (!m) return null
      return links.find((l) => l.rel === 'stylesheet' && l.href === m[1]) || null
    }
  }
}

const stylesheet = (href) => ({ rel: 'stylesheet', href })

/** Resolve the promise the loader returns by firing the link's own onload. */
async function settle(promise, doc) {
  const added = doc.links[doc.links.length - 1]
  if (added?.onload) added.onload()
  return promise
}

let doc
beforeEach(() => {
  doc = fakeDocument()
  globalThis.document = doc
})
afterEach(() => {
  delete globalThis.document
  vi.restoreAllMocks()
})

describe('loadFoundationCSS', () => {
  it('injects the stylesheet when the head has none', async () => {
    await settle(loadFoundationCSS(HREF), doc)
    expect(doc.links).toHaveLength(1)
    expect(doc.links[0]).toMatchObject({ rel: 'stylesheet', href: HREF })
  })

  // ⭐ The one a host builds on. Drop the guard and this goes red.
  it('skips when the head already carries that exact href', async () => {
    doc = fakeDocument([stylesheet(HREF)])
    globalThis.document = doc
    await loadFoundationCSS(HREF)
    expect(doc.links).toHaveLength(1)
  })

  it('does not fetch twice when called twice', async () => {
    await settle(loadFoundationCSS(HREF), doc)
    await loadFoundationCSS(HREF)
    expect(doc.links).toHaveLength(1)
  })

  // Extra attributes a host adds must not defeat the match — the edge emits
  // `crossorigin` on every cross-origin hint, and the selector keys on rel+href.
  it('still skips when the existing link carries extra attributes', async () => {
    doc = fakeDocument([{ ...stylesheet(HREF), crossOrigin: 'anonymous' }])
    globalThis.document = doc
    await loadFoundationCSS(HREF)
    expect(doc.links).toHaveLength(1)
  })

  // The control: a DIFFERENT foundation's sheet must still load, or "skip"
  // would be indistinguishable from "never injects".
  it('injects when the present link is for a different href', async () => {
    doc = fakeDocument([stylesheet('https://cdn.example.com/other/style.css')])
    globalThis.document = doc
    await settle(loadFoundationCSS(HREF), doc)
    expect(doc.links).toHaveLength(2)
  })

  // ⛔ Pins the caveat given to hosting: the match is on the literal attribute,
  // so a href that differs only by resolution is NOT deduped. If this ever needs
  // to pass, the comparison must become resolved-to-resolved.
  it('does NOT dedupe a root-relative href against its resolved form', async () => {
    doc = fakeDocument([stylesheet('/style.css')])
    globalThis.document = doc
    await settle(loadFoundationCSS('https://site.example.com/style.css'), doc)
    expect(doc.links).toHaveLength(2)
  })

  it('is a no-op with no url', async () => {
    await loadFoundationCSS('')
    await loadFoundationCSS(undefined)
    expect(doc.links).toHaveLength(0)
  })

  it('resolves rather than rejecting when the sheet 404s', async () => {
    const p = loadFoundationCSS(HREF)
    doc.links[0].onerror()
    await expect(p).resolves.toBeUndefined()
  })
})
