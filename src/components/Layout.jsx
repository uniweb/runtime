/**
 * Layout
 *
 * Orchestrates page rendering by assembling layout areas (header, body, footer, panels).
 * Supports foundation-provided custom Layout components via website.getRemoteLayout().
 *
 * Layout Areas:
 * - header: Top navigation, branding (from layout/header.md)
 * - body: Main page content (from page sections)
 * - footer: Bottom navigation, copyright (from layout/footer.md)
 * - left: Left sidebar/panel (from layout/left.md)
 * - right: Right sidebar/panel (from layout/right.md)
 *
 * Custom Layouts:
 * Foundations can provide a custom Layout via src/exports.js:
 *
 * ```jsx
 * // src/exports.js
 * import Layout from './components/Layout'
 *
 * export default {
 *   Layout,
 *   props: {
 *     themeToggleEnabled: true,
 *   }
 * }
 * ```
 *
 * The Layout component receives pre-rendered areas as props:
 * - page, website: Runtime context
 * - header, body, footer: Pre-rendered React elements
 * - left, right (or leftPanel, rightPanel): Sidebar panels
 */

import Blocks from './Blocks.jsx'

/**
 * Default layout - renders header, body, footer in sequence
 * (no panels in default layout)
 */
function DefaultLayout({ header, body, footer }) {
  return (
    <>
      {header && <header>{header}</header>}
      {body && <main>{body}</main>}
      {footer && <footer>{footer}</footer>}
    </>
  )
}

/**
 * Initialize all blocks to ensure cross-block communication works.
 * Must be called before rendering so getNextBlockInfo() can access sibling contexts.
 *
 * @param {Block[][]} blockGroups - Arrays of blocks from all layout areas
 */
function initializeAllBlocks(...blockGroups) {
  for (const blocks of blockGroups) {
    if (!blocks) continue
    for (const block of blocks) {
      block.initComponent()
    }
  }
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

  // Pre-initialize all blocks before rendering any.
  // This ensures cross-block communication (getNextBlockInfo, getPrevBlockInfo)
  // can access sibling block contexts that are set in initComponent().
  initializeAllBlocks(headerBlocks, bodyBlocks, footerBlocks, leftBlocks, rightBlocks)

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
