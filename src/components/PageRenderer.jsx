/**
 * PageRenderer
 *
 * Renders a page using the Layout component for proper orchestration
 * of header, body, footer, and panel areas.
 * Manages head meta tags for SEO and social sharing.
 */

import React from 'react'
import BlockRenderer from './BlockRenderer.jsx'
import Layout from './Layout.jsx'
import { useHeadMeta } from '../hooks/useHeadMeta.js'

/**
 * ChildBlocks - renders child blocks of a block
 * Exposed for use by foundation components
 */
export function ChildBlocks({ block, childBlocks, pure = false, extra = {} }) {
  const blocks = childBlocks || block?.childBlocks || []

  return blocks.map((childBlock, index) => (
    <React.Fragment key={childBlock.id || index}>
      <BlockRenderer block={childBlock} pure={pure} extra={extra} />
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
  const uniweb = globalThis.uniweb
  const website = uniweb?.activeWebsite
  const page = website?.activePage
  const siteName = website?.name || ''

  // Get head metadata from page (uses Page.getHeadMeta() if available)
  const headMeta = page?.getHeadMeta?.() || {
    title: page?.title || 'Website',
    description: page?.description || ''
  }

  // Manage head meta tags
  useHeadMeta(headMeta, { siteName })

  if (!page) {
    return (
      <div className="page-loading" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
        No page loaded
      </div>
    )
  }

  // Use Layout component for proper orchestration
  return <Layout page={page} website={website} />
}
