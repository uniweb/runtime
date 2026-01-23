/**
 * @uniweb/runtime/ssr - Server-Side Rendering Entry Point
 *
 * Node.js-compatible exports for SSG/prerendering.
 * This module is built to a standalone bundle that can be imported
 * directly by Node.js without Vite transpilation.
 *
 * Usage in prerender.js:
 *   import { renderPage, Blocks, BlockRenderer } from '@uniweb/runtime/ssr'
 */

import React from 'react'

// Props preparation (no browser APIs)
export {
  prepareProps,
  applySchemas,
  applyDefaults,
  guaranteeContentStructure,
  getComponentMeta,
  getComponentDefaults
} from './prepare-props.js'

// Components for rendering
export { default as BlockRenderer } from './components/BlockRenderer.jsx'
export { default as Blocks } from './components/Blocks.jsx'
export { default as Layout } from './components/Layout.jsx'

// Re-export Layout's DefaultLayout for direct use
import LayoutComponent from './components/Layout.jsx'

/**
 * Render a page to React elements
 *
 * This is the main entry point for SSG. It returns a React element
 * that can be passed to renderToString().
 *
 * @param {Object} props
 * @param {Page} props.page - The page instance to render
 * @param {Website} props.website - The website instance
 * @returns {React.ReactElement}
 */
export function PageElement({ page, website }) {
  return React.createElement(
    'main',
    null,
    React.createElement(LayoutComponent, { page, website })
  )
}
