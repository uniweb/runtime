/**
 * The isolate API — what `@uniweb/runtime/ssr` promises a host that renders in an
 * isolate, and the runtime version below which that promise does not hold.
 *
 * ⭐ THE ONE PLACE THE NUMBER IS STATED. A host loads the SITE'S pinned runtime as a
 * dynamically-loaded artifact — never an import — so it cannot link-check what it
 * calls; it feature-detects, and an export that is missing looks exactly like an old
 * runtime. The backend evaluates a site's runtime at publish and holds this floor as
 * a constant of its own [Diego, 2026-09-04: "We will set a runtime version floor that
 * guarantees they are there"], composing it as `max(absoluteFloor, foundationFloors)`.
 * That constant is copied from here, and `tests/isolate-api.test.js` is what keeps
 * this file honest: every export of `src/ssr.js` must appear below with the version
 * it first shipped in, and every name below must still be exported — by the source
 * and by the built `dist/ssr.js` when it is present. Forgetting to stamp a new export
 * fails HERE, in the repo where the change happens; a rename fails here too.
 *
 * ⛔ A floor is a promise about a VERSION, not a rename guard. A site on a newer
 * runtime with a renamed export is still a missing symbol; the test above is what
 * makes that fail before it ships, and the announcement to the consumer is still
 * ours to send (`framework/CLAUDE.md` § Decoupling is the architecture).
 *
 * ⛔ Not `runtime-pin.json`. That file is emitted per FOUNDATION build and records an
 * observed fact ("built against"), never a guarantee; an isolate-API floor is a
 * guarantee and is not a property of any foundation. Different kind of claim,
 * different home.
 *
 * "since" is the first PUBLISHED version (git tag) whose `@uniweb/runtime/ssr`
 * exported the name — measured with `git log --reverse -S<name> -- src/ssr.js` and
 * `git tag --contains`, 2026-09-04.
 */

/** Every export of `@uniweb/runtime/ssr`, with the version it first shipped in. */
export const ISOLATE_API = Object.freeze({
  // props preparation
  prepareProps: '0.2.15',
  applySchemas: '0.2.15',
  applyDefaults: '0.2.15',
  guaranteeContentStructure: '0.2.15',
  getComponentMeta: '0.2.15',
  getComponentDefaults: '0.2.15',
  // rendering
  getWrapperProps: '0.6.14',
  renderBackground: '0.6.14',
  renderBlock: '0.6.14',
  renderBlocks: '0.6.14',
  renderLayout: '0.6.14',
  renderPage: '0.2.15',
  classifyRenderError: '0.6.14',
  injectPageContent: '0.6.14',
  escapeHtml: '0.6.14',
  generate404Html: '0.6.16',
  // initialization
  initPrerender: '0.6.14',
  initPrerenderForLocale: '0.8.9',
  sliceContentForLocale: '0.8.9',
  hydrateDataStore: '0.8.9',
  prefetchIcons: '0.6.14',
  renderAppearanceBootScript: '0.8.30',
  // page resolution
  resolvePage: '0.9.5',
  // server-side prefetch — the runtime executing a page's fetches for a host
  findPageForRoute: '0.14.1',
  resolvePageFetchConfigs: '0.14.1',
  executeFetchConfigs: '0.14.1',
  prefetchPageData: '0.14.1',
  // the composed render entry
  createPageRenderer: '0.14.2',
  prefetchAndHydrate: '0.14.2',
})

/**
 * The runtime version at or above which EVERY name in `ISOLATE_API` is exported —
 * the absolute floor a host may rely on with no feature detection.
 */
export const ISOLATE_API_FLOOR = Object.values(ISOLATE_API).reduce((max, v) => (compareVersions(v, max) > 0 ? v : max), '0.0.0')

/** Compare two `x.y.z` versions numerically. Returns <0, 0 or >0. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}
