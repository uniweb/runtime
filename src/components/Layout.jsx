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
import { resolveLayoutTransitions, resolveLayoutLayers, areaWrapperStyle } from '../area-wrappers.js'

/**
 * Default layout - renders header, body, footer in sequence
 * (no panels in default layout)
 */
function DefaultLayout({ header, body, footer }) {
  // No stacking is set here. The areas arrive already ordered: the runtime
  // gives each area wrapper its layer (see area-wrappers.js), so chrome paints
  // above the body whether or not view transitions are on, and a foundation
  // can re-rank them with `layers` in its layout meta.
  //
  // This layout used to hard-code `z-index: 40` on the header and `30` on the
  // footer for exactly that reason. Once the runtime owned the ordering those
  // numbers were a second mechanism for one job -- and the older one won,
  // because a positioned wrapper here becomes a stacking context that seals the
  // area's own layer inside it. Measured 2026-07-31: `layers: { header: 0 }`
  // on the default layout changed nothing at all.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {header && <header>{header}</header>}
      {body && <main style={{ flex: 1 }}>{body}</main>}
      {footer && <footer>{footer}</footer>}
    </div>
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

  // Pre-render each area as React elements.
  // When the foundation enables view transitions, wrap areas in thin divs with
  // view-transition-name so the browser can animate them independently. Names
  // default to one per area + body (see resolveLayoutTransitions); the layout's
  // `transitions` meta overrides or opts out.
  const areaNames = Object.keys(areas)
  const transitions = website.viewTransitions
    ? resolveLayoutTransitions(areaNames, layoutMeta?.transitions)
    : null
  const layers = resolveLayoutLayers(areaNames, layoutMeta?.layers)

  const wrap = (region, children) => {
    const style = areaWrapperStyle(region, transitions, layers)
    return style ? <div style={style}>{children}</div> : children
  }

  const bodyElement = bodyBlocks ? wrap('body', <Blocks blocks={bodyBlocks} />) : null

  const areaElements = {}
  for (const [name, blocks] of Object.entries(areas)) {
    areaElements[name] = wrap(name, <Blocks blocks={blocks} />)
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
