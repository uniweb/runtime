import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  applyBootScheme,
  resolveAppearanceBoot,
  initAppearance,
  renderAppearanceBootScript,
} from '../src/appearance.js'

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

describe('initAppearance — scheme resolution', () => {
  it('honors a stored visitor preference over the theme default', () => {
    stubStorage({ 'uniweb-appearance': 'dark' })
    // This is the regression the two-writer bug produced: the stored 'dark' was
    // discarded and `default: light` re-applied on every page load.
    expect(initAppearance({ default: 'light', allowToggle: true })).toBe('dark')
  })

  it('honors a stored light preference even when the default is dark', () => {
    stubStorage({ 'uniweb-appearance': 'light' })
    expect(initAppearance({ default: 'dark' })).toBe('light')
  })

  it('ignores a malformed stored value', () => {
    stubStorage({ 'uniweb-appearance': 'purple' })
    expect(initAppearance({ default: 'dark' })).toBe('dark')
  })

  it('applies the declared default when there is no stored preference', () => {
    expect(initAppearance({ default: 'dark' })).toBe('dark')
    expect(initAppearance({ default: 'light', allowToggle: true })).toBe('light')
  })

  it('follows a system dark preference when the theme opts in', () => {
    stubMatchMedia(true)
    const appearance = { default: 'system', respectSystemPreference: true, schemes: ['light', 'dark'] }
    expect(initAppearance(appearance)).toBe('dark')
  })

  it('does not follow the system when respectSystemPreference is off', () => {
    stubMatchMedia(true)
    const appearance = { default: 'light', respectSystemPreference: false, schemes: ['light', 'dark'] }
    expect(initAppearance(appearance)).toBe('light')
  })

  it('follows the OS when respectSystemPreference is simply unset', () => {
    // Unset means true — matching @uniweb/core's Theme.getAppearance() (`?? true`),
    // @uniweb/theming's DEFAULT_APPEARANCE, and the documented behavior. The
    // runtime used to treat unset as false, which agreed with the inline boot
    // script only because normalizeAppearance() always injects the key; raw
    // theme.yml appearance would have flashed then flipped.
    stubMatchMedia(true)
    expect(initAppearance({ default: 'light', allowToggle: true })).toBe('dark')
  })

  it('follows the system for a toggle site even without an explicit schemes list', () => {
    // A site that ships a working dark toggle (allowToggle, no `schemes:` — e.g.
    // the `learning` template) follows a system dark preference on first visit,
    // because hasDarkScheme() sees the toggle.
    stubMatchMedia(true)
    const appearance = { default: 'light', allowToggle: true, respectSystemPreference: true }
    expect(initAppearance(appearance)).toBe('dark')
  })

  it('resolves system to light when the OS asks for light', () => {
    stubMatchMedia(false)
    const appearance = { default: 'system', respectSystemPreference: true, schemes: ['light', 'dark'] }
    expect(initAppearance(appearance)).toBe('light')
  })

  it('survives localStorage throwing (Safari private mode)', () => {
    globalThis.localStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
    }
    expect(() => initAppearance({ default: 'dark' })).not.toThrow()
    expect(initAppearance({ default: 'dark' })).toBe('dark')
  })

  it('survives a missing matchMedia', () => {
    globalThis.window = {}
    expect(initAppearance({ default: 'dark', respectSystemPreference: true })).toBe('dark')
  })
})

describe('initAppearance — what gets written to the document', () => {
  it('sets an explicit class in both directions', () => {
    // Merely removing scheme-dark is not enough: `default: system` themes emit
    // `@media (prefers-color-scheme: dark)` scoped to `:root:not(.scheme-light)`,
    // so forcing light on a dark OS needs scheme-light present.
    stubStorage({ 'uniweb-appearance': 'dark' })
    let classes = stubDocument()
    initAppearance({ default: 'light', allowToggle: true })
    expect(classes.has('scheme-dark')).toBe(true)
    expect(classes.has('scheme-light')).toBe(false)

    stubStorage({ 'uniweb-appearance': 'light' })
    classes = stubDocument()
    initAppearance({ default: 'dark', allowToggle: true })
    expect(classes.has('scheme-light')).toBe(true)
    expect(classes.has('scheme-dark')).toBe(false)
  })

  it('writes nothing when the theme declares no appearance', () => {
    const classes = stubDocument()
    expect(initAppearance(undefined)).toBeNull()
    expect(initAppearance({})).toBeNull()
    expect(classes.size).toBe(0)
  })

  it('writes nothing for a light-only site, even on a dark OS', () => {
    // hasDarkScheme is false, so there is no `.scheme-dark` CSS to apply. We
    // never claim a scheme that has no matching rules.
    stubMatchMedia(true)
    const classes = stubDocument()
    const appearance = {
      default: 'light',
      allowToggle: false,
      respectSystemPreference: true,
      schemes: ['light'],
    }
    expect(initAppearance(appearance)).toBeNull()
    expect(classes.size).toBe(0)
  })
})

