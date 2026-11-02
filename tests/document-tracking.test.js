import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { outboundHostname, observeOutboundClicks } from '../src/document-tracking.js'

/**
 * `outbound_click` — the listener half.
 *
 * The privacy claim is why this file exists: a hostname is reported and nothing
 * else, whatever the link carries. That is asserted against `outboundHostname`
 * directly, and again through the listener, so a refactor cannot satisfy the
 * unit and still leak through the event.
 */

const HERE = { href: 'https://example.com/pricing', hostname: 'example.com' }

describe('outboundHostname', () => {
  it('reports the host for a link that leaves the site', () => {
    expect(outboundHostname('https://stripe.com/docs', HERE)).toBe('stripe.com')
  })

  it('returns null for a same-host link, absolute or relative', () => {
    expect(outboundHostname('/about', HERE)).toBeNull()
    expect(outboundHostname('about', HERE)).toBeNull()
    expect(outboundHostname('https://example.com/about', HERE)).toBeNull()
    expect(outboundHostname('#section', HERE)).toBeNull()
  })

  it('treats a different subdomain as outbound', () => {
    expect(outboundHostname('https://docs.example.com/', HERE)).toBe('docs.example.com')
  })

  it('ignores protocols that are not a navigation', () => {
    expect(outboundHostname('mailto:hi@other.com', HERE)).toBeNull()
    expect(outboundHostname('tel:+15551234', HERE)).toBeNull()
    expect(outboundHostname('javascript:void(0)', HERE)).toBeNull()
  })

  it('survives an unparseable href instead of throwing into a click handler', () => {
    expect(outboundHostname('http://[bad', HERE)).toBeNull()
    expect(outboundHostname('', HERE)).toBeNull()
    expect(outboundHostname(null, HERE)).toBeNull()
  })

  it('NEVER returns anything but the host - no path, query, hash, port', () => {
    const loud = 'https://other.com:8443/search?q=my+private+term&token=abc123#frag'
    const got = outboundHostname(loud, HERE)
    expect(got).toBe('other.com')
    for (const secret of ['my+private+term', 'token', 'abc123', '/search', '8443', 'frag']) {
      expect(got).not.toContain(secret)
    }
  })
})

/**
 * A minimal document: enough to register capture-phase listeners and dispatch
 * to them. Hand-rolled rather than jsdom because this package's suite runs on
 * `environment: 'node'` and its sibling (`section-views.test.js`) fakes the
 * same way. A DOM dependency for one file would change how every test here runs.
 */
function fakeDocument() {
  const listeners = []
  return {
    location: { href: HERE.href, hostname: HERE.hostname },
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    removeEventListener: (type, fn, capture) => {
      const i = listeners.findIndex(
        (l) => l.type === type && l.fn === fn && l.capture === capture
      )
      if (i >= 0) listeners.splice(i, 1)
    },
    dispatch: (type, target) => {
      for (const l of [...listeners]) if (l.type === type) l.fn({ target })
    },
    listeners
  }
}

/** An element whose `closest` resolves to an anchor carrying this href. */
const targetIn = (href) => ({
  closest: (sel) => (sel === 'a[href]' && href != null ? { getAttribute: () => href } : null)
})

