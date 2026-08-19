/**
 * The manifest's `preloads` must name the entry's static closure and nothing
 * else. See scripts/entry-preloads.js for the incident this pins.
 */

import { describe, it, expect } from 'vitest'
import { entryPreloads } from '../scripts/entry-preloads.js'

// Shaped after the real dist/app graph: the entry statically reaches the
// vendor chunks, and reaches the telemetry emitters ONLY by dynamic import.
const bundle = {
  'assets/entry.js': {
    imports: ['assets/react.js', 'assets/setup.js'],
    dynamicImports: ['assets/outbound-clicks.js', 'assets/section-views.js']
  },
  'assets/setup.js': { imports: ['assets/shared.js'] },
  'assets/react.js': { imports: [] },
  'assets/shared.js': { imports: [] },
  'assets/outbound-clicks.js': { imports: ['assets/shared.js'] },
  'assets/section-views.js': { imports: [] },
  '_importmap/@uniweb-core.js': { imports: [] }
}

describe('entryPreloads', () => {
  const preloads = entryPreloads(bundle, 'assets/entry.js')

  it('names the entry\'s transitive static imports', () => {
    expect(preloads.sort()).toEqual(['assets/react.js', 'assets/setup.js', 'assets/shared.js'])
  })

  it('excludes the entry itself', () => {
    expect(preloads).not.toContain('assets/entry.js')
  })

  // The regression. A dynamically-imported emitter in this list means every
  // site downloads it whether or not it tracks — silently, with no symptom.
  it('excludes dynamically-imported chunks', () => {
    expect(preloads).not.toContain('assets/outbound-clicks.js')
    expect(preloads).not.toContain('assets/section-views.js')
  })

  // The control: a chunk BOTH the entry and a dynamic chunk reach must stay,
  // or the fix would swing to under-declaring instead.
  it('keeps a shared chunk the entry also reaches statically', () => {
    expect(preloads).toContain('assets/shared.js')
  })

  it('leaves _importmap bridges to the importMap field', () => {
    expect(preloads.every((f) => f.startsWith('assets/'))).toBe(true)
  })

  it('terminates on a circular graph', () => {
    const circular = {
      'assets/a.js': { imports: ['assets/b.js'] },
      'assets/b.js': { imports: ['assets/a.js'] }
    }
    expect(entryPreloads(circular, 'assets/a.js')).toEqual(['assets/b.js'])
  })
})
