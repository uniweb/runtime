import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { outboundHostname, observeOutboundClicks } from '../src/outbound-clicks.js'

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
