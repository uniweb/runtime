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
  const t = (areas) => resolveLayoutTransitions(areas, undefined)

  it('lifts every area above the body, and leaves the body unstacked', () => {
    // The body is deliberately absent rather than pinned to 0: a layer carries
    // `position: relative`, and a positioned body wrapper would become the
    // containing block for every absolutely-positioned descendant on the page.
    const areas = ['header', 'left', 'footer']
    expect(resolveLayoutLayers(areas, undefined, t(areas))).toEqual({
      header: 1,
      left: 1,
      footer: 1,
    })
  })

  it('does not rank chrome against chrome', () => {
    // Area names are free-form, so ordering `header` over `left` would be the
    // framework reading meaning into a string a foundation chose. Equal by
    // default; a layout that has overlapping chrome says so with `layers`.
    const areas = ['header', 'left', 'right', 'footer', 'statusbar']
    const layers = resolveLayoutLayers(areas, undefined, t(areas))
    expect(new Set(Object.values(layers))).toEqual(new Set([1]))
  })

  it('takes a per-region override without losing the rest', () => {
    const areas = ['header', 'footer']
    expect(resolveLayoutLayers(areas, { footer: 0, header: 5 }, t(areas))).toEqual({
      footer: 0,
      header: 5,
    })
  })

  it('opts the whole layout out with false', () => {
    const areas = ['header', 'left']
    expect(resolveLayoutLayers(areas, false, t(areas))).toEqual({})
  })

  it('imposes nothing when the layout has no transitions', () => {
    // No wrapper exists, so no stacking context was created and there is
    // nothing to correct. Adding one here would create the problem it solves.
    expect(resolveLayoutLayers(['header'], undefined, null)).toEqual({})
  })

  it('still honours an explicit layer with transitions off', () => {
    expect(resolveLayoutLayers(['header'], { header: 2 }, null)).toEqual({ header: 2 })
  })
})

describe('areaWrapperStyle', () => {
  it('carries the name and the layer together', () => {
    const t = resolveLayoutTransitions(['header'], undefined)
    const l = resolveLayoutLayers(['header'], undefined, t)
    expect(areaWrapperStyle('header', t, l)).toEqual({
      viewTransitionName: 'uw-header',
      position: 'relative',
      zIndex: 1,
    })
  })

  it('gives the body a name and no position', () => {
    const t = resolveLayoutTransitions(['header'], undefined)
    const l = resolveLayoutLayers(['header'], undefined, t)
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
