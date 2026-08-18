/**
 * `tracking.scripts` — a site's declared third-party scripts.
 *
 * Two units, tested apart because they are separated on purpose: `wireTracker`
 * decides *whether and when* (no DOM, so it is bundled for SSR safely), and
 * `loadScripts` does the DOM half (browser entry only). The injection seam
 * between them is what keeps `document` out of the Worker bundle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { wireTracker } from '../src/wire-foundation.js'

const SCRIPT = 'https://vendor.example.com/tag.js'

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
  delete globalThis.location
})

/** Re-import so the module-scope browser detection sees the current globals. */
async function wire(config, { basePath = '' } = {}) {
  const mod = await import('../src/wire-foundation.js')
  const uniweb = makeUniweb(config)
  const loadScripts = vi.fn()
  mod.wireTracker(uniweb, { basePath, loadScripts })
  return { uniweb, loadScripts }
}

describe('when scripts load', () => {
  it('loads immediately when no consent gate is declared', async () => {
    const { loadScripts } = await wire({ tracking: { endpoint: '/collect', scripts: [SCRIPT] } })

    expect(loadScripts).toHaveBeenCalledTimes(1)
    expect(loadScripts.mock.calls[0][0]).toEqual([SCRIPT])
  })

  it('waits for consent, then loads on grant', async () => {
    const { uniweb, loadScripts } = await wire({
      tracking: { endpoint: '/collect', consent: 'required', scripts: [SCRIPT] }
    })

    // Control: the gate is actually engaged, so the assertion below is not
    // passing because nothing was configured.
    expect(uniweb.tracking.consentStatus()).toBe('pending')
    expect(loadScripts).not.toHaveBeenCalled()

    uniweb.tracking.setConsent(true)
    expect(loadScripts).toHaveBeenCalledTimes(1)
  })

  it('never loads on deny', async () => {
    const { uniweb, loadScripts } = await wire({
      tracking: { endpoint: '/collect', consent: 'required', scripts: [SCRIPT] }
    })

    uniweb.tracking.setConsent(false)
    expect(loadScripts).not.toHaveBeenCalled()
  })

  it('loads once even if consent is granted twice', async () => {
    const { uniweb, loadScripts } = await wire({
      tracking: { consent: 'required', scripts: [SCRIPT] }
    })

    uniweb.tracking.setConsent(true)
    uniweb.tracking.setConsent(true)
    expect(loadScripts).toHaveBeenCalledTimes(1)
  })

  it('does not load in a framed document — the authoring preview', async () => {
    installDocument({ framed: true })
    const { loadScripts } = await wire({ tracking: { endpoint: '/collect', scripts: [SCRIPT] } })

    expect(loadScripts).not.toHaveBeenCalled()
  })

  it('does not load outside a browser — the SSR / Worker case', async () => {
    delete globalThis.window
    delete globalThis.document
    const { loadScripts } = await wire({ tracking: { scripts: [SCRIPT] } })

    expect(loadScripts).not.toHaveBeenCalled()
  })

  it('is untouched by a site that declares none', async () => {
    const { uniweb, loadScripts } = await wire({ tracking: '/collect' })

    expect(loadScripts).not.toHaveBeenCalled()
    // Control: the endpoint half still wired, so the case above is about scripts.
    expect(uniweb.tracking.isEnabled()).toBe(true)
  })
})

describe('what counts as a script entry', () => {
  /**
   * Normalization lives in the loader, not in `wireTracker` — it rides the
   * dynamic boundary so a site with none never downloads it either. So these
   * test `resolveScriptUrls` directly rather than what the injected spy received.
   */
  async function resolve(declared, basePath = '') {
    const { resolveScriptUrls } = await import('../src/script-loader.js')
    return resolveScriptUrls(declared, basePath)
  }

  it('accepts a bare string and an object with src, in one list', async () => {
    const other = 'https://vendor.example.com/other.js'
    expect(await resolve([SCRIPT, { src: other }])).toEqual([SCRIPT, other])
  })

  it('accepts a single entry that is not an array', async () => {
    expect(await resolve(SCRIPT)).toEqual([SCRIPT])
  })

  it('joins a site-relative entry to the deployment base, like the endpoint', async () => {
    expect(await resolve(['/js/tag.js'], '/docs')).toEqual(['/docs/js/tag.js'])
  })

  it('leaves an absolute URL alone', async () => {
    expect(await resolve([SCRIPT], '/docs')).toEqual([SCRIPT])
  })

  it('drops entries that carry no URL', async () => {
    expect(await resolve([SCRIPT, '', null, { nope: 1 }])).toEqual([SCRIPT])
  })

  it('is nothing when nothing is declared', async () => {
    expect(await resolve(undefined)).toEqual([])
  })

  it('reaches the loader as the RAW declaration, base and all, for it to resolve', async () => {
    const { loadScripts } = await wire({ tracking: { scripts: ['/js/tag.js'] } }, { basePath: '/docs' })

    expect(loadScripts.mock.calls[0][0]).toEqual(['/js/tag.js'])
    expect(loadScripts.mock.calls[0][1]).toMatchObject({ basePath: '/docs' })
  })
})

