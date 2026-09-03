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

// Server-side prefetch — the runtime executing a page's fetches for a host, so an isolate
// receives `fetchedData` computed by our fetcher and the host carries no copy of it.
// [Diego, 2026-09-03]: the backend sets config.records; the fetch comes from the runtime.
export {
  findPageForRoute,
  resolvePageFetchConfigs,
  executeFetchConfigs,
  prefetchPageData,
} from './prefetch.js'

// Appearance. injectPageContent() already emits this for every prerendered
// page; exported for lanes that assemble a shell without a per-page render.
export { renderAppearanceBootScript } from './appearance.js'
