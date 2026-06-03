import { describe, it, expect } from 'vitest'
import { resolveLayoutTransitions } from '../src/view-transitions.js'

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
