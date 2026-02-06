/**
 * Layout
 *
 * Orchestrates page rendering by assembling layout areas (header, body, footer, and
 * any custom areas defined in the layout directory).
 * Supports foundation-provided custom Layout components via website.getRemoteLayout().
 *
 * Layout Areas:
 * Areas are general — any name works. Common conventions:
 * - header: Top navigation, branding (from layout/header.md)
 * - body: Main page content (from page sections)
 * - footer: Bottom navigation, copyright (from layout/footer.md)
 * - left: Left sidebar/panel (from layout/left.md)
 * - right: Right sidebar/panel (from layout/right.md)
 *
 * Custom Layouts:
 * Foundations provide custom layouts via src/layouts/:
 *
 * ```
 * src/layouts/
 * ├── DocsLayout/
 * │   ├── index.jsx
 * │   └── meta.js
 * └── MarketingLayout.jsx
 * ```
 *
 * The Layout component receives pre-rendered areas as props:
 * - page, website: Runtime context
 * - params: Layout params (merged with meta.js defaults)
 * - body: Pre-rendered body React element
 * - header, footer, left, right, ...: Pre-rendered area React elements
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
 * Merge page-level layout params with meta.js defaults
 */
function mergeParams(pageParams = {}, defaults = {}) {
  return { ...defaults, ...pageParams }
}

/**
 * Layout component
 *
 * @param {Object} props
 * @param {Page} props.page - Current page instance
 * @param {Website} props.website - Website instance
 */
export default function Layout({ page, website }) {
  const layoutName = page.getLayoutName()
  const RemoteLayout = website.getRemoteLayout(layoutName)
  const layoutMeta = website.getLayoutMeta(layoutName)

  const bodyBlocks = page.getBodyBlocks()
  const areas = page.getLayoutAreas()

  // Pre-initialize all blocks before rendering any.
  // This ensures cross-block communication (getNextBlockInfo, getPrevBlockInfo)
  // can access sibling block contexts that are set in initComponent().
  const allBlockGroups = [bodyBlocks, ...Object.values(areas)]
  initializeAllBlocks(...allBlockGroups)

  // Pre-render each area as React elements
  const bodyElement = bodyBlocks ? <Blocks blocks={bodyBlocks} /> : null
  const areaElements = {}
  for (const [name, blocks] of Object.entries(areas)) {
    areaElements[name] = <Blocks blocks={blocks} />
  }

  // Use foundation's custom Layout if provided
  if (RemoteLayout) {
    const params = mergeParams(page.getLayoutParams(), layoutMeta?.defaults)

    return (
      <RemoteLayout
        key={layoutName}
        page={page}
        website={website}
        params={params}
        body={bodyElement}
        {...areaElements}
      />
    )
  }

  // Default layout
  return (
    <DefaultLayout
      body={bodyElement}
      {...areaElements}
    />
  )
}
