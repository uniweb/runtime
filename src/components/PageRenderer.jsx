/**
 * PageRenderer
 *
 * Renders a page by iterating through its blocks.
 * Manages head meta tags for SEO and social sharing.
 */

import React from 'react'
import BlockRenderer from './BlockRenderer.jsx'
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
 */
export default function PageRenderer() {
  const uniweb = globalThis.uniweb
  const page = uniweb?.activeWebsite?.activePage
  const siteName = uniweb?.activeWebsite?.name || ''

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

  const blocks = page.getPageBlocks()

  return (
    <>
      {blocks.map((block, index) => (
        <React.Fragment key={block.id || index}>
          <BlockRenderer block={block} />
        </React.Fragment>
      ))}
    </>
  )
}
