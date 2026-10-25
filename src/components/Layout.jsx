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

import { useEffect } from 'react'
import Blocks from './Blocks.jsx'
import { resolveLayoutTransitions, resolveLayoutLayers, areaWrapperProps } from '../area-wrappers.js'
import { layoutStickiness, zoneProps } from '../sticky.js'
import { warnUnmovableSticky } from '../sticky-check.js'
import { watchStickyTop, bodySectionOf } from '../sticky-top.js'
// The built-in layout — one copy, which the prerender renders too (`../default-layout.js`).
import { DefaultLayout } from '../default-layout.js'

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
  // An area stays in view when any of its sections is sticky (`../sticky.js`): in a foundation's
  // layout its wrapper sticks; in the built-in one, the zone around the wrapper does. Either way
  // it is lifted above the areas that scroll under it.
  const sticky = layoutStickiness(areas)
  const layers = resolveLayoutLayers(areaNames, layoutMeta?.layers, sticky)

  const wrap = (region, children) => {
    const props = areaWrapperProps(region, transitions, layers, RemoteLayout ? sticky[region] : null)
    return props ? <div {...props}>{children}</div> : children
  }

  // A body section's own wrapper is the box that sticks for it; an area's sections leave that to
  // the area's box.
  const bodyElement = bodyBlocks ? wrap('body', <Blocks blocks={bodyBlocks} stickySelf="section" />) : null

  const areaElements = {}
  for (const [name, blocks] of Object.entries(areas)) {
    areaElements[name] = wrap(name, <Blocks blocks={blocks} />)
  }

  // How far down the stuck chrome reaches — `--uw-sticky-top`, where a sticky section with no
  // `top` of its own stays, and where kit's anchors land (`../sticky-top.js`).
  useEffect(() => watchStickyTop(document, bodySectionOf(bodyBlocks?.[0])), [page])

  // `uniweb dev` names a sticky element that cannot move — a component's own `sticky`, an area a
  // layout wraps in an element of its own, a box that clips — measured once the page's data is in.
  // Dropped from a published page's runtime.
  useEffect(() => {
    if (import.meta.env?.DEV) return warnUnmovableSticky(document, { settled: () => website.dataStore.whenIdle() })
  }, [page])

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

  // Default layout — a sticky area's zone is the box that sticks.
  const zone = (name) => zoneProps(sticky[name], layers?.[name])
  return (
    <DefaultLayout
      body={bodyElement}
      {...areaElements}
      zones={{ header: zone('header'), footer: zone('footer') }}
    />
  )
}
