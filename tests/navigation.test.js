/**
 * In-app navigation (`navigation.js`). The current page is held until the next one's content is
 * here, for every visitor. The swap is animated only when view transitions apply, and then the
 * transition's update callback resolves once the router has committed the new page, never when
 * `navigate()` returns.
 *
 * ⛔ Until 2026-10-27 a <Link> neither waited nor animated unless its foundation opted in, which
 * `Website#viewTransitions` stopped requiring on 2026-04-11. A split site's body went blank on
 * every <Link> click until the content arrived, and a prose link's crossfade went from the old
 * page to itself.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const saved = { uniweb: globalThis.uniweb, document: globalThis.document, window: globalThis.window }
afterEach(() => {
  Object.assign(globalThis, saved)
  vi.useRealTimers()
})

/** The module as a browser loads it, with or without a reduced-motion preference. */
async function load({ reducedMotion = false } = {}) {
  vi.resetModules()
  globalThis.window = { matchMedia: () => ({ matches: reducedMotion }) }
  return import('../src/navigation.js')
}

/** A page of a split site: it has content, and no sections until `arrive()` or `fail()`. */
function splitPage() {
  let arrive, fail
  const fetched = new Promise((resolve, reject) => { arrive = resolve; fail = reject })
  const page = {
    loaded: false,
    hasContent: () => true,
    isContentLoaded: () => page.loaded,
    loadContent: vi.fn(() => fetched.then(() => { page.loaded = true })),
    arrive: () => arrive(),
    fail: () => fail(new Error('offline')),
  }
  return page
}

const loadedPage = () => ({ hasContent: () => true, isContentLoaded: () => true, loadContent: vi.fn() })

function site(pages, { viewTransitions = true } = {}) {
  globalThis.uniweb = { activeWebsite: { viewTransitions, getPage: (route) => pages[route] } }
}

/**
 * The View Transitions API. The browser calls a transition's update callback a task after it
 * starts, once it has captured the old state; `result` is what the callback returned.
 */
function viewTransitions({ supported = true } = {}) {
  const started = []
  globalThis.document = supported
    ? {
        startViewTransition: (update) => {
          const transition = { result: null }
          const called = new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
            transition.result = Promise.resolve(update())
            return transition.result
          })
          started.push(transition)
          return { ready: called.then(() => {}), updateCallbackDone: called, finished: called }
        },
      }
    : {}
  return started
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Whether `promise` has settled by the next task. */
async function settles(promise) {
  let settled = false
  promise.then(() => { settled = true })
  await tick()
  return settled
}