describe('observeOutboundClicks', () => {
  let tracking, doc, stop

  beforeEach(() => {
    tracking = { track: vi.fn(), isEnabled: () => true }
    doc = fakeDocument()
    globalThis.document = doc
  })

  afterEach(() => {
    if (stop) stop()
    stop = null
    delete globalThis.document
  })

  it('reports the host of an outbound link', () => {
    stop = observeOutboundClicks(tracking)
    doc.dispatch('click', targetIn('https://stripe.com/docs'))
    expect(tracking.track).toHaveBeenCalledWith('outbound_click', { hostname: 'stripe.com' })
  })

  it('says nothing about internal navigation', () => {
    stop = observeOutboundClicks(tracking)
    doc.dispatch('click', targetIn('/pricing'))
    expect(tracking.track).not.toHaveBeenCalled()
  })

  it('says nothing when the click is not inside an anchor', () => {
    stop = observeOutboundClicks(tracking)
    doc.dispatch('click', targetIn(null))
    doc.dispatch('click', {})
    expect(tracking.track).not.toHaveBeenCalled()
  })

  it('counts a middle click, which fires auxclick rather than click', () => {
    stop = observeOutboundClicks(tracking)
    doc.dispatch('auxclick', targetIn('https://stripe.com/docs'))
    expect(tracking.track).toHaveBeenCalledWith('outbound_click', { hostname: 'stripe.com' })
  })

  it('registers on the CAPTURE phase, so stopPropagation cannot zero the count', () => {
    stop = observeOutboundClicks(tracking)
    expect(doc.listeners).toHaveLength(2)
    for (const l of doc.listeners) expect(l.capture).toBe(true)
    expect(doc.listeners.map((l) => l.type).sort()).toEqual(['auxclick', 'click'])
  })

  it('leaks nothing from a noisy href through the EVENT either', () => {
    stop = observeOutboundClicks(tracking)
    doc.dispatch('click', targetIn('https://other.com/search?q=private&token=abc123#frag'))
    const payload = JSON.stringify(tracking.track.mock.calls[0][1])
    expect(payload).toContain('other.com')
    for (const secret of ['private', 'token', 'abc123', 'frag', 'search']) {
      expect(payload).not.toContain(secret)
    }
  })

  it('removes both listeners on teardown', () => {
    const off = observeOutboundClicks(tracking)
    expect(doc.listeners).toHaveLength(2)
    off()
    expect(doc.listeners).toHaveLength(0)
    doc.dispatch('click', targetIn('https://stripe.com/docs'))
    expect(tracking.track).not.toHaveBeenCalled()
  })

  it('returns null rather than arming when there is nothing to report to', () => {
    expect(observeOutboundClicks(null)).toBeNull()
    expect(observeOutboundClicks({})).toBeNull()
  })

  it('returns null when there is no DOM at all (the SSR path)', () => {
    delete globalThis.document
    expect(observeOutboundClicks(tracking)).toBeNull()
  })
})

/**
 * A minimal window + document for the scroll half — same reasoning as
 * `fakeDocument` above: this suite runs on `environment: 'node'`, and adding a
 * DOM dependency for one file would change how every test in the package runs.
 */
function fakeScrollEnv({ scrollHeight, innerHeight }) {
  const listeners = []
  globalThis.document = { documentElement: { scrollHeight } }
  globalThis.window = {
    innerHeight,
    scrollY: 0,
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn)
      if (i >= 0) listeners.splice(i, 1)
    }
  }
  return {
    scrollTo: (y) => {
      globalThis.window.scrollY = y
      // Past the throttle window, so each scripted scroll is actually measured.
      vi.setSystemTime(Date.now() + 1000)
      for (const l of [...listeners]) if (l.type === 'scroll') l.fn()
    },
    listeners
  }
}

/**
 * `section_click` — the listener half.
 *
 * ⭐ **The failure this file exists to prevent is a SILENT ZERO.** A lookup that
 * resolves nothing throws nothing and logs nothing: it reports no clicks on
 * every section of every site while the payload stays internally consistent.
 * Two wrong versions were proposed before this shipped — `[data-section-id]`
 * (an attribute this renderer does not emit) and `[id^="section-"]` (a second
 * copy of the id rule, which has drifted before) — so the positive case is
 * asserted against an id built by `sectionDomId` itself, never by a literal.
 */

import { observeSectionClicks } from '../src/document-tracking.js'
import { sectionDomId } from '@uniweb/core/section-id'

/** A block as the graph holds it, with the `track` the runtime calls. */
const fakeBlock = (stableId) => ({ stableId, track: vi.fn() })

/** A page whose sections resolve to elements, as `bodyBlocks` does. */
const fakePage = (blocks) => ({ bodyBlocks: blocks })

/**
 * An element chain: `child` nested inside a section wrapper carrying the id.
 * `parentElement` is what the walk climbs — the click lands on a child far more
 * often than on the wrapper.
 */
function elementIn(domId, { depth = 2 } = {}) {
  const wrapper = { nodeType: 1, id: domId, parentElement: null }
  let el = wrapper
  for (let i = 0; i < depth; i++) el = { nodeType: 1, id: '', parentElement: el }
  return el
}

