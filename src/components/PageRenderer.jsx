/**
 * PageRenderer
 *
 * Renders a page by iterating through its blocks.
 */

import React, { useEffect } from 'react'
import BlockRenderer from './BlockRenderer.jsx'

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
  const page = globalThis.uniweb?.activeWebsite?.activePage
  const pageTitle = page?.title || 'Website'

  useEffect(() => {
    document.title = pageTitle
    return () => {
      document.title = 'Website'
    }
  }, [pageTitle])

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
