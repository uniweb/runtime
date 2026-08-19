/**
 * `tracking.emit` — the site's selection, and how it composes with the host's.
 *
 * The three rules pinned here are each one where the wrong reading is silent:
 * a typo must not take a site dark, an absent host list must not mean "store
 * nothing", and neither tier may answer the other's question.
 *
 * ⚠️ **`wire-foundation.js` is imported dynamically, and it has to be.**
 * `@uniweb/core/tracker` decides `isBrowser` at MODULE LOAD, so a static import
 * would capture "no DOM" before any `beforeEach` could run — and every
 * assertion here would read `false` for the wrong reason, with the two
 * expecting `false` still passing. Set the globals first, import second.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

let wireTracker

beforeAll(async () => {
  globalThis.window = { addEventListener: () => {}, location: { search: '', origin: 'https://x' } }
  globalThis.window.top = globalThis.window.self = globalThis.window
  globalThis.document = { referrer: '', addEventListener: () => {}, visibilityState: 'visible' }
  vi.useFakeTimers()
  ;({ wireTracker } = await import('../src/wire-foundation.js'))
})

afterAll(() => {
  vi.useRealTimers()
  delete globalThis.window
  delete globalThis.document
})

/**
 * `createUniweb` installs a DISABLED `Tracker` that `wireTracker` replaces only
 * when a destination resolves. The sentinel stands in for it, so "nothing was
 * armed" can be asserted as "the default was left alone" — which is the actual
 * contract, and stronger than checking a disabled tracker answers false.
 */
const DISABLED_DEFAULT = Symbol('the disabled tracker createUniweb installs')
const site = (config) => ({
  activeWebsite: { config, basePath: '' },
  tracking: DISABLED_DEFAULT
})

const wire = (config) => {
  const uniweb = site(config)
  wireTracker(uniweb)
  return uniweb.tracking
}

describe('site tracking.emit', () => {
  it('defaults to the standard preset when only a destination is declared', () => {
    const t = wire({ tracking: 'https://collect.example/e' })
    expect(t.arms('page_view')).toBe(true)
    expect(t.arms('outbound_click')).toBe(true)
    expect(t.arms('section_view')).toBe(true)
  })

  it('narrows to the named preset', () => {
    const t = wire({ tracking: { endpoint: '/e', emit: 'minimal' } })
    expect(t.arms('page_view')).toBe(true)
    expect(t.arms('outbound_click')).toBe(false)
  })

  it('accepts an explicit list', () => {
    const t = wire({ tracking: { endpoint: '/e', emit: ['section_view'] } })
    expect(t.arms('section_view')).toBe(true)
    expect(t.arms('page_view')).toBe(false)
  })

  // `all` must be no-narrowing rather than a frozen list, or an event added in a
  // later release would need every site to republish before it took effect.
  it('treats `all` as no narrowing, including names it has never heard of', () => {
    const t = wire({ tracking: { endpoint: '/e', emit: 'all' } })
    expect(t.arms('page_view')).toBe(true)
    expect(t.arms('an_event_shipped_next_year')).toBe(true)
  })

  // The failure mode of a misread selection has to be "the usual set", never
  // "none, and nothing said so".
  it('falls back to the default on an unknown preset rather than going dark', () => {
    const t = wire({ tracking: { endpoint: '/e', emit: 'sandard' } })
    expect(t.arms('page_view')).toBe(true)
    expect(t.arms('outbound_click')).toBe(true)
  })
})

