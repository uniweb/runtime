import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { observeSections } from '../src/section-views.js'

/**
 * `section_view` — the observer half.
 *
 * The hook that arms this is tested separately as source (it is a React effect
 * behind a dynamic import); what matters here is the behaviour a visitor's
 * browser actually produces: which sections report, how many times, and what
 * rides on the event.
 */

/** A minimal IntersectionObserver whose callback these tests drive by hand. */
class FakeIO {
  constructor(cb, options) {
    this.cb = cb
    this.options = options
    this.observed = new Set()
    this.disconnected = false
    FakeIO.last = this
  }
  observe(el) {
    this.observed.add(el)
  }
  unobserve(el) {
    this.observed.delete(el)
  }
  disconnect() {
    this.disconnected = true
    this.observed.clear()
  }
  /** Fire the callback as the browser would. */
  fire(entries) {
    this.cb(entries, this)
  }
}

/** A Block stand-in: an id for the DOM lookup and a spy for the emission. */
function block(stableId, type = 'Hero') {
  return { stableId, type, track: vi.fn() }
}

/**
 * A page whose blocks resolve to elements registered in the fake document.
 *
 * Elements are created EAGERLY so a test can hold a handle before
 * `observeSections` runs — a lazy map returns `undefined` at that point, which
 * silently makes an assertion pass against the wrong element.
 *
 * `present` narrows which ids the document knows about, standing in for a
 * section that has not rendered yet.
 */
function pageWith(blocks, { present = null } = {}) {
  const ids = present ?? blocks.map((b) => `section-${b.stableId}`)
  const elements = new Map(ids.map((id) => [id, { id }]))
  globalThis.document = {
    getElementById: (id) => elements.get(id) ?? null
  }
  return { page: { bodyBlocks: blocks }, elements }
}

beforeEach(() => {
  globalThis.IntersectionObserver = FakeIO
  FakeIO.last = null
})

afterEach(() => {
  delete globalThis.IntersectionObserver
  delete globalThis.document
})

