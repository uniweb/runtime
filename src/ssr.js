/**
 * @uniweb/runtime/ssr - Server-Side Rendering Entry Point
 *
 * Node.js-compatible exports for SSG/prerendering.
 * This module is built to a standalone bundle that can be imported
 * directly by Node.js without Vite transpilation.
 *
 * Provides three layers:
 *   1. Rendering functions (renderBlock, renderBlocks, renderLayout, renderBackground)
 *   2. Initialization (initPrerender, prefetchIcons)
 *   3. Per-page rendering (renderPage, classifyRenderError, injectPageContent, escapeHtml)
 *
 * Plus the existing prepare-props utilities (prepareProps, getComponentMeta, etc.)
 */

// Props preparation (no browser APIs)
export {
  prepareProps,
  applySchemas,
  applyDefaults,
  guaranteeContentStructure,
  getComponentMeta,
  getComponentDefaults
} from './prepare-props.js'

// SSR rendering pipeline (no hooks, no JSX)
export {
  // Layer 1: Rendering
  getWrapperProps,
  renderBackground,
  renderBlock,
  renderBlocks,
  renderLayout,

  // Layer 2: Initialization
  initPrerender,
  initPrerenderForLocale,
  sliceContentForLocale,
  hydrateDataStore,
  prefetchIcons,

  // Layer 3: Per-page rendering.
  // `resolvePage` belongs beside `renderPage` and its absence was a real bug:
  // this list handed callers a renderer that takes a Page and no supported way
  // to get one, so a host wrote its own lookup three times — and the obvious
  // one, an exact match over `website.pages`, cannot match a dynamic route.
  resolvePage,
  renderPage,
  classifyRenderError,

  // HTML injection
  injectPageContent,
  escapeHtml,

  // 404 fallback
  generate404Html,
} from './ssr-renderer.js'

// ⭐ The render's data step — what the page a visit starts on will read, asked block by block on
// the Website the isolate renders with, so the keys a component declares, the layout the page
// draws and the transport a key is routed to are all known. A host that hydrates through its own
// door calls this and hydrates the list itself; `prefetchAndHydrate` is the same step plus the
// hydration.
export { loadPageData } from './load-page-data.js'

// Server-side prefetch from the PAYLOAD ALONE — the entry that predates the step above. It cannot
// know a component's declared keys, a page's layout or a site's transports, so it asks for every
// fetch on every level and still gets four cases wrong
// (`kb/framework/plans/what-a-page-needs.md` §0). ⛔ Kept for callers that have no Website to hand;
// prefer `loadPageData`.
// [Diego, 2026-09-03]: the backend sets the records service; the fetch comes from the runtime.
export {
  findPageForRoute,
  resolvePageFetchConfigs,
  executeFetchConfigs,
  prefetchPageData,
} from './prefetch.js'

// The composed render entry — resolve, render, inject, as one call. Built because
// framework itself had two callers of this unshared sequence (the build's prerender
// loop and an SSR isolate), not because a consumer asked; see page-renderer.js for
// what it deliberately leaves to the host.
export { createPageRenderer, prefetchAndHydrate } from './page-renderer.js'

// The whole corpus, rather than one page — for a host that indexes a site or
// derives something over every record its queries return. It asks through the
// same client and the same composition a page render uses, which is the point:
// an index that composed its own questions could offer a result whose page then
// renders empty. The host supplies only the transport.
export { collectSiteRecords } from './collect-records.js'

// Appearance. injectPageContent() already emits this for every prerendered
// page; exported for lanes that assemble a shell without a per-page render.
export { renderAppearanceBootScript } from './appearance.js'