describe('resolveAppearanceBoot', () => {
  it('is the single reader of respectSystemPreference', () => {
    expect(resolveAppearanceBoot({ allowToggle: true }).respectSystem).toBe(true)
    expect(resolveAppearanceBoot({ allowToggle: true, respectSystemPreference: true }).respectSystem).toBe(true)
    expect(resolveAppearanceBoot({ allowToggle: true, respectSystemPreference: false }).respectSystem).toBe(false)
  })

  it('gates on dark reachability', () => {
    expect(resolveAppearanceBoot(undefined)).toBeNull()
    expect(resolveAppearanceBoot({ default: 'light', schemes: ['light'] })).toBeNull()
    expect(resolveAppearanceBoot({ default: 'system' })).not.toBeNull()
    expect(resolveAppearanceBoot({ default: 'dark' })).not.toBeNull()
    expect(resolveAppearanceBoot({ allowToggle: true })).not.toBeNull()
    expect(resolveAppearanceBoot({ schemes: ['light', 'dark'] })).not.toBeNull()
  })

  it('collapses the declared default to light or dark', () => {
    expect(resolveAppearanceBoot({ default: 'dark' }).fallback).toBe('dark')
    expect(resolveAppearanceBoot({ default: 'system' }).fallback).toBe('light')
    expect(resolveAppearanceBoot({ allowToggle: true }).fallback).toBe('light')
  })
})

describe('renderAppearanceBootScript', () => {
  it('emits nothing when the site can never show dark', () => {
    expect(renderAppearanceBootScript(undefined)).toBe('')
    expect(renderAppearanceBootScript({ default: 'light', schemes: ['light'] })).toBe('')
    expect(renderAppearanceBootScript({ default: 'light', allowToggle: false })).toBe('')
  })

  it('emits an identified script when the site has dark', () => {
    const script = renderAppearanceBootScript({ allowToggle: true })
    expect(script).toContain('<script id="uniweb-appearance">')
    expect(script).toContain('scheme-dark')
    expect(script).toContain('uniweb-appearance')
  })

  it('interpolates only a boolean and a quoted scheme literal', () => {
    // Author-supplied theme.yml values must not be able to inject script.
    const script = renderAppearanceBootScript({
      allowToggle: true,
      default: '"); alert(1); //',
      respectSystemPreference: '"); alert(2); //',
    })
    expect(script).not.toContain('alert(')
    expect(script).toContain(')(true, "light")')
  })

  it('carries no free identifiers from module scope', () => {
    // The serialized function must be self-contained. If someone refactors a
    // constant or helper out of applyBootScheme, toString() would emit an
    // identifier that is undefined at first paint — and the failure only shows
    // up in a real browser, on a prerendered page, for a dark-mode visitor.
    const body = applyBootScheme.toString()
    for (const leaked of ['APPEARANCE_STORAGE_KEY', 'DARK_SCHEME_CLASS', 'LIGHT_SCHEME_CLASS', 'hasDarkScheme']) {
      expect(body).not.toContain(leaked)
    }
  })
})

describe('the serialized script and the direct call agree', () => {
  // The whole reason renderAppearanceBootScript serializes applyBootScheme
  // instead of hand-writing an inline script: the pre-paint path and the SPA
  // boot path must resolve identically, or a prerendered page flashes one scheme
  // and settles on the other. This executes the emitted script for real and
  // compares it against initAppearance() under the same conditions.
  const scenarios = [
    ['system default, dark OS, no stored choice', { default: 'system', allowToggle: true }, true, {}],
    ['system default, light OS, no stored choice', { default: 'system', allowToggle: true }, false, {}],
    ['stored light beats a dark OS', { default: 'system', allowToggle: true }, true, { 'uniweb-appearance': 'light' }],
    ['stored dark beats a light default', { default: 'light', allowToggle: true }, false, { 'uniweb-appearance': 'dark' }],
    ['dark default, light OS', { default: 'dark', allowToggle: true }, false, {}],
    ['system ignored when opted out', { default: 'light', allowToggle: true, respectSystemPreference: false }, true, {}],
    ['respectSystemPreference unset on a dark OS', { default: 'light', allowToggle: true }, true, {}],
  ]

  for (const [label, appearance, prefersDark, stored] of scenarios) {
    it(label, () => {
      // Direct call (SPA boot)
      stubStorage(stored)
      stubMatchMedia(prefersDark)
      const directClasses = stubDocument()
      const direct = initAppearance(appearance)

      // Serialized call (pre-paint script in prerendered HTML)
      stubStorage(stored)
      stubMatchMedia(prefersDark)
      const scriptClasses = stubDocument()
      const script = renderAppearanceBootScript(appearance)
      const expr = script.replace(/^<script id="uniweb-appearance">/, '').replace(/<\/script>$/, '')
      // eslint-disable-next-line no-eval
      const serialized = (0, eval)(expr)

      expect(serialized).toBe(direct)
      expect([...scriptClasses].sort()).toEqual([...directClasses].sort())
    })
  }
})