describe('the current page is held until the next one can be shown', () => {
  it('fetches the content first and swaps when it arrives, animated', async () => {
    const { navigateInApp } = await load()
    const b = splitPage()
    site({ '/b': b })
    const started = viewTransitions()
    const navigate = vi.fn()

    navigateInApp(navigate, '/b')
    await tick()
    expect(b.loadContent).toHaveBeenCalled()
    expect(started).toHaveLength(0)
    expect(navigate).not.toHaveBeenCalled()

    b.arrive()
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/b', undefined))
    expect(started).toHaveLength(1)
  })

  it.each([
    ['a reduced-motion preference', { reducedMotion: true }, {}, {}],
    ['a foundation that turns view transitions off', {}, { viewTransitions: false }, {}],
    ['a browser without the API', {}, {}, { supported: false }],
  ])('with %s, swaps without animating, still after the content', async (_, motion, foundation, api) => {
    const { navigateInApp } = await load(motion)
    const b = splitPage()
    site({ '/b': b }, foundation)
    const started = viewTransitions(api)
    const navigate = vi.fn()

    navigateInApp(navigate, '/b')
    await tick()
    expect(navigate).not.toHaveBeenCalled()

    b.arrive()
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/b', undefined))
    expect(started).toHaveLength(0)
  })

  it.each([['a fragment', '/b#install'], ['a query', '/b?tab=2']])(
    'finds the page of a route carrying %s',
    async (_, route) => {
      const { navigateInApp, prefetchContent } = await load()
      const b = splitPage()
      site({ '/b': b })
      viewTransitions()

      navigateInApp(vi.fn(), route)
      expect(b.loadContent).toHaveBeenCalledTimes(1)
      prefetchContent(route)
      expect(b.loadContent).toHaveBeenCalledTimes(2)
    },
  )

  it('goes without the animation when the content takes longer than the wait', async () => {
    vi.useFakeTimers()
    const { navigateInApp } = await load()
    site({ '/b': splitPage() })
    const started = viewTransitions()
    const navigate = vi.fn()

    navigateInApp(navigate, '/b')
    await vi.advanceTimersByTimeAsync(999)
    expect(navigate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(navigate).toHaveBeenCalledWith('/b', undefined)
    expect(started).toHaveLength(0)
  })

  it('navigates when the content fails to arrive', async () => {
    const { navigateInApp } = await load()
    const b = splitPage()
    site({ '/b': b })
    viewTransitions()
    const navigate = vi.fn()

    navigateInApp(navigate, '/b')
    b.fail()
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/b', undefined))
  })

  it('lets the navigation made last win over one still waiting', async () => {
    const { navigateInApp } = await load()
    const b = splitPage()
    const c = splitPage()
    site({ '/b': b, '/c': c })
    viewTransitions({ supported: false })
    const navigate = vi.fn()

    navigateInApp(navigate, '/b')
    navigateInApp(navigate, '/c')
    c.arrive()
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/c', undefined))
    b.arrive()
    await tick()
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('swaps at once when there is nothing to fetch, passing the options on', async () => {
    const { navigateInApp } = await load()
    site({ '/b': loadedPage() })
    viewTransitions({ supported: false })
    const navigate = vi.fn()

    navigateInApp(navigate, '/b', { replace: true })
    expect(navigate).toHaveBeenCalledWith('/b', { replace: true })
  })
})

describe('the page is held for its data too', () => {
  /**
   * A page whose sections read data. The entity store answers `resolve` as the test says, and
   * `fetch` once `answer()` is called; the site declares the queries given.
   */
  function dataPage({ split = false, queries = { posts: {} }, blocks = [{ type: 'List' }], resolve = () => ({ status: 'pending' }), dynamic = false } = {}) {
    let answer
    const fetched = new Promise((resolveFetch) => { answer = resolveFetch })
    const store = {
      resolve: vi.fn(resolve),
      fetch: vi.fn(() => fetched),
      fetchPageRecord: vi.fn(() => Promise.resolve(null)),
    }
    const page = split ? splitPage() : loadedPage()
    Object.assign(page, {
      website: { config: { queries }, entityStore: store },
      getBodyBlocks: vi.fn(() => blocks),
      getLayoutAreas: () => ({}),
      dynamicContext: dynamic ? { paramName: 'slug', paramValue: 'a' } : null,
    })
    return { page, store, answer: () => answer({ data: {}, errors: null }) }
  }

  it('asks what its sections read once its content is here, and swaps when that is here too', async () => {
    const { navigateInApp } = await load()
    const { page, store, answer } = dataPage({ split: true })
    site({ '/b': page })
    viewTransitions({ supported: false })
    const navigate = vi.fn()

    navigateInApp(navigate, '/b')
    await tick()
    expect(store.fetch).not.toHaveBeenCalled()

    page.arrive()
    await vi.waitFor(() => expect(store.fetch).toHaveBeenCalledTimes(1))
    expect(navigate).not.toHaveBeenCalled()

    answer()
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/b', undefined))
  })

  it('asks only what the cache does not answer', async () => {
    const { navigateInApp } = await load()
    const held = { type: 'Held' }
    const missing = { type: 'Missing' }
    const { page, store } = dataPage({
      blocks: [held, missing],
      resolve: (block) => ({ status: block === held ? 'ready' : 'pending' }),
    })
    site({ '/b': page })
    viewTransitions({ supported: false })

    navigateInApp(vi.fn(), '/b')
    expect(store.fetch).toHaveBeenCalledTimes(1)
    expect(store.fetch.mock.calls[0][0]).toBe(missing)
  })

  it('asks a parametric page\'s own record, which names it', async () => {
    const { navigateInApp } = await load()
    const { page, store } = dataPage({ dynamic: true })
    site({ '/b': page })
    viewTransitions({ supported: false })

    navigateInApp(vi.fn(), '/b')
    expect(store.fetchPageRecord).toHaveBeenCalledWith(page)
  })

  // ⛔ A hosted site's schema-less query is not projected into `config.queries`: its fetch carries
  // the file's `path`. A gate on `config.queries` skipped such a site's data (measured 2026-10-27).
  it('asks a page\'s data whether or not the site lists its queries', async () => {
    const { navigateInApp } = await load()
    const { page, store } = dataPage({ queries: null })
    site({ '/b': page })
    viewTransitions({ supported: false })

    navigateInApp(vi.fn(), '/b')
    expect(store.fetch).toHaveBeenCalledTimes(1)
  })

  it('a prefetch asks the data a fetch on the page declares, with no `config.queries`', async () => {
    const { prefetchPage } = await load()
    const { page, store } = dataPage({ queries: null })
    page.fetch = { query: 'articles', path: '/data/articles.json', as: 'articles' }
    site({ '/b': page })

    prefetchPage('/b')
    expect(store.fetch).toHaveBeenCalledTimes(1)
  })

  it('a prefetch builds no section of a page no fetch can be seen reaching', async () => {
    const { prefetchPage } = await load()
    const { page, store } = dataPage({ queries: null })
    site({ '/b': page })

    prefetchPage('/b')
    expect(page.getBodyBlocks).not.toHaveBeenCalled()
    expect(store.fetch).not.toHaveBeenCalled()
  })

  it('goes when the data takes longer than the wait', async () => {
    vi.useFakeTimers()
    const { navigateInApp } = await load()
    const { page } = dataPage()
    site({ '/b': page })
    viewTransitions({ supported: false })
    const navigate = vi.fn()

    navigateInApp(navigate, '/b')
    await vi.advanceTimersByTimeAsync(999)
    expect(navigate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(navigate).toHaveBeenCalledWith('/b', undefined)
  })

  it('prefetchPage asks the content and then the data, and nothing waits on a failure', async () => {
    const { prefetchPage } = await load()
    const { page, store } = dataPage({ split: true })
    site({ '/b': page })

    const asked = prefetchPage('/b#top')
    expect(page.loadContent).toHaveBeenCalled()
    page.fail()
    await expect(asked).resolves.toBeUndefined()
    expect(store.fetch).not.toHaveBeenCalled()
  })
})

describe('the animated swap ends at the committed page', () => {
  it('resolves its update callback when the page is committed, not when navigate returns', async () => {
    const { navigateInApp, pageCommitted } = await load()
    site({ '/b': loadedPage() })
    const started = viewTransitions()
    const navigate = vi.fn()

    navigateInApp(navigate, '/b')
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled())
    const callback = started[0].result
    expect(await settles(callback)).toBe(false)

    pageCommitted()
    expect(await settles(callback)).toBe(true)
  })

  it('is settled by a router that commits from inside navigate', async () => {
    const { navigateInApp, pageCommitted } = await load()
    site({})
    const started = viewTransitions()

    navigateInApp(() => pageCommitted(), '/b')
    await vi.waitFor(() => expect(started[0]?.result).toBeTruthy())
    expect(await settles(started[0].result)).toBe(true)
  })

  it('lets the browser animate after a second when nothing is committed', async () => {
    vi.useFakeTimers()
    const { navigateInApp } = await load()
    site({})
    const started = viewTransitions()

    navigateInApp(vi.fn(), '/b')
    await vi.advanceTimersByTimeAsync(0)
    let settled = false
    started[0].result.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
  })
})
