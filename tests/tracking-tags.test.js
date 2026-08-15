/**
 * `tracking.tags` — a site's declared third-party tag scripts.
 *
 * Two units, tested apart because they are separated on purpose: `wireTracker`
 * decides *whether and when* (no DOM, so it is bundled for SSR safely), and
 * `loadTagScripts` does the DOM half (browser entry only). The injection seam
 * between them is what keeps `document` out of the Worker bundle.
 *
 * Design: `kb/framework/plans/tracking-vendor-tags.md`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { wireTracker } from '../src/wire-foundation.js'

const TAG = 'https://vendor.example.com/tag.js'

/** A singleton shaped the way `wireTracker` reads it. */
function makeUniweb(config) {
  return { activeWebsite: { config }, tracking: null }
}

/**
 * `Tracker` reads `window`/`document` at MODULE scope, so a live document has
 * to exist before `wire-foundation.js` pulls it in. Vitest's node environment
 * has neither, which is exactly the SSR case — so the framed/live distinction
 * is installed per-test.
 */
function installDocument({ framed = false } = {}) {
  const win = { location: new URL('https://site.test/a'), addEventListener() {}, removeEventListener() {} }
  win.self = win
  win.top = framed ? { other: true } : win
  globalThis.window = win
  globalThis.document = { referrer: '', visibilityState: 'visible' }
}

beforeEach(() => {
  vi.resetModules()
  installDocument()
})

afterEach(() => {
  delete globalThis.window
  delete globalThis.document
})

/** Re-import so the module-scope browser detection sees the current globals. */
async function wire(config, { basePath = '' } = {}) {
  const mod = await import('../src/wire-foundation.js')
  const uniweb = makeUniweb(config)
  const loadTags = vi.fn()
  mod.wireTracker(uniweb, { basePath, loadTags })
  return { uniweb, loadTags }
}

describe('when tags load', () => {
  it('loads immediately when no consent gate is declared', async () => {
    const { loadTags } = await wire({ tracking: { endpoint: '/collect', tags: [TAG] } })

    expect(loadTags).toHaveBeenCalledTimes(1)
    expect(loadTags.mock.calls[0][0]).toEqual([TAG])
  })

  it('waits for consent, then loads on grant', async () => {
    const { uniweb, loadTags } = await wire({
      tracking: { endpoint: '/collect', consent: 'required', tags: [TAG] }
    })

    // Control: the gate is actually engaged, so the assertion below is not
    // passing because nothing was configured.
    expect(uniweb.tracking.consentStatus()).toBe('pending')
    expect(loadTags).not.toHaveBeenCalled()

    uniweb.tracking.setConsent(true)
    expect(loadTags).toHaveBeenCalledTimes(1)
  })

  it('never loads on deny', async () => {
    const { uniweb, loadTags } = await wire({
      tracking: { endpoint: '/collect', consent: 'required', tags: [TAG] }
    })

    uniweb.tracking.setConsent(false)
    expect(loadTags).not.toHaveBeenCalled()
  })

  it('loads once even if consent is granted twice', async () => {
    const { uniweb, loadTags } = await wire({
      tracking: { consent: 'required', tags: [TAG] }
    })

    uniweb.tracking.setConsent(true)
    uniweb.tracking.setConsent(true)
    expect(loadTags).toHaveBeenCalledTimes(1)
  })

  it('does not load in a framed document — the authoring preview', async () => {
    installDocument({ framed: true })
    const { loadTags } = await wire({ tracking: { endpoint: '/collect', tags: [TAG] } })

    expect(loadTags).not.toHaveBeenCalled()
  })

  it('does not load outside a browser — the SSR / Worker case', async () => {
    delete globalThis.window
    delete globalThis.document
    const { loadTags } = await wire({ tracking: { tags: [TAG] } })

    expect(loadTags).not.toHaveBeenCalled()
  })

  it('is untouched by a site that declares no tags', async () => {
    const { uniweb, loadTags } = await wire({ tracking: '/collect' })

    expect(loadTags).not.toHaveBeenCalled()
    // Control: the endpoint half still wired, so the case above is about tags.
    expect(uniweb.tracking.isEnabled()).toBe(true)
  })
})

