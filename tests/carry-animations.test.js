/**
 * What `carryAnimations` retimes at the render that replaces a prerendered page, and what it leaves.
 *
 * The browser's own part, that a start time set here carries an animation across the swap with no
 * frame showing a restart, needs a browser: these pin the choice of animations and the moment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { carryAnimations } from '../src/carry-animations.js'

const TIMELINE = {}
const PAINTED = 412.5

/** A root holding `inside`; a target is inside it when it is listed there. */
function makeRoot(inside = []) {
  return { firstChild: {}, contains: (target) => inside.includes(target) }
}

/** A CSS animation as `getAnimations()` lists it, its start not yet set. */
function animation(target, overrides = {}) {
  return {
    animationName: 'rise',
    playState: 'running',
    timeline: TIMELINE,
    effect: { target },
    startTime: null,
    ...overrides
  }
}

let observers
let animations

/** The commit React makes: the observer's callback, as the browser calls it after the task. */
function commit() {
  for (const o of observers) if (!o.disconnected) o.callback([], o)
}

beforeEach(() => {
  observers = []
  animations = []
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback) {
        this.callback = callback
        this.disconnected = false
        observers.push(this)
      }
      observe(target, options) {
        this.target = target
        this.options = options
      }
      disconnect() {
        this.disconnected = true
      }
    }
  )
  vi.stubGlobal('document', { timeline: TIMELINE, getAnimations: () => animations })
  vi.stubGlobal('performance', {
    getEntriesByName: (name) => (name === 'first-contentful-paint' ? [{ startTime: PAINTED }] : [])
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('carryAnimations', () => {
  it("gives the new page's animations the moment the old page was first painted", () => {
    const hero = {}
    const title = {}
    const root = makeRoot([hero, title])
    carryAnimations(root)

    animations = [animation(hero), animation(title, { animationName: 'drop' })]
    commit()

    expect(animations.map((a) => a.startTime)).toEqual([PAINTED, PAINTED])
  })

  it('touches nothing until the render it watches for', () => {
    const hero = {}
    animations = [animation(hero)]
    carryAnimations(makeRoot([hero]))

    expect(animations[0].startTime).toBeNull()
    expect(observers[0].options).toEqual({ childList: true })
  })

  it('stops at that first render, so a later navigation is left as it was', () => {
    const hero = {}
    const root = makeRoot([hero])
    carryAnimations(root)
    commit()
    expect(observers[0].disconnected).toBe(true)

    animations = [animation(hero)]
    commit()

    expect(animations[0].startTime).toBeNull()
  })

  it('leaves a paused animation waiting: setting its start time would start it', () => {
    const reveal = {}
    carryAnimations(makeRoot([reveal]))

    animations = [animation(reveal, { playState: 'paused' })]
    commit()

    expect(animations[0].startTime).toBeNull()
  })

  it('leaves a scroll-driven animation on its own timeline', () => {
    const bar = {}
    carryAnimations(makeRoot([bar]))

    animations = [animation(bar, { timeline: {} })]
    commit()

    expect(animations[0].startTime).toBeNull()
  })

  it('leaves transitions and animations a script started, which name no CSS animation', () => {
    const link = {}
    carryAnimations(makeRoot([link]))

    animations = [animation(link, { animationName: undefined })]
    commit()

    expect(animations[0].startTime).toBeNull()
  })

  it('leaves an animation outside the root, whose element the render did not replace', () => {
    carryAnimations(makeRoot([]))

    animations = [animation({})]
    commit()

    expect(animations[0].startTime).toBeNull()
  })

  it('leaves an effect with no target', () => {
    carryAnimations(makeRoot([]))

    animations = [animation(null, { effect: null })]
    commit()

    expect(animations[0].startTime).toBeNull()
  })

  it('has nothing to carry when the page was not painted: its first render is the first thing shown', () => {
    const hero = {}
    vi.stubGlobal('performance', { getEntriesByName: () => [] })
    carryAnimations(makeRoot([hero]))

    animations = [animation(hero)]
    commit()

    expect(animations[0].startTime).toBeNull()
    expect(observers[0].disconnected).toBe(true)
  })

  it('does not watch an empty root, which has no prerendered page to replace', () => {
    carryAnimations({ firstChild: null, contains: () => true })

    expect(observers).toEqual([])
  })

  it('does nothing in a browser without the API', () => {
    vi.stubGlobal('document', { timeline: TIMELINE })
    carryAnimations(makeRoot())

    expect(observers).toEqual([])
  })
})
