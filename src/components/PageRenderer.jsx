/**
 * PageRenderer
 *
 * Renders a page using the Layout component for proper orchestration
 * of header, body, footer, and panel areas.
 * Manages head meta tags for SEO and social sharing.
 */

import React from 'react'
import { useLocation } from 'react-router-dom'
import BlockRenderer from './BlockRenderer.jsx'
import Layout from './Layout.jsx'
import { useHeadMeta } from '../hooks/useHeadMeta.js'

/**
 * ChildBlocks - renders child blocks of a block
 * Exposed for use by foundation components
 *
 * @param {Object} props
 * @param {Block[]} props.blocks - Explicit array of blocks to render
 * @param {Block} props.from - Parent block to extract childBlocks from (convenience shorthand)
 * @param {boolean} props.pure - If true, render components without wrapper
 * @param {string|false} props.as - Element type to render as (default: 'div' for nested blocks)
 * @param {Object} props.extra - Extra props to pass to each component
 *
 * @example
 * // Explicit blocks array
 * <ChildBlocks blocks={filteredBlocks} />
 *
 * @example
 * // Extract from parent block
 * <ChildBlocks from={block} />
 */
export function ChildBlocks({ blocks, from, pure = false, as = 'div', extra = {} }) {
  const blockList = blocks || from?.childBlocks || []

  return blockList.map((childBlock, index) => (
    <React.Fragment key={childBlock.id || index}>
      <BlockRenderer block={childBlock} pure={pure} as={as} extra={extra} />
    </React.Fragment>
  ))
}

/**
 * PageRenderer component
 *
 * Renders the current page using the Layout system which supports:
 * - Header, body, footer areas
 * - Left and right panels
 * - Foundation-provided custom layouts
 * - Per-page layout preferences
 */
export default function PageRenderer() {
  const location = useLocation()
  const uniweb = globalThis.uniweb
  const website = uniweb?.activeWebsite
  const siteName = website?.name || ''

  // Get page from current URL path (not the potentially stale website.activePage)
  // This ensures correct page renders immediately on client-side navigation
  let page = website?.getPage(location.pathname)

  // If no page found, try the 404 page
  const isNotFound = !page
  if (isNotFound) {
    page = website?.getNotFoundPage?.() || website?.activePage
  }

  // Get head metadata from page (uses Page.getHeadMeta() if available)
  const headMeta = page?.getHeadMeta?.() || {
    title: isNotFound ? 'Page Not Found' : (page?.title || 'Website'),
    description: page?.description || ''
  }

  // Manage head meta tags
  useHeadMeta(headMeta, { siteName })

  if (!page) {
    // No page and no 404 page defined - show minimal fallback
    return (
      <div className="page-not-found" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '3rem', fontWeight: 'bold', color: '#1f2937', marginBottom: '1rem' }}>404</h1>
        <p style={{ color: '#64748b', marginBottom: '2rem' }}>Page not found</p>
        <a href="/" style={{ color: '#3b82f6', textDecoration: 'underline' }}>Go to homepage</a>
      </div>
    )
  }

  // Use Layout component for proper orchestration
  return <Layout page={page} website={website} />
}