describe('observeSectionClicks', () => {
  let doc, stop, present

  beforeEach(() => {
    present = new Set()
    doc = fakeDocument()
    // `getElementById` is what decides a section is RENDERED, matching the
    // graph-derived lookup in `sectionsById`.
    doc.getElementById = (id) => (present.has(id) ? { id } : null)
    globalThis.document = doc
  })

  afterEach(() => {
    if (stop) stop()
    stop = null
    delete globalThis.document
  })

  it('reports the click through the BLOCK, so the envelope carries path/section/section_id', () => {
    const hero = fakeBlock('hero')
    present.add(sectionDomId(hero))
    stop = observeSectionClicks(() => fakePage([hero]))

    doc.dispatch('click', elementIn(sectionDomId(hero)))
    expect(hero.track).toHaveBeenCalledWith('section_click')
  })

  // ⭐ The regression that motivated the whole lookup design. `SplitContent` in
  // `split.md` has stableId `split`, so the id is `section-split` — NOT derived
  // from the type. A selector written against the type, or against a
  // `data-section-id` attribute, matches nothing and counts zero forever.
  it('resolves by the GRAPH id, which is not derived from the section type', () => {
    const block = { stableId: 'split', type: 'SplitContent', track: vi.fn() }
    expect(sectionDomId(block)).toBe('section-split')
    present.add('section-split')
    stop = observeSectionClicks(() => fakePage([block]))

    doc.dispatch('click', elementIn('section-split'))
    expect(block.track).toHaveBeenCalledWith('section_click')
  })

  it('attributes to the INNERMOST section when one is nested inside another', () => {
    const outer = fakeBlock('outer')
    const inner = fakeBlock('inner')
    present.add(sectionDomId(outer)).add(sectionDomId(inner))
    stop = observeSectionClicks(() => fakePage([outer, inner]))

    // inner wrapper nested inside the outer wrapper
    const outerEl = { nodeType: 1, id: sectionDomId(outer), parentElement: null }
    const innerEl = { nodeType: 1, id: sectionDomId(inner), parentElement: outerEl }
    const child = { nodeType: 1, id: '', parentElement: innerEl }

    doc.dispatch('click', child)
    expect(inner.track).toHaveBeenCalledWith('section_click')
    expect(outer.track).not.toHaveBeenCalled()
  })

  it('says nothing for a click outside every section', () => {
    const hero = fakeBlock('hero')
    present.add(sectionDomId(hero))
    stop = observeSectionClicks(() => fakePage([hero]))

    doc.dispatch('click', elementIn('site-footer'))
    expect(hero.track).not.toHaveBeenCalled()
  })

  it('skips a block whose element is not rendered', () => {
    const hero = fakeBlock('hero')
    // deliberately NOT added to `present`
    stop = observeSectionClicks(() => fakePage([hero]))

    doc.dispatch('click', elementIn(sectionDomId(hero)))
    expect(hero.track).not.toHaveBeenCalled()
  })

  // ⭐ One listener spans every SPA navigation, so the page is read at CLICK
  // time. Capturing it at arm time would attribute every later click to
  // whichever page the visitor first landed on — silently, and only after a
  // navigation, which is exactly when nobody is looking.
  it('follows the ACTIVE page across a navigation', () => {
    const first = fakeBlock('hero')
    const second = fakeBlock('pricing')
    present.add(sectionDomId(first)).add(sectionDomId(second))

    let active = fakePage([first])
    stop = observeSectionClicks(() => active)

    doc.dispatch('click', elementIn(sectionDomId(first)))
    expect(first.track).toHaveBeenCalledTimes(1)

    active = fakePage([second])
    doc.dispatch('click', elementIn(sectionDomId(second)))
    expect(second.track).toHaveBeenCalledTimes(1)
    expect(first.track).toHaveBeenCalledTimes(1)
  })

  it('counts a middle click, which fires auxclick rather than click', () => {
    const hero = fakeBlock('hero')
    present.add(sectionDomId(hero))
    stop = observeSectionClicks(() => fakePage([hero]))

    doc.dispatch('auxclick', elementIn(sectionDomId(hero)))
    expect(hero.track).toHaveBeenCalledWith('section_click')
  })

  it('registers on the CAPTURE phase, so stopPropagation cannot zero the count', () => {
    stop = observeSectionClicks(() => fakePage([]))
    expect(doc.listeners.every((l) => l.capture === true)).toBe(true)
    expect(doc.listeners.map((l) => l.type).sort()).toEqual(['auxclick', 'click'])
  })

  it('removes both listeners on teardown', () => {
    const teardown = observeSectionClicks(() => fakePage([]))
    expect(doc.listeners).toHaveLength(2)
    teardown()
    expect(doc.listeners).toHaveLength(0)
  })

  it('survives a page with no active page yet', () => {
    stop = observeSectionClicks(() => null)
    expect(() => doc.dispatch('click', elementIn('section-hero'))).not.toThrow()
  })

  it('returns null when there is no DOM at all (the SSR path)', () => {
    delete globalThis.document
    expect(observeSectionClicks(() => fakePage([]))).toBeNull()
  })
})