describe('observeSections', () => {
  it('reports a section once it is at least half visible, with the block envelope', () => {
    const hero = block('hero', 'Hero')
    const { page, elements } = pageWith([hero])

    observeSections(page)
    FakeIO.last.fire([
      { target: elements.get('section-hero'), isIntersecting: true, intersectionRatio: 0.6 }
    ])

    expect(hero.track).toHaveBeenCalledTimes(1)
    // No payload of its own: `path`, `section` and `section_id` are attached by
    // Block.track, which is what keeps one envelope for every event.
    expect(hero.track).toHaveBeenCalledWith('section_view')
  })

  // ⛔ `isIntersecting` flips at ANY threshold crossing, so a section entering
  // by one pixel arrives with it true and a low ratio. Checking the ratio is
  // what makes "seen" mean seen.
  it('does NOT report a section that is barely in view', () => {
    const hero = block('hero')
    const { page, elements } = pageWith([hero])

    observeSections(page)
    FakeIO.last.fire([
      { target: elements.get('section-hero'), isIntersecting: true, intersectionRatio: 0.01 }
    ])

    expect(hero.track).not.toHaveBeenCalled()
  })

  it('reports each section ONCE, however often it re-enters', () => {
    const hero = block('hero')
    const { page, elements } = pageWith([hero])
    const el = elements.get('section-hero')

    observeSections(page)
    const seen = { target: el, isIntersecting: true, intersectionRatio: 0.9 }
    FakeIO.last.fire([seen])
    FakeIO.last.fire([seen]) // scrolled away and back
    FakeIO.last.fire([seen])

    expect(hero.track).toHaveBeenCalledTimes(1)
    // It also stops being watched, so the work goes away with the count.
    expect(FakeIO.last.observed.has(el)).toBe(false)
  })

  it('observes at the 0.5 threshold and reports every section independently', () => {
    const hero = block('hero', 'Hero')
    const pricing = block('pricing', 'Pricing')
    const { page, elements } = pageWith([hero, pricing])

    observeSections(page)
    expect(FakeIO.last.options).toEqual({ threshold: 0.5 })
    expect(FakeIO.last.observed.size).toBe(2)

    FakeIO.last.fire([
      { target: elements.get('section-pricing'), isIntersecting: true, intersectionRatio: 0.7 }
    ])

    expect(pricing.track).toHaveBeenCalledTimes(1)
    // Control: the section that was never reached must stay silent, or the test
    // above would pass for an observer that reports everything on any event.
    expect(hero.track).not.toHaveBeenCalled()
  })

  // Split-content pages can render sections after this runs. Skipping the
  // missing ones is deliberate — a v1 that quietly misses a late section beats
  // one that polls — but the sections that ARE present must still work.
  it('skips blocks with no element and still observes the rest', () => {
    const hero = block('hero')
    const late = block('late')
    const { page, elements } = pageWith([hero, late], { present: ['section-hero'] })

    observeSections(page)

    expect(FakeIO.last.observed.size).toBe(1)
    FakeIO.last.fire([
      { target: elements.get('section-hero'), isIntersecting: true, intersectionRatio: 0.8 }
    ])
    expect(hero.track).toHaveBeenCalledTimes(1)
    expect(late.track).not.toHaveBeenCalled()
  })

  it('does nothing, and returns no teardown, when no section is on the page', () => {
    const { page } = pageWith([])
    expect(observeSections(page)).toBeNull()
    expect(FakeIO.last).toBeNull()
  })

  it('is inert where IntersectionObserver does not exist (a Worker, SSR)', () => {
    const hero = block('hero')
    const { page } = pageWith([hero])
    delete globalThis.IntersectionObserver

    expect(observeSections(page)).toBeNull()
    expect(hero.track).not.toHaveBeenCalled()
  })

  it('teardown disconnects, so a navigation stops the previous page reporting', () => {
    const { page } = pageWith([block('hero')])
    const stop = observeSections(page)
    expect(FakeIO.last.disconnected).toBe(false)
    stop()
    expect(FakeIO.last.disconnected).toBe(true)
  })
})

describe('the element lookup uses the shared id rule', () => {
  /**
   * ⛔ Not a style point. The renderers write the id through `sectionDomId`, and
   * a second spelling here would drift silently — it already happened once
   * between the renderers and the search extractor, and no test failed. A
   * selector like `[id^="section-"]` would additionally pick up heading anchors,
   * which share the id namespace and carry no prefix.
   */
  it('finds sections by sectionDomId and never by a selector', () => {
    const source = readSource()
    expect(source).toMatch(/sectionDomId/)
    expect(source).toMatch(/getElementById/)
    expect(source).not.toMatch(/querySelector/)
    expect(source).not.toMatch(/\[id\^=/)
  })

  // ⛔ Dwell is refused for validity, not cost: at a 0.5 threshold the duration
  // is dominated by how long a TALL section takes to scroll past, so a tall
  // boring section would outscore a short compelling one on a chart labelled
  // "engagement". If this ever changes it must be a decision, not a drift.
  it('measures no duration', () => {
    const source = readSource()
    expect(source).not.toMatch(/durationMs/)
    expect(source).not.toMatch(/performance\.now/)
    expect(source).not.toMatch(/Date\.now/)
  })
})

/**
 * ⛔ **Comments stripped, because these assertions are about CODE** — and this
 * file failed its own first run on exactly that, as `foundation-loader.test.js`
 * did before it. The docblock in `section-views.js` explains *why* a selector
 * like `[id^="section-"]` and a `durationMs` are wrong, so it contains both
 * strings. **A guard its own rationale can break is not a guard**: it would
 * force whoever restates the reasoning to weaken the test.
 */
function readSource() {
  const source = readFileSync(
    fileURLToPath(new URL('../src/section-views.js', import.meta.url)),
    'utf8'
  )
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}
