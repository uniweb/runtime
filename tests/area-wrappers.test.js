import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveLayoutTransitions, resolveLayoutLayers, areaWrapperStyle } from '../src/area-wrappers.js'

describe('resolveLayoutTransitions', () => {
  it('auto-names the body and every area by default (no explicit map)', () => {
    const t = resolveLayoutTransitions(['header', 'left', 'right', 'footer'], undefined)
    expect(t).toEqual({
      body: 'uw-body',
      header: 'uw-header',
      left: 'uw-left',
      right: 'uw-right',
      footer: 'uw-footer',
    })
  })

  it('gives same-named areas the same name across layouts (auto cross-layout morph)', () => {
    const a = resolveLayoutTransitions(['header', 'left'], undefined)
    const b = resolveLayoutTransitions(['header', 'right'], undefined)
    expect(a.header).toBe(b.header) // shared chrome morphs between layouts
    expect(a.left).not.toBe(b.right)
  })

  it('lets an explicit map override per region (e.g. group left↔sidebar)', () => {
    const t = resolveLayoutTransitions(['header', 'left', 'footer'], { left: 'sidebar' })
    expect(t.left).toBe('sidebar') // override wins
    expect(t.header).toBe('uw-header') // others still auto
    expect(t.body).toBe('uw-body')
  })

  it('opts a single region out when explicitly set to null', () => {
    const t = resolveLayoutTransitions(['header', 'footer'], { header: null })
    expect(t.header).toBeNull() // no name → renderer leaves it unwrapped
    expect(t.footer).toBe('uw-footer')
  })

  it('opts the whole layout out when transitions is false', () => {
    expect(resolveLayoutTransitions(['header', 'left'], false)).toBeNull()
  })

  it('namespaces and sanitizes names into valid CSS idents', () => {
    const t = resolveLayoutTransitions(['side panel', 'a/b'], undefined)
    expect(t['side panel']).toBe('uw-side-panel')
    expect(t['a/b']).toBe('uw-a-b')
  })

  it('handles a body-only layout (no areas)', () => {
    expect(resolveLayoutTransitions([], undefined)).toEqual({ body: 'uw-body' })
  })
})

describe('resolveLayoutLayers', () => {
  it('lifts every area above the body, and leaves the body unstacked', () => {
    // The body is deliberately absent rather than pinned to 0: a layer carries
    // `position: relative`, and a positioned body wrapper would become the
    // containing block for every absolutely-positioned descendant on the page.
    expect(resolveLayoutLayers(['header', 'left', 'footer'], undefined)).toEqual({
      header: 1,
      left: 1,
      footer: 1,
    })
  })

  it('does not rank chrome against chrome', () => {
    // Area names are free-form, so ordering `header` over `left` would be the
    // framework reading meaning into a string a foundation chose. Equal by
    // default; a layout that has overlapping chrome says so with `layers`.
    const layers = resolveLayoutLayers(['header', 'left', 'right', 'footer', 'statusbar'], undefined)
    expect(new Set(Object.values(layers))).toEqual(new Set([1]))
  })

  it('takes a per-region override without losing the rest', () => {
    expect(resolveLayoutLayers(['header', 'footer'], { footer: 0, header: 5 })).toEqual({
      footer: 0,
      header: 5,
    })
  })

  it('opts the whole layout out with false', () => {
    expect(resolveLayoutLayers(['header', 'left'], false)).toEqual({})
  })

  it('does not depend on view transitions', () => {
    // "Chrome above content" is a property of the layout, not of how it
    // animates. Tying the two together is what left DefaultLayout hand-rolling
    // its own z-index, a second mechanism that then swallowed this one.
    expect(resolveLayoutLayers(['header'], undefined)).toEqual({ header: 1 })
  })
})

describe('areaWrapperStyle', () => {
  it('carries the name and the layer together', () => {
    const t = resolveLayoutTransitions(['header'], undefined)
    const l = resolveLayoutLayers(['header'], undefined)
    expect(areaWrapperStyle('header', t, l)).toEqual({
      viewTransitionName: 'uw-header',
      position: 'relative',
      zIndex: 1,
    })
  })

  it('gives the body a name and no position', () => {
    const t = resolveLayoutTransitions(['header'], undefined)
    const l = resolveLayoutLayers(['header'], undefined)
    expect(areaWrapperStyle('body', t, l)).toEqual({ viewTransitionName: 'uw-body' })
  })

  it('sets position alongside any layer, since z-index does nothing without it', () => {
    expect(areaWrapperStyle('header', null, { header: 3 })).toEqual({
      position: 'relative',
      zIndex: 3,
    })
  })

  it('returns null when a region needs no wrapper at all', () => {
    // Nothing to name and nothing to stack — emit no div rather than an inert
    // one, which would add a stacking context for free.
    expect(areaWrapperStyle('header', null, {})).toBeNull()
    expect(areaWrapperStyle('header', { header: null }, {})).toBeNull()
  })

  it('treats layer 0 as a layer, not as absent', () => {
    expect(areaWrapperStyle('footer', null, { footer: 0 })).toEqual({
      position: 'relative',
      zIndex: 0,
    })
  })
})

describe('the two renderers cannot drift', () => {
  /**
   * The SPA renderer and the SSR renderer each build these wrappers. When each
   * constructed its own `{ viewTransitionName }` object, a rule added to one
   * and forgotten in the other would be invisible until a prerendered page and
   * its hydrated self disagreed about what paints on top — the same failure
   * shape as the prerender head seam, which needed two prose warnings and a
   * test before it stopped recurring.
   *
   * So the guard is mechanical: neither renderer may hand-build a wrapper
   * style. Both must go through `areaWrapperStyle`.
   */
  const read = (p) =>
    readFileSync(new URL(p, import.meta.url), 'utf8')

  for (const file of ['../src/components/Layout.jsx', '../src/ssr-renderer.js']) {
    it(`${file} builds its wrapper through areaWrapperStyle`, () => {
      const src = read(file)
      expect(src).toMatch(/areaWrapperStyle\(/)
      // A literal `viewTransitionName:` here means someone rebuilt the wrapper
      // by hand instead of asking for it.
      expect(src).not.toMatch(/viewTransitionName\s*:/)
    })
  }
})

describe('DefaultLayout leaves stacking to the wrappers', () => {
  /**
   * It used to hard-code `z-index: 40` on the header and `30` on the footer.
   * A positioned element there becomes a stacking context that SEALS the
   * area's own layer inside it, so `layers` became a silent no-op on the most
   * commonly used layout — measured on a real page, `layers: { header: 0 }`
   * changed nothing. Two mechanisms for one job, and the older one won.
   */
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

  for (const file of ['../src/components/Layout.jsx', '../src/ssr-renderer.js']) {
    it(`${file} does not re-introduce a hand-rolled area z-index`, () => {
      const src = read(file)
      expect(src).not.toMatch(/zIndex:\s*(40|30)\b/)
    })
  }
})
