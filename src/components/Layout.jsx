/**
 * Layout
 *
 * Orchestrates page rendering by assembling layout areas (header, body, footer, panels).
 * Supports foundation-provided custom Layout components via website.getRemoteLayout().
 *
 * Layout Areas:
 * - header: Top navigation, branding (from @header page)
 * - body: Main page content (from page sections)
 * - footer: Bottom navigation, copyright (from @footer page)
 * - left: Left sidebar/panel (from @left page)
 * - right: Right sidebar/panel (from @right page)
 *
 * Custom Layouts:
 * Foundations can export a Layout component that receives pre-rendered areas as props:
 *
 * ```jsx
 * export const site = {
 *   Layout: ({ page, website, header, body, footer, left, right }) => (
 *     <div className="my-layout">
 *       <header>{header}</header>
 *       <aside>{left}</aside>
 *       <main>{body}</main>
 *       <aside>{right}</aside>
 *       <footer>{footer}</footer>
 *     </div>
 *   )
 * }
 * ```
 */

import React from 'react'
import Blocks from './Blocks.jsx'

/**
 * Default layout - renders header, body, footer in sequence
 * (no panels in default layout)
 */
function DefaultLayout({ header, body, footer }) {
  return (
    <>
      {header}
      {body}
      {footer}
    </>
  )
}

/**
 * Layout component
 *
 * @param {Object} props
 * @param {Page} props.page - Current page instance
 * @param {Website} props.website - Website instance
 */
export default function Layout({ page, website }) {
  // Check if foundation provides a custom Layout
  const RemoteLayout = website.getRemoteLayout()

  // Get block groups from page (respects layout preferences)
  const headerBlocks = page.getHeaderBlocks()
  const bodyBlocks = page.getBodyBlocks()
  const footerBlocks = page.getFooterBlocks()
  const leftBlocks = page.getLeftBlocks()
  const rightBlocks = page.getRightBlocks()

  // Pre-render each area as React elements
  const headerElement = headerBlocks ? <Blocks blocks={headerBlocks} /> : null
  const bodyElement = bodyBlocks ? <Blocks blocks={bodyBlocks} /> : null
  const footerElement = footerBlocks ? <Blocks blocks={footerBlocks} /> : null
  const leftElement = leftBlocks ? <Blocks blocks={leftBlocks} /> : null
  const rightElement = rightBlocks ? <Blocks blocks={rightBlocks} /> : null

  // Use foundation's custom Layout if provided
  if (RemoteLayout) {
    return (
      <RemoteLayout
        page={page}
        website={website}
        header={headerElement}
        body={bodyElement}
        footer={footerElement}
        left={leftElement}
        right={rightElement}
        // Aliases for backwards compatibility
        leftPanel={leftElement}
        rightPanel={rightElement}
      />
    )
  }

  // Default layout
  return (
    <DefaultLayout
      header={headerElement}
      body={bodyElement}
      footer={footerElement}
    />
  )
}