describe('scripts arrive from either tier', () => {
  it('reads them from the host tier', async () => {
    const { loadScripts } = await wire({ services: { tracking: { endpoint: '/collect', scripts: [SCRIPT] } } })
    expect(loadScripts.mock.calls[0][0]).toEqual([SCRIPT])
  })

  it('a site that declares only scripts keeps the host collector AND its gate', async () => {
    // The primary workflow: an operator turns on a third-party script while the
    // host supplies the collector. Their script must not silently switch off the
    // host's tracking, nor discard the host's consent requirement — which is
    // what an all-or-nothing options read used to do.
    const { uniweb, loadScripts } = await wire({
      tracking: { scripts: [SCRIPT] },
      services: { tracking: { endpoint: '/host-collect', consent: 'required' } }
    })

    expect(uniweb.tracking.isEnabled()).toBe(true) // the host's endpoint survived
    expect(uniweb.tracking.consentStatus()).toBe('pending') // and so did its gate
    expect(loadScripts).not.toHaveBeenCalled() // so it waits, correctly

    uniweb.tracking.setConsent(true)
    expect(loadScripts).toHaveBeenCalledTimes(1)
  })

  it('wires a script-only site with no endpoint at all', async () => {
    const { uniweb, loadScripts } = await wire({ tracking: { scripts: [SCRIPT] } })

    expect(loadScripts).toHaveBeenCalledTimes(1)
    // No destination of ours: nothing of ours can be sent, and that is fine.
    expect(uniweb.tracking.isEnabled()).toBe(false)
  })
})

describe('the DOM half', () => {
  /**
   * jsdom is not this suite's environment, so install the minimum surface.
   *
   * ⛔ `location` is part of that minimum, not a nicety: `isLoadable` resolves
   * a URL against the document before testing its scheme, and a protocol-relative
   * URL has no scheme to test without one. A harness with a `document` and no
   * `location` models a state no browser is ever in, and it made a passing check
   * look like a refusal.
   */
  function installHead() {
    const appended = []
    globalThis.document = {
      head: { appendChild: (el) => appended.push(el) },
      createElement: () => ({ addEventListener() {} })
    }
    globalThis.location = new URL('https://site.test/page')
    return appended
  }

  it('appends one async script per URL, once per document', async () => {
    const appended = installHead()
    const { loadScripts } = await import('../src/script-loader.js')

    loadScripts([SCRIPT])
    loadScripts([SCRIPT]) // a second wire, or a re-init

    expect(appended).toHaveLength(1)
    expect(appended[0].src).toBe(SCRIPT)
    expect(appended[0].async).toBe(true)
  })

  it('refuses a data: URL — the field takes a script to fetch, never code', async () => {
    const appended = installHead()
    const { loadScripts } = await import('../src/script-loader.js')

    loadScripts(['data:text/javascript,alert(1)', 'javascript:alert(1)'])

    expect(appended).toHaveLength(0)

    // Control: the same call shape does append a real URL, so the assertion
    // above is about the scheme and not about a broken loader.
    loadScripts(['https://vendor.example.com/ok.js'])
    expect(appended.map((s) => s.src)).toEqual(['https://vendor.example.com/ok.js'])
  })

  it('admits a protocol-relative URL by TESTING it, not by bypassing the test', async () => {
    // `//other.example.com/x.js` is cross-origin and starts with a slash. An
    // earlier check short-circuited anything slash-leading as "site-relative,
    // same origin by construction" — true of `/x.js`, false of `//host/x.js`,
    // which skipped the scheme test entirely on the strength of a comment that
    // was not true of it. It must still LOAD, since it inherits the page's
    // scheme and is a fetched script; the fix is that it now passes the check
    // rather than going around it.
    const appended = installHead()
    const { loadScripts } = await import('../src/script-loader.js')

    loadScripts(['//other.example.com/x.js'])

    expect(appended.map((s) => s.src)).toEqual(['//other.example.com/x.js'])
  })

  it('does nothing at all with no document', async () => {
    delete globalThis.document
    const { loadScripts } = await import('../src/script-loader.js')

    expect(() => loadScripts([SCRIPT])).not.toThrow()
  })
})
