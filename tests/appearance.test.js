import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolveBootScheme, applyScheme, initAppearance } from '../src/appearance.js'

// Minimal browser stubs — the runtime's vitest env is 'node'.
function stubStorage(initial = {}) {
  const store = { ...initial }
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v)
    },
    removeItem: (k) => {
      delete store[k]
    },
  }
  return store
}

function stubMatchMedia(prefersDark) {
  globalThis.window = { matchMedia: () => ({ matches: prefersDark }) }
}

function stubDocument() {
  const classes = new Set()
  globalThis.document = {
    documentElement: {
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
      },
    },
  }
  return classes
}

beforeEach(() => {
  stubStorage()
  stubMatchMedia(false)
  stubDocument()
})

afterEach(() => {
  delete globalThis.localStorage
  delete globalThis.window
  delete globalThis.document
})

describe('resolveBootScheme', () => {
  it('honors a stored visitor preference over the theme default', () => {
    stubStorage({ 'uniweb-appearance': 'dark' })
    // This is the regression the two-writer bug produced: the stored 'dark' was
    // discarded and `default: light` re-applied on every page load.
    expect(resolveBootScheme({ default: 'light', allowToggle: true })).toBe('dark')
  })

  it('honors a stored light preference even when the default is dark', () => {
    stubStorage({ 'uniweb-appearance': 'light' })
    expect(resolveBootScheme({ default: 'dark' })).toBe('light')
  })

  it('ignores a malformed stored value', () => {
    stubStorage({ 'uniweb-appearance': 'purple' })
    expect(resolveBootScheme({ default: 'dark' })).toBe('dark')
  })

  it('falls back to light when nothing is configured', () => {
    expect(resolveBootScheme()).toBe('light')
    expect(resolveBootScheme({})).toBe('light')
  })

  it('applies the declared default when there is no stored preference', () => {
    expect(resolveBootScheme({ default: 'dark' })).toBe('dark')
    expect(resolveBootScheme({ default: 'light' })).toBe('light')
  })

  it('follows a system dark preference when the theme opts in', () => {
    stubMatchMedia(true)
    const appearance = { default: 'system', respectSystemPreference: true, schemes: ['light', 'dark'] }
    expect(resolveBootScheme(appearance)).toBe('dark')
  })

  it('does not follow the system when respectSystemPreference is off', () => {
    stubMatchMedia(true)
    const appearance = { default: 'light', respectSystemPreference: false, schemes: ['light', 'dark'] }
    expect(resolveBootScheme(appearance)).toBe('light')
  })

  it('follows the system for a toggle site even without an explicit schemes list', () => {
    // The unification: a site that ships a working dark toggle (allowToggle,
    // no `schemes:` — e.g. the `learning` template) now follows a system dark
    // preference on first visit, because hasDarkScheme() sees the toggle. This
    // used to return 'light' when the gate was `schemes.includes('dark')` alone.
    stubMatchMedia(true)
    const appearance = { default: 'light', allowToggle: true, respectSystemPreference: true }
    expect(resolveBootScheme(appearance)).toBe('dark')
  })

  it('does not follow the system when the site has no dark scheme at all', () => {
    // Light-only site: no toggle, light default, dark not listed. hasDarkScheme
    // is false, so we never boot into a dark that has no matching CSS.
    stubMatchMedia(true)
    const appearance = {
      default: 'light',
      allowToggle: false,
      respectSystemPreference: true,
      schemes: ['light'],
    }
    expect(resolveBootScheme(appearance)).toBe('light')
  })

  it('resolves system to light when the OS asks for light', () => {
    stubMatchMedia(false)
    const appearance = { default: 'system', respectSystemPreference: true, schemes: ['light', 'dark'] }
    expect(resolveBootScheme(appearance)).toBe('light')
  })

  it('survives localStorage throwing (Safari private mode)', () => {
    globalThis.localStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
    }
    expect(() => resolveBootScheme({ default: 'dark' })).not.toThrow()
    expect(resolveBootScheme({ default: 'dark' })).toBe('dark')
  })
})

describe('applyScheme', () => {
  it('sets an explicit class in both directions', () => {
    const classes = stubDocument()

    applyScheme('dark')
    expect(classes.has('scheme-dark')).toBe(true)
    expect(classes.has('scheme-light')).toBe(false)

    applyScheme('light')
    expect(classes.has('scheme-light')).toBe(true)
    expect(classes.has('scheme-dark')).toBe(false)
  })

  it('marks light explicitly so it can beat the prefers-color-scheme block', () => {
    // `default: system` themes emit `@media (prefers-color-scheme: dark)` scoped
    // to `:root:not(.scheme-light)`. Merely removing scheme-dark would leave the
    // media query applying dark tokens on a dark OS.
    const classes = stubDocument()
    applyScheme('light')
    expect(classes.has('scheme-light')).toBe(true)
  })
})

describe('initAppearance', () => {
  it('returns null and writes nothing when the theme declares no appearance', () => {
    const classes = stubDocument()
    expect(initAppearance(undefined)).toBeNull()
    expect(classes.size).toBe(0)
  })

  it('resolves and applies in one call', () => {
    stubStorage({ 'uniweb-appearance': 'dark' })
    const classes = stubDocument()
    expect(initAppearance({ default: 'light', allowToggle: true })).toBe('dark')
    expect(classes.has('scheme-dark')).toBe(true)
  })
})