import { observeConversions, observeDocument } from '../src/document-tracking.js'

/**
 * `conversion` — the privacy claim is the same one as `outbound_click`'s: the name
 * is reported and nothing else, whatever the link holds.
 */
describe('observeConversions', () => {
  let doc, stop

  /** `selected` answers `arms('conversion')`; a list arms itself through the override. */
  const trackingWith = ({ selected = true, hostTakesIt = true } = {}) => ({
    track: vi.fn(),
    currentPath: null,
    onPage: null,
    arms: (event, override) => {
      if (event !== 'conversion' || !hostTakesIt) return false
      return override != null ? !!override : selected
    }
  })

  /** A website with the core rule that matters here: the locale comes off a route. */
  const websiteWith = (conversions) => ({
    config: { tracking: { conversions } },
    normalizeRoute: (route) => route.replace(/^\/+|\/+$/g, '').replace(/^es\//, '')
  })

  const names = (tracking) => tracking.track.mock.calls.map(([event, data]) => `${event}:${data.name}`)

  beforeEach(() => {
    doc = fakeDocument()
    globalThis.document = doc
  })

  afterEach(() => {
    if (stop) stop()
    stop = null
    delete globalThis.document
  })

  it('reports a phone tap and an email tap with no list', () => {
    const tracking = trackingWith()
    stop = observeConversions(tracking, () => websiteWith())
    doc.dispatch('click', targetIn('tel:+15551234'))
    doc.dispatch('click', targetIn('mailto:hi@example.com'))
    expect(names(tracking)).toEqual(['conversion:phone', 'conversion:email'])
  })

  it('NEVER sends the number, the address or the link', () => {
    const tracking = trackingWith()
    stop = observeConversions(tracking, () => websiteWith())
    doc.dispatch('click', targetIn('tel:+15551234'))
    doc.dispatch('click', targetIn('mailto:hi@example.com?subject=private'))
    const sent = JSON.stringify(tracking.track.mock.calls)
    for (const secret of ['5551234', 'hi@example.com', 'private']) expect(sent).not.toContain(secret)
  })

  it('reports each name once per document load', () => {
    const tracking = trackingWith()
    stop = observeConversions(tracking, () => websiteWith())
    doc.dispatch('click', targetIn('tel:+15551234'))
    doc.dispatch('click', targetIn('tel:+15551234'))
    expect(names(tracking)).toEqual(['conversion:phone'])
  })

  it('reports a listed link by its address, whatever query or fragment it carries', () => {
    const tracking = trackingWith()
    const list = [{ name: 'signup', link: 'https://app.test/signup' }]
    stop = observeConversions(tracking, () => websiteWith(list))
    doc.dispatch('click', targetIn('https://app.test/login'))
    expect(tracking.track).not.toHaveBeenCalled() // control: another page on that host
    doc.dispatch('click', targetIn('https://app.test/signup/?plan=pro#top'))
    expect(names(tracking)).toEqual(['conversion:signup'])
  })

  it('lets a listed name win over the automatic one', () => {
    const tracking = trackingWith()
    const list = [{ name: 'call_office', link: 'tel:+15551234' }]
    stop = observeConversions(tracking, () => websiteWith(list))
    doc.dispatch('click', targetIn('tel:+15551234'))
    doc.dispatch('click', targetIn('tel:+15559999'))
    expect(names(tracking)).toEqual(['conversion:call_office', 'conversion:phone'])
  })

  it('reports a listed page when the visitor reaches it, in any language', () => {
    const tracking = trackingWith()
    stop = observeConversions(tracking, () => websiteWith([{ name: 'booked', page: '/thanks' }]))
    tracking.onPage('/about')
    expect(tracking.track).not.toHaveBeenCalled() // control: another page
    tracking.onPage('/es/thanks/')
    tracking.onPage('/thanks')
    expect(names(tracking)).toEqual(['conversion:booked'])
  })

  it('counts the page the visitor landed on, which arrives before this chunk does', () => {
    const tracking = trackingWith()
    tracking.currentPath = '/thanks'
    stop = observeConversions(tracking, () => websiteWith([{ name: 'booked', page: '/thanks' }]))
    expect(names(tracking)).toEqual(['conversion:booked'])
  })

  it('ignores a right click, which opens a menu rather than the link', () => {
    const tracking = trackingWith()
    stop = observeConversions(tracking, () => websiteWith())
    for (const l of doc.listeners) if (l.type === 'auxclick') l.fn({ button: 2, target: targetIn('tel:+1') })
    expect(tracking.track).not.toHaveBeenCalled()
    for (const l of doc.listeners) if (l.type === 'auxclick') l.fn({ button: 1, target: targetIn('tel:+1') })
    expect(names(tracking)).toEqual(['conversion:phone'])
  })

  it('arms nothing on a host that does not take the event, list or no list', () => {
    const tracking = trackingWith({ hostTakesIt: false })
    const list = [{ name: 'booked', page: '/thanks' }]
    stop = observeConversions(tracking, () => websiteWith(list))
    expect(stop).toBeNull()
    expect(doc.listeners).toHaveLength(0)
    expect(tracking.onPage).toBeNull()
  })

  it('a site not selecting the event gets only what it listed', () => {
    const tracking = trackingWith({ selected: false })
    const list = [{ name: 'signup', link: 'https://app.test/signup' }]
    stop = observeConversions(tracking, () => websiteWith(list))
    doc.dispatch('click', targetIn('tel:+15551234'))
    expect(tracking.track).not.toHaveBeenCalled()
    doc.dispatch('click', targetIn('https://app.test/signup'))
    expect(names(tracking)).toEqual(['conversion:signup'])
  })

  it('a site not selecting the event, with no list, arms nothing', () => {
    const tracking = trackingWith({ selected: false })
    stop = observeConversions(tracking, () => websiteWith())
    expect(stop).toBeNull()
    expect(doc.listeners).toHaveLength(0)
  })

  it('takes down its listeners and the page slot', () => {
    const tracking = trackingWith()
    const teardown = observeConversions(tracking, () => websiteWith([{ name: 'booked', page: '/thanks' }]))
    expect(tracking.onPage).toBeTypeOf('function')
    teardown()
    expect(doc.listeners).toHaveLength(0)
    expect(tracking.onPage).toBeNull()
  })

  it('survives an unparseable href or list entry instead of throwing into a click', () => {
    const tracking = trackingWith()
    stop = observeConversions(tracking, () => websiteWith([{ name: 'x', link: 'not a url' }]))
    expect(() => doc.dispatch('click', targetIn('http://[bad'))).not.toThrow()
    expect(tracking.track).not.toHaveBeenCalled()
  })
})

describe('observeDocument', () => {
  let doc

  beforeEach(() => {
    doc = fakeDocument()
    globalThis.document = doc
    globalThis.uniweb = { activeWebsite: { config: {} } }
  })

  afterEach(() => {
    delete globalThis.document
    delete globalThis.uniweb
  })

  const armed = (...events) => ({
    track: vi.fn(),
    arms: (event) => events.includes(event)
  })

  it('arms each event by its own question', () => {
    const tracking = armed('outbound_click')
    const stop = observeDocument(tracking)
    doc.dispatch('click', targetIn('https://stripe.com/'))
    doc.dispatch('click', targetIn('tel:+15551234'))
    expect(tracking.track.mock.calls).toEqual([['outbound_click', { hostname: 'stripe.com' }]])
    stop()
    expect(doc.listeners).toHaveLength(0)
  })

  it('arms nothing when nothing is selected, and tears down cleanly', () => {
    const stop = observeDocument(armed())
    expect(doc.listeners).toHaveLength(0)
    expect(() => stop()).not.toThrow()
  })
})
