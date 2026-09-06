/**
 * The helpers the two background renderers share.
 *
 * ⚠️ **These existed as byte-identical copies in `ssr-renderer.js` and
 * `components/Background.jsx` until 2026-09-06, and the whole suite was green
 * the entire time** — because nothing asserted the case they got wrong. That is
 * this file's reason for existing, more than the two functions are.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { siteUrl, withOpacity } from '../src/background-shared.js'

function withBase(basePath, fn) {
  const prev = globalThis.uniweb
  globalThis.uniweb = { activeWebsite: { basePath } }
  try { return fn() } finally { globalThis.uniweb = prev }
}

afterEach(() => { delete globalThis.uniweb })

describe('siteUrl — the base join, which is core’s and not ours', () => {
  it('⛔ a PROTOCOL-RELATIVE url passes through — the case the copies got wrong', () => {
    // Measured 2026-09-06: both duplicated copies returned
    // `/docs//cdn.example.com/hero.jpg`, because they guarded `startsWith('/')`
    // and not `startsWith('//')`. An author writing a CDN URL that way on a
    // site with `base: /docs/` got a background that 404s — and no test looked.
    expect(withBase('/docs', () => siteUrl('//cdn.example.com/hero.jpg')))
      .toBe('//cdn.example.com/hero.jpg')
  })

  it('applies the base to a site-root-relative url', () => {
    expect(withBase('/docs', () => siteUrl('/img/hero.jpg'))).toBe('/docs/img/hero.jpg')
  })

  it('is idempotent — an already-based path is not based twice', () => {
    expect(withBase('/docs', () => siteUrl('/docs/img/a.jpg'))).toBe('/docs/img/a.jpg')
    expect(withBase('/docs', () => siteUrl('/docs'))).toBe('/docs')
  })

  it('leaves absolute and relative urls alone, and is a no-op with no base', () => {
    expect(withBase('/docs', () => siteUrl('https://x.example/y.jpg'))).toBe('https://x.example/y.jpg')
    expect(withBase('/docs', () => siteUrl('img/hero.jpg'))).toBe('img/hero.jpg')
    expect(withBase('', () => siteUrl('/img/hero.jpg'))).toBe('/img/hero.jpg')
  })

  it('does not throw when there is no active website — an SSR isolate before boot', () => {
    expect(siteUrl('/img/hero.jpg')).toBe('/img/hero.jpg')
    expect(siteUrl('')).toBe('')
    expect(siteUrl(undefined)).toBe(undefined)
  })
})

describe('withOpacity', () => {
  it('converts hex and rgb', () => {
    expect(withOpacity('#336699', 0.5)).toBe('rgba(51, 102, 153, 0.5)')
    expect(withOpacity('rgb(1, 2, 3)', 0.25)).toBe('rgba(1, 2, 3, 0.25)')
    expect(withOpacity('rgba(1, 2, 3, 0.9)', 0.25)).toBe('rgba(1, 2, 3, 0.25)')
  })

  it('returns anything else unchanged — a wrong guess paints the wrong colour', () => {
    expect(withOpacity('rebeccapurple', 0.5)).toBe('rebeccapurple')
    expect(withOpacity('var(--section)', 0.5)).toBe('var(--section)')
    expect(withOpacity('oklch(0.7 0.1 250)', 0.5)).toBe('oklch(0.7 0.1 250)')
  })

  it('⛔ survives a non-string, which the copies did not', () => {
    // Both copies called `color.startsWith` unguarded, so a null background
    // colour threw inside a render rather than degrading.
    expect(withOpacity(null, 0.5)).toBe(null)
    expect(withOpacity(undefined, 0.5)).toBe(undefined)
    expect(withOpacity('', 0.5)).toBe('')
  })
})

describe('the twin does not re-grow', () => {
  it('neither background renderer defines its own copy', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    for (const rel of ['../src/ssr-renderer.js', '../src/components/Background.jsx']) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
      // ⭐ The L3 pair is twinned on purpose (gotcha #2) — the RENDERING is.
      // A pure helper pulled inside that twin silently joins the commitment to
      // keep two copies in step, which is how these two drifted from core.
      expect(src, `${rel} re-declares a shared helper`).not.toMatch(/function\s+(withOpacity|resolveUrl|siteUrl)\s*\(/)
    }
  })
})