describe('what counts as a tag', () => {
  /**
   * Normalization lives in the loader, not in `wireTracker` — it rides the
   * dynamic boundary so a site with no tags never downloads it either. So these
   * test `resolveTagUrls` directly rather than what the injected spy received.
   */
  async function resolve(declared, basePath = '') {
    const { resolveTagUrls } = await import('../src/tag-loader.js')
    return resolveTagUrls(declared, basePath)
  }

  it('accepts a bare string and an object with src, in one list', async () => {
    const other = 'https://vendor.example.com/other.js'
    expect(await resolve([TAG, { src: other }])).toEqual([TAG, other])
  })

  it('accepts a single entry that is not an array', async () => {
    expect(await resolve(TAG)).toEqual([TAG])
  })

  it('joins a site-relative tag to the deployment base, like the endpoint', async () => {
    expect(await resolve(['/js/tag.js'], '/docs')).toEqual(['/docs/js/tag.js'])
  })

  it('leaves an absolute URL alone', async () => {
    expect(await resolve([TAG], '/docs')).toEqual([TAG])
  })

  it('drops entries that carry no URL', async () => {
    expect(await resolve([TAG, '', null, { nope: 1 }])).toEqual([TAG])
  })

  it('is nothing when nothing is declared', async () => {
    expect(await resolve(undefined)).toEqual([])
  })

  it('reaches the loader as the RAW declaration, base and all, for it to resolve', async () => {
    const { loadTags } = await wire({ tracking: { tags: ['/js/tag.js'] } }, { basePath: '/docs' })

    expect(loadTags.mock.calls[0][0]).toEqual(['/js/tag.js'])
    expect(loadTags.mock.calls[0][1]).toMatchObject({ basePath: '/docs' })
  })
})

describe('tags arrive from either tier', () => {
  it('reads them from the host tier', async () => {
    const { loadTags } = await wire({ services: { tracking: { endpoint: '/collect', tags: [TAG] } } })
    expect(loadTags.mock.calls[0][0]).toEqual([TAG])
  })

  it('a site that declares only tags keeps the host collector AND its gate', async () => {
    // The primary workflow: an operator turns on a third-party tag while the
    // host supplies the collector. Their tag must not silently switch off the
    // host's tracking, nor discard the host's consent requirement — which is
    // what an all-or-nothing options read used to do.
    const { uniweb, loadTags } = await wire({
      tracking: { tags: [TAG] },
      services: { tracking: { endpoint: '/host-collect', consent: 'required' } }
    })

    expect(uniweb.tracking.isEnabled()).toBe(true) // the host's endpoint survived
    expect(uniweb.tracking.consentStatus()).toBe('pending') // and so did its gate
    expect(loadTags).not.toHaveBeenCalled() // so the tag waits, correctly

    uniweb.tracking.setConsent(true)
    expect(loadTags).toHaveBeenCalledTimes(1)
  })

  it('wires a tag-only site with no endpoint at all', async () => {
    const { uniweb, loadTags } = await wire({ tracking: { tags: [TAG] } })

    expect(loadTags).toHaveBeenCalledTimes(1)
    // No destination of ours: nothing of ours can be sent, and that is fine.
    expect(uniweb.tracking.isEnabled()).toBe(false)
  })
})

describe('the DOM half', () => {
  /** jsdom is not this suite's environment, so install the minimum surface. */
  function installHead() {
    const appended = []
    globalThis.document = {
      head: { appendChild: (el) => appended.push(el) },
      createElement: () => ({ addEventListener() {} })
    }
    return appended
  }

  it('appends one async script per URL, once per document', async () => {
    const appended = installHead()
    const { loadTagScripts } = await import('../src/tag-loader.js')

    loadTagScripts([TAG])
    loadTagScripts([TAG]) // a second wire, or a re-init

    expect(appended).toHaveLength(1)
    expect(appended[0].src).toBe(TAG)
    expect(appended[0].async).toBe(true)
  })

  it('refuses a data: URL — the field takes a script to fetch, never code', async () => {
    const appended = installHead()
    const { loadTagScripts } = await import('../src/tag-loader.js')

    loadTagScripts(['data:text/javascript,alert(1)', 'javascript:alert(1)'])

    expect(appended).toHaveLength(0)
    // Control: the same call shape does append a real URL, so the assertion
    // above is about the scheme and not about a broken loader.
    loadTagScripts(['https://vendor.example.com/ok.js'])
    expect(appended).toHaveLength(1)
  })

  it('does nothing at all with no document', async () => {
    delete globalThis.document
    const { loadTagScripts } = await import('../src/tag-loader.js')

    expect(() => loadTagScripts([TAG])).not.toThrow()
  })
})