describe('host events, and how the two tiers compose', () => {
  it('lets the host narrow what the site selected', () => {
    const t = wire({
      services: { tracking: { endpoint: '/e', events: ['page_view'] } },
      tracking: { emit: 'all' }
    })
    expect(t.arms('page_view')).toBe(true)
    expect(t.arms('outbound_click')).toBe(false)
  })

  // ⛔ The one that takes every site on an older backend dark if read the other
  // way: absent is not an empty set.
  it('reads an absent host list as NO narrowing, never as an empty set', () => {
    const t = wire({ services: { tracking: { endpoint: '/e' } } })
    expect(t.arms('page_view')).toBe(true)
    expect(t.arms('section_view')).toBe(true)
  })

  // The site would otherwise widen past what the host stores by writing the
  // host's key into its own block.
  it('ignores an `events` key written at the site tier', () => {
    const t = wire({
      services: { tracking: { endpoint: '/e', events: ['page_view'] } },
      tracking: { events: ['outbound_click'] }
    })
    expect(t.arms('outbound_click')).toBe(false)
  })

  it('ignores an `emit` key written at the host tier', () => {
    const t = wire({ services: { tracking: { endpoint: '/e', emit: 'minimal' } } })
    expect(t.arms('outbound_click')).toBe(true)
  })

  it('leaves the disabled default alone when no destination resolves', () => {
    const uniweb = site({ tracking: { emit: 'all' } })
    wireTracker(uniweb)
    expect(uniweb.tracking).toBe(DISABLED_DEFAULT)
  })
})

describe('the page override', () => {
  const armsSection = (config, override) => wire(config).arms('section_view', override)

  it('widens a site that did not select section_view', () => {
    const config = { tracking: { endpoint: '/e', emit: 'minimal' } }
    expect(armsSection(config, undefined)).toBe(false)
    expect(armsSection(config, true)).toBe(true)
  })

  it('exempts one page of a site that did select it', () => {
    const config = { tracking: { endpoint: '/e', emit: 'standard' } }
    expect(armsSection(config, undefined)).toBe(true)
    expect(armsSection(config, false)).toBe(false)
  })

  it('cannot conjure a row the host declined to store', () => {
    const config = { services: { tracking: { endpoint: '/e', events: ['page_view'] } } }
    expect(armsSection(config, true)).toBe(false)
  })
})

/**
 * The hosted shape: the backend supplies the address, the owner says what to
 * send. Untested until 2026-08-19 and it is the majority case on our own host —
 * a site there never writes an endpoint at all.
 */
describe('hosted — the host supplies the endpoint, the site supplies the selection', () => {
  it('takes the address from the host and the selection from the site', () => {
    const t = wire({
      services: { tracking: { endpoint: '/_a/e' } },
      tracking: { emit: 'minimal' }
    })
    expect(t.endpoint).toBe('/_a/e')
    expect(t.arms('page_view')).toBe(true)
    expect(t.arms('outbound_click')).toBe(false)
  })

  it('defaults to standard when the site declares nothing at all', () => {
    const t = wire({ services: { tracking: { endpoint: '/_a/e' } } })
    expect(t.endpoint).toBe('/_a/e')
    expect(t.arms('section_view')).toBe(true)
  })

  // ⛔ The one that would be silent: a site block containing only `emit` must not
  // read as "the site overrode the whole service". Tiers merge PER KEY, so
  // anything else the host declared survives a site that only picked events.
  //
  // ⚠️ `consent` is the probe here because it is observable, **not because our
  // own backend sets one — it does not.** It supplies an endpoint and its
  // `events` list and says nothing further about tracking. The rule under test
  // is the merge, which has to hold for whatever a host declares; the framework
  // is host-agnostic and cannot enumerate that in advance.
  it('leaves other host keys intact when the site block names only emit', () => {
    const t = wire({
      services: { tracking: { endpoint: '/_a/e', consent: 'required' } },
      tracking: { emit: 'all' }
    })
    expect(t.consentStatus()).toBe('pending')
    expect(t.arms('anything_at_all')).toBe(true)
  })

  // Standalone-first, stated as a test: a site pointing at its own collector
  // keeps emitting whether or not a host offers one.
  it('prefers the site own endpoint when both tiers name one', () => {
    const t = wire({
      services: { tracking: { endpoint: '/_a/e' } },
      tracking: { endpoint: 'https://plausible.io/api/event' }
    })
    expect(t.endpoint).toBe('https://plausible.io/api/event')
  })
})
