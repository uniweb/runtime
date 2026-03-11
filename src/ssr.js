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
  prefetchIcons,

  // Layer 3: Per-page rendering
  renderPage,
  classifyRenderError,

  // HTML injection
  injectPageContent,
  escapeHtml,
} from './ssr-renderer.js'
