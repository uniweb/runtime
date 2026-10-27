/**
 * SSR Renderer
 *
 * Hook-free rendering pipeline for SSG (build) and server-side SSR.
 * Mirrors BlockRenderer.jsx using React.createElement directly — no hooks,
 * no JSX, no browser APIs. A section's background and the built-in layout are
 * not mirrored: both renderers draw the one copy (`background.js`,
 * `default-layout.js`).
 *
 * This is the single source of truth for how blocks render during prerender.
 * When modifying BlockRenderer.jsx, update `renderBlock` here to match.
 *
 * Exports three layers:
 *   1. Rendering functions (renderBlock, renderBlocks, renderLayout, renderBackground)
 *   2. Initialization (initPrerender, prefetchIcons)
 *   3. Per-page rendering (renderPage, classifyRenderError, injectPageContent, escapeHtml)
 */

import React from 'react'
import { renderToString } from 'react-dom/server'
import { createUniweb, resolveDefaultLocale } from '@uniweb/core'
import { sectionDomId } from '@uniweb/core/section-id'
import { Background } from './background.js'
import { routePatternToRegex, isDynamicRoute } from '@uniweb/core/route-match'
import { DEFAULT_ICON_BASE, iconUrl } from '@uniweb/core/icon-corpus'
import { buildSectionOverrides, FONT_LINKS_MARKER } from '@uniweb/theming'
import { prepareProps, getComponentMeta } from './prepare-props.js'
import { default404Html } from './default-404.js'
import {
  wireFoundationCapabilities,
  sliceContentForLocale,
  hydrateDataStore,
  ensureThemeCss,
} from './wire-foundation.js'
import { resolveLayoutTransitions, resolveLayoutLayers, areaWrapperProps } from './area-wrappers.js'
import { layoutStickiness, sectionStickyProps, sectionScrollMargin, zoneProps } from './sticky.js'
import { DefaultLayout } from './default-layout.js'
import { renderAppearanceBootScript } from './appearance.js'
import { documentTitle } from './document-title.js'
import { recordStartPage } from './start-page.js'
import { escapeHtml } from '@uniweb/core/page-shell'

// Re-export L2 helpers so the public `@uniweb/runtime/ssr` surface
// carries everything an SSR consumer needs from one entry point.
export { sliceContentForLocale, hydrateDataStore }

// ============================================================================
// Layer 1: Rendering functions
// ============================================================================

/**
 * Valid color contexts for section theming
 */
const VALID_CONTEXTS = ['light', 'medium', 'dark']

/**
 * Build wrapper props from block configuration.
 * Mirrors getWrapperProps in BlockRenderer.jsx.
 */
export function getWrapperProps(block) {
  const theme = block.themeName
  const blockClassName = block.state?.className || ''

  // Empty themeName = Auto → no context class → inherits tokens from :root
  // Non-empty = Pinned → context class sets tokens directly on the element
  let contextClass = ''
  if (theme && VALID_CONTEXTS.includes(theme)) {
    contextClass = `context-${theme}`
  }

  let className = contextClass
  if (blockClassName) {
    className = className ? `${className} ${blockClassName}` : blockClassName
  }

  // Normalized once by core (`block.background`) — the same value the SPA renderer reads.
  const background = block.background || {}
  const style = {}

  // If background has content, ensure relative positioning and a stacking context
  // so the background's z-index stays contained within this section.
  if (background.mode) {
    style.position = 'relative'
    style.isolation = 'isolate'
  }

  // The section's tokens in effect whatever the scheme, inline — as in the SPA renderer
  // (`BlockRenderer.jsx`); the rest of its theme is the page stylesheet's.
  if (block.contextOverrides) {
    for (const [key, value] of Object.entries(block.contextOverrides)) {
      style[`--${key}`] = value
    }
  }

  // Same rule as the SPA renderer and the search extractor — @uniweb/core/section-id.
  return { id: sectionDomId(block), style, className, background }
}


/**
 * Render a section's background for SSR: the one implementation both renderers draw
 * (`background.js`). A video background is drawn as its poster — what the browser draws too,
 * until it has mounted and starts the video.
 * ⛔ Until 2026-10-25 this was a copy of `Background.jsx`, and drew no video at all.
 *
 * @param {Object} background - `block.background`, normalized by core
 * @returns {React.ReactElement|null}
 */
export function renderBackground(background) {
  if (!background?.mode) return null
  return React.createElement(Background, background)
}

/**
 * Render a single block for SSR.
 * Mirrors BlockRenderer.jsx but without hooks (no runtime data fetching).
 *
 * Two modes (mirrors client BlockRenderer):
 * - Bare (as=null/false): component only, no wrapper
 * - Section (as='section'/'div'/etc.): full treatment with wrapper, context, background
 *
 * @param {Block} block - Block instance to render
 * @param {Object} [options]
 * @param {string|null} [options.as='section'] - Wrapper element tag, or null/false for bare mode
 * @param {'section'|'child'|boolean} [options.stickySelf] - whether a sticky section's own wrapper
 *   is the box that sticks: a body section's (`'section'`), or a child section's (`'child'`)
 * @returns {React.ReactElement}
 */
export function renderBlock(block, { as = 'section', stickySelf = false } = {}) {
  const Component = block.initComponent()

  if (!Component) {
    return React.createElement('div', {
      className: 'block-error',
      style: { padding: '1rem', background: '#fef2f2', color: '#dc2626' },
    }, `Component not found: ${block.type}`)
  }

  // Resolve entity data synchronously (SSG has no async): EntityStore fills the keys
  // the component declares (`meta.data`) from the fetches that reach the block.
  const meta = getComponentMeta(block.type)
  const entityStore = block.website?.entityStore
  let entityData = null
  let pending = false
  if (entityStore) {
    const resolved = entityStore.resolve(block, meta)
    if (resolved.status === 'ready') entityData = resolved.data
    pending = resolved.status === 'pending'
  }

  // ⭐ A block whose data is still out is LOADING here, as in the browser, which sets the same flag
  // before `prepareProps` (`BlockRenderer.jsx`) and fetches the data once it boots. So the page
  // paints the component's loading state, the one the browser renders in its place.
  // ⛔ Until 2026-10-25 this was never set, and such a section prerendered its EMPTY state —
  // "nothing found", or an error — then switched to loading when the browser took over.
  block.dataLoading = pending

  // Build content and params with runtime guarantees.
  // prepareProps handles the full pipeline: entity data merge,
  // foundation content handler invocation, guaranteed content
  // structure, schema application, and param defaults.
  // See prepare-props.js for the pipeline details.
  const prepared = prepareProps(block, meta, entityData)
  const params = prepared.params
  const content = { ...prepared.content, ...block.properties }

  const componentProps = { content, params, block }

  // Bare mode: component only, no wrapper or section chrome.
  // Used by ChildBlocks for grid cells, tab panels, inline children, insets.
  if (!as) {
    return React.createElement(Component, componentProps)
  }

  // Section mode: full treatment with wrapper, context classes, background.
  const { background, ...wrapperProps } = getWrapperProps(block)

  // A body section's wrapper, or a child section's, is the box that stays in view (`sticky.js`).
  const sticky = sectionStickyProps(block, stickySelf)
  if (sticky) {
    wrapperProps.style = { ...wrapperProps.style, ...sticky.style }
    wrapperProps['data-uw-sticky'] = sticky['data-uw-sticky']
  }
  // On a page whose layout has a sticky area, a link to this section lands below it.
  const margin = sectionScrollMargin(block, stickySelf)
  if (margin) wrapperProps.style = { ...wrapperProps.style, ...margin }

  // Merge Component.className (static classes declared on the component function)
  const componentClassName = Component.className
  if (componentClassName) {
    wrapperProps.className = wrapperProps.className
      ? `${wrapperProps.className} ${componentClassName}`
      : componentClassName
  }

  // Check if component handles its own background
  const hasBackground = background?.mode && meta?.background !== 'self'
  block.hasBackground = hasBackground

  // Determine wrapper element:
  // - Explicit as (not 'section') → use as prop directly
  // - Component.as → use component's declared tag (e.g., Header.as = 'header')
  // - fallback → 'section'
  const wrapperTag = as !== 'section' ? as : (Component.as || 'section')

  if (hasBackground) {
    return React.createElement(wrapperTag, wrapperProps,
      renderBackground(background),
      React.createElement('div', { style: { position: 'relative', zIndex: 10 } },
        React.createElement(Component, componentProps)
      )
    )
  }

  return React.createElement(wrapperTag, wrapperProps,
    React.createElement(Component, componentProps)
  )
}

/**
 * Render an array of blocks for SSR.
 */
export function renderBlocks(blocks, { stickySelf = false } = {}) {
  if (!blocks || blocks.length === 0) return null
  return blocks.map((block, index) =>
    React.createElement(React.Fragment, { key: block.id || index },
      renderBlock(block, { stickySelf })
    )
  )
}

/**
 * Render page layout for SSR.
 * Mirrors Layout.jsx but without hooks.
 */
export function renderLayout(page, website) {
  const layoutName = page.getLayoutName()
  const RemoteLayout = website.getRemoteLayout(layoutName)
  const layoutMeta = website.getLayoutMeta(layoutName)

  const bodyBlocks = page.getBodyBlocks()
  const areas = page.getLayoutAreas()

  // Mirror Layout.jsx: every block's component initialized before anything renders, so each
  // section's `sticky` — its type's default included — is known before the areas' layers are.
  for (const blocks of [bodyBlocks, ...Object.values(areas)]) {
    for (const block of blocks || []) block.initComponent()
  }

  // Mirror Layout.jsx: wrap body + each area in a thin div carrying its
  // view-transition-name, so the prerendered HTML matches the page the SPA renders
  // in its place and the browser can animate regions independently on client navigation.
  const areaNames = Object.keys(areas)
  const transitions = website.viewTransitions
    ? resolveLayoutTransitions(areaNames, layoutMeta?.transitions)
    : null

  // Mirror Layout.jsx: an area stays in view when any of its sections is sticky — in a
  // foundation's layout its wrapper sticks, in the built-in one the zone around it — and is lifted
  // above the areas that scroll under it.
  const sticky = layoutStickiness(areas)
  const layers = resolveLayoutLayers(areaNames, layoutMeta?.layers, sticky)
  const wrapArea = (name, element) => {
    const props = areaWrapperProps(name, transitions, layers, RemoteLayout ? sticky[name] : null)
    return props ? React.createElement('div', props, element) : element
  }

  const bodyElement = bodyBlocks ? wrapArea('body', renderBlocks(bodyBlocks, { stickySelf: 'section' })) : null
  const areaElements = {}
  for (const [name, blocks] of Object.entries(areas)) {
    areaElements[name] = wrapArea(name, renderBlocks(blocks))
  }

  if (RemoteLayout) {
    const params = { ...(layoutMeta?.defaults || {}), ...(page.getLayoutParams() || {}) }
    return React.createElement(RemoteLayout, {
      page, website, params,
      body: bodyElement,
      ...areaElements,
    })
  }

  // The built-in layout — the browser's own copy, not a mirror of it (`default-layout.js`).
  // ⛔ Until 2026-10-07 this wrote its own, with no full-height column, so the prerendered
  // page differed from the one the browser renders over it.
  const zone = (name) => zoneProps(sticky[name], layers?.[name])
  return React.createElement(DefaultLayout, {
    body: bodyElement,
    ...areaElements,
    zones: { header: zone('header'), footer: zone('footer') },
  })
}

// ============================================================================
// Layer 2: Initialization
// ============================================================================

/**
 * Construct a Uniweb singleton scoped to a single locale.
 *
 * Combines the three steps that every SSR consumer (browser SPA, Node
 * SSG, a server-side isolate) needs in the same order: slice the
 * multi-locale content payload, run `initPrerender` (which builds the
 * Website + wires foundation capabilities), then `setActiveLocale` so
 * `website.activeLang` stays in sync with what the page is rendering
 * for. Caller still owns DataStore hydration (per-request data differs
 * between requests; locale construction can be cached).
 *
 * @param {Object} content - Site content payload (possibly multi-locale).
 * @param {Object} foundation - Loaded foundation module.
 * @param {string} locale - Locale code to render in.
 * @param {Array<Object>|Object} [extensionsOrOptions] - Same shape as initPrerender's
 *   third arg: an extensions array, or an options object when no extensions.
 * @param {Object} [maybeOptions] - Options object when extensions are passed.
 * @returns {import('@uniweb/core').default} The configured Uniweb singleton.
 */
export function initPrerenderForLocale(content, foundation, locale, extensionsOrOptions, maybeOptions) {
  const localeContent = sliceContentForLocale(content, locale)
  const uniweb = initPrerender(localeContent, foundation, extensionsOrOptions, maybeOptions)
  const defaultLang = resolveDefaultLocale(content?.config)
  if (locale && locale !== defaultLang && uniweb.activeWebsite?.setActiveLocale) {
    uniweb.activeWebsite.setActiveLocale(locale)
  }
  return uniweb
}

/**
 * Create and configure the Uniweb runtime for prerendering.
 *
 * Handles the full initialization sequence in the correct order:
 * createUniweb → setFoundation → capabilities → layoutMeta → basePath → childBlockRenderer.
 *
 * Returns the configured uniweb instance. Consumers can add extras after:
 * - Build: pre-populate DataStore, load extensions
 * - A server-side renderer: (none needed — the payload is complete)
 *
 * NOTE: Does NOT clone content. Cloning is the consumer's responsibility
 * (build modifies content before init; a server-side renderer clones upfront).
 *
 * @param {Object} content - Site content JSON (pages, config, hierarchy)
 * @param {Object} foundation - Loaded foundation module
 * @param {Object} [options]
 * @param {function} [options.onProgress] - Progress callback
 * @returns {Object} Configured uniweb instance
 */
export function initPrerender(content, foundation, extensionsOrOptions, maybeOptions) {
  // Backwards-compatible arg shape: (content, foundation, options) or
  // (content, foundation, extensions, options). Extensions must be passed at
  // construction so the Website's FetcherDispatcher sees their routes.
  let extensions = []
  let options = {}
  if (Array.isArray(extensionsOrOptions)) {
    extensions = extensionsOrOptions
    options = maybeOptions || {}
  } else {
    options = extensionsOrOptions || {}
  }
  const { onProgress = () => {} } = options

  onProgress('Initializing runtime...')
  // Uniweb constructor wires foundation, capabilities, layoutMeta, handlers,
  // and extensions at construction time — see `@uniweb/core`'s src/uniweb.js.
  const uniweb = createUniweb(content, foundation, extensions)
  // Before anything renders: the active page every render starts from (`start-page.js`).
  recordStartPage(uniweb.activeWebsite)

  // Set base path from site config for subdirectory deployments
  if (content.config?.base && uniweb.activeWebsite?.setBasePath) {
    uniweb.activeWebsite.setBasePath(content.config.base)
  }

  // Set childBlockRenderer so ChildBlocks/Visual/Render work during prerender.
  // Mirrors the client's ChildBlocks component in PageRenderer.jsx:
  // - default bare rendering (no wrapAs) — component only, no wrapper
  // - pass wrapAs to opt into full section treatment
  uniweb.childBlockRenderer = function InlineChildBlocks({ blocks, from, wrapAs }) {
    const blockList = blocks || from?.childBlocks || []
    return blockList.map((childBlock, index) =>
      React.createElement(React.Fragment, { key: childBlock.id || index },
        renderBlock(childBlock, { as: wrapAs || null, stickySelf: wrapAs ? 'child' : false })
      )
    )
  }

  // The same background a section gets, for kit's `SectionBackground` — a component that
  // paints its own (`background: 'self'`). The one implementation, which the browser draws
  // too (setup.js); its `className` is the layer's. ⛔ Until 2026-10-25 this dropped it.
  uniweb.backgroundRenderer = Background

  // L2 (singleton wiring): defaultInsets, xref.build(), and any future
  // framework-level capability bridge — shared with setup.js so both
  // boot paths apply the same foundation contract. See
  // wire-foundation.js — its header states the rule for what belongs in
  // that helper vs. here vs. setup.js.
  wireFoundationCapabilities(uniweb, foundation)

  // Site-wide theme CSS. Unconditional here: at this point there is no
  // <head> to inspect, and injectPageContent() emits the result
  // idempotently, so a lane that already baked the style tag is unaffected.
  ensureThemeCss(uniweb, foundation)

  // Register SSR-safe routing so useRouting()/useActiveRoute() work during prerender.
  // renderPage() calls website.setActivePage() before rendering each page,
  // so activePage.route reflects the page being rendered — except the site's
  // not-found page, which no route names. Through `createPageRenderer` it renders
  // with the page a route served from elsewhere names, else the page the Website
  // starts with (`start-page.js`); through `generate404Html`, with the page
  // rendered last.
  const website = uniweb.activeWebsite
  uniweb.routingComponents = {
    useLocation: () => {
      // ⛔ `activePage.route` IS ALREADY ROOT-RELATIVE — `/`, `/about`. This used to
      // return `'/' + route`, so every prerendered page reported a pathname with a
      // doubled leading slash: `//` on the homepage, `//about` elsewhere.
      //
      // It failed silently for as long as it existed, because nothing in the
      // runtime reads pathname — a FOUNDATION does. Measured 2026-09-18: a language
      // switcher passing `useLocation().pathname` to `getLocaleUrl` emitted
      // `href="//"`, which a browser resolves as a PROTOCOL-RELATIVE url (host
      // empty), not as the site root. The SPA was unaffected, so it reproduced only
      // in the built output.
      const route = website?.activePage?.route || '/'
      const pathname = route.startsWith('/') ? route : `/${route}`
      return { pathname, search: '', hash: '', state: null, key: 'default' }
    },
    useParams: () => ({}),
    useNavigate: () => () => {},
  }

  return uniweb
}

/**
 * Pre-fetch icons from CDN and populate the Uniweb icon cache.
 * Stores the cache on siteContent._iconCache for embedding in HTML.
 *
 * @param {Object} siteContent - Site content JSON (mutated: _iconCache added)
 * @param {Object} uniweb - Configured uniweb instance
 * @param {function} [onProgress] - Progress callback
 */
export async function prefetchIcons(siteContent, uniweb, onProgress = () => {}) {
  const icons = siteContent.icons?.used || []
  if (icons.length === 0) return

  const cdnBase = siteContent.config?.icons?.cdnUrl || DEFAULT_ICON_BASE

  onProgress(`Fetching ${icons.length} icons for SSR...`)

  const results = await Promise.allSettled(
    icons.map(async (iconRef) => {
      const [family, name] = iconRef.split(':')
      const url = iconUrl(family, name, cdnBase)
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return [`${family}:${name}`, await response.text()]
    })
  )
  // ⭐ Cached in the order the build names the icons (`icons.used`, sorted), never the order their
  // fetches settle in: the cache is written into every page (`_iconCache`, `__ICON_CACHE__`), so
  // in arrival order two builds of one site wrote different pages. ⛔ Until 2026-10-25 each icon
  // was cached as it arrived (measured: three builds of one site, three orders).
  for (const result of results) {
    if (result.status === 'fulfilled') uniweb.iconCache.set(...result.value)
  }

  const succeeded = results.filter(r => r.status === 'fulfilled').length
  const failedRefs = icons.filter((_, i) => results[i].status === 'rejected')
  if (failedRefs.length > 0) {
    // Named, so an author can fix the reference. ⛔ Until 2026-10-24 this said only "(1 failed)",
    // and a missing icon on a live page took a search through every reference to find.
    const shown = failedRefs.slice(0, 10).join(', ') + (failedRefs.length > 10 ? ', …' : '')
    const msg = `Fetched ${succeeded}/${icons.length} icons (${failedRefs.length} failed: ${shown})`
    console.warn(`[prerender] ${msg}`)
    onProgress(`  ${msg}`)
  }

  // Store icon cache on siteContent for embedding in HTML
  if (uniweb.iconCache.size > 0) {
    siteContent._iconCache = Object.fromEntries(uniweb.iconCache)
  }
}

// ============================================================================
// Layer 3: Per-page rendering
// ============================================================================

// ⭐ `resolvePage` LIVES IN ITS OWN LEAF and is re-exported here, so the public
// `@uniweb/runtime/ssr` surface is unchanged. It is `website.getPage` and needs
// no renderer; this file imports `react-dom/server` at module scope, so a caller
// that only wants the lookup used to get React's server renderer with it
// (`./resolve-page.js`, 2026-09-20).
export { resolvePage } from './resolve-page.js'

/**
 * Classify an SSR rendering error.
 *
 * @param {Error} err
 * @returns {{ type: 'hooks'|'null-component'|'unknown', message: string }}
 */
export function classifyRenderError(err) {
  const msg = err.message || ''

  if (msg.includes('Invalid hook call') || msg.includes('useState') || msg.includes('useEffect')) {
    return {
      type: 'hooks',
      message: 'contains components with React hooks (renders client-side)',
    }
  }

  if (msg.includes('Element type is invalid') && msg.includes('null')) {
    return {
      type: 'null-component',
      message: 'a component resolved to null (often hook-related, renders client-side)',
    }
  }

  return {
    type: 'unknown',
    message: msg,
  }
}

/**
 * Render a single page to HTML.
 *
 * Handles the full per-page pipeline:
 * setActivePage → renderLayout → renderToString → error handling → section override CSS.
 *
 * @param {Page} page - Page instance to render
 * @param {Website} website - Website instance
 * @returns {{ renderedContent: string, sectionOverrideCSS: string } | { error: { type: string, message: string } }}
 */
export function renderPage(page, website) {
  // ⛔ The site's not-found page is never made active by its route. No route names it, and on a
  // site whose parametric page matches `/404` (a root `/:slug`) that route names THAT page, which
  // then rendered as the active one. It renders with the active page it finds: the Website's
  // first, through `createPageRenderer` (`start-page.js`), as in the browser.
  if (page !== website.getNotFoundPage()) website.setActivePage(page.route)

  // A page that claims content but yields no blocks has not been loaded — it is
  // not an empty page. `Page#bodyBlocks` returns [] when its sections are absent
  // from the payload (split content), on the understanding that a caller loads
  // them first: the SPA does, in PageRenderer and at boot. THIS path never has.
  //
  // Left alone, that renders a structurally valid, completely empty document and
  // reports success — which is the worst shape a failure can take, and it cost a
  // host most of a day chasing a renderer that was doing what it was told.
  // Distinguishing it here is cheap: a content-less container reports
  // hasContent() === false and is correctly empty, so the two never collide.
  if (page.hasContent?.() && page.getBodyBlocks().length === 0) {
    return {
      error: {
        type: 'content-not-loaded',
        message:
          `page "${page.route}" declares content but has no loaded sections — ` +
          'its sections are not in the payload and this renderer does not fetch them',
      },
    }
  }

  const element = renderLayout(page, website)

  let renderedContent
  try {
    renderedContent = renderToString(element)
  } catch (err) {
    return { error: classifyRenderError(err) }
  }

  // Build per-page section override CSS (theme pinning, component vars)
  const appearance = website.themeData?.appearance
  // Every block the page renders — each layout area it shows, a sidebar too; the builder walks
  // their child sections. The SPA renderer passes the same (`PageRenderer.jsx`).
  const sectionOverrideCSS = buildSectionOverrides(page.getAllBlocks(), appearance)

  return { renderedContent, sectionOverrideCSS }
}

// ============================================================================
// HTML injection
// ============================================================================

// Escape HTML special characters — the one implementation, which a page's shell writes with too
// (`@uniweb/core/page-shell`). Still exported from here, as it has been since 0.6.14.
export { escapeHtml }

/**
 * Inject prerendered content into an HTML shell.
 *
 * THE SHARED PRERENDER SEAM. Every lane that turns a Page into HTML calls this:
 * the framework's SSG (@uniweb/build's prerender.js) and the cloud worker's
 * just-in-time render. Anything a page needs *because it was prerendered at all*
 * belongs here, so a new feature reaches both lanes at once.
 *
 * Common operations shared by both build and cloud:
 * - Replace #root div with rendered HTML
 * - Update page title
 * - Write the page's head tags — description, canonical, hreflang, Open Graph (`writeHeadMeta`)
 * - Inject section override CSS
 * - Inject the pre-paint appearance script
 *
 * Build layers its additional injections on top of this return value:
 * __SITE_CONTENT__ JSON, icon cache, theme CSS (build-specific).
 *
 * WHICH SIDE OF THE SEAM? Ask what the injection is derived from. If it needs
 * only the page/website graph — which every lane has — it goes here. If it needs
 * a build-only artifact (the emitted bundle, the collection JSON files, the
 * prefetched icon cache, the compiled theme CSS), it goes in the caller. Getting
 * this wrong is silent: the appearance boot script started life in
 * @uniweb/build's injectBuildData and therefore never reached cloud-rendered
 * pages, which flashed light for every dark-mode visitor.
 *
 * @param {string} html - HTML shell
 * @param {string} renderedContent - React renderToString output
 * @param {Object} page - Page data { title, description, route }
 * @param {Object} [options]
 * @param {string} [options.sectionOverrideCSS] - Per-page section override CSS
 * @returns {string} HTML with injected content
 */
export function injectPageContent(html, renderedContent, page, options = {}) {
  let result = html

  // Pre-paint appearance script. Prerendered HTML carries real content styled
  // from :root (light) tokens, so a dark visitor would see a flash of light
  // before the bundle boots and applies the class. Read off the page's
  // website back-ref rather than a parameter: every lane builds the same graph,
  // so this needs no plumbing and no per-lane opt-in. Idempotent, because
  // @uniweb/build's injectBuildData may run over this HTML afterwards.
  if (!result.includes('id="uniweb-appearance"')) {
    const bootScript = renderAppearanceBootScript(page?.website?.themeData?.appearance)
    if (bootScript) {
      result = result.replace('</head>', `  ${bootScript}\n</head>`)
    }
  }

  // Site-wide theme CSS. Derived from the website graph
  // (`website.themeData`), so it belongs on THIS side of the seam — every
  // lane builds that graph. It lived in @uniweb/build's injectBuildData
  // until 2026-07-28, which meant sites served by any lane that doesn't run
  // the framework's build rendered with every semantic token unset: no
  // colours, no backgrounds, no failure anywhere. That is the same mistake
  // the appearance script above was moved out of, four lines below the
  // comment warning about it — see the note in `@uniweb/build`'s src/prerender.js.
  // Idempotent, so a shell that already carries the tag is left alone.
  const themeData = page?.website?.themeData
  const themeCss = themeData?.css
  if (themeCss && !result.includes('id="uniweb-theme"')) {
    result = result.replace(
      '</head>',
      `  <style id="uniweb-theme">\n${themeCss}\n    </style>\n</head>`
    )
  }

  // The theme's font <link> tags — same seam, same reasoning. Graph-derived,
  // so a lane that never runs @uniweb/build still gets its webfonts instead of
  // falling back to system faces. Deduped on FONT_LINKS_MARKER rather than an
  // id because <link> tags have none; the marker is owned by @uniweb/theming,
  // which generates the block, so this and @uniweb/build read one literal.
  if (themeData?.links && !result.includes(FONT_LINKS_MARKER)) {
    result = result.replace(
      '</head>',
      `  ${FONT_LINKS_MARKER}\n${themeData.links}\n</head>`
    )
  }

  // Inject per-page section override CSS before </head>
  if (options.sectionOverrideCSS) {
    const overrideStyle = `<style id="uniweb-page-overrides">\n${options.sectionOverrideCSS}\n</style>`
    result = result.replace('</head>', `${overrideStyle}\n</head>`)
  }

  // Replace the empty root div with pre-rendered content
  result = result.replace(
    /<div id="root">[\s\S]*?<\/div>/,
    `<div id="root">${renderedContent}</div>`
  )

  // Update the document title — by the rule the SPA sets `document.title` with
  // (`documentTitle`: `<page> | <site>`), so the title a crawler reads here is the one a
  // visitor keeps once the bundle loads. ⛔ Until 2026-09-14 this wrote the page title
  // alone. getTitle() so isIndex pages inherit their parent's title.
  const title = documentTitle(page.getTitle?.() || page.title, page.website?.name)
  if (title) {
    result = result.replace(
      /<title>.*?<\/title>/,
      `<title>${escapeHtml(title)}</title>`
    )
  }

  // ⭐ THE PAGE'S HEAD TAGS — description, canonical, hreflang, Open Graph, Twitter — from the
  // page's own head metadata (`Page#getHeadMeta`, which the browser writes the same tags from in
  // `useHeadMeta`), so crawlers and social unfurlers, which run no script, read the page's own.
  // ⛔ Until 2026-10-25 these were APPENDED, after the static build had written the HOME page's
  // into the one shell every page is rendered into: each page named the home page its canonical
  // and carried two og:title and two og:url, the home page's first.
  result = writeHeadMeta(result, page)

  return result
}

/**
 * Write a page's head tags into `html`'s head. These tags are the framework's: each is set to the
 * page's value, replacing any of its name the shell carries, and removed when the page has none —
 * as the browser does on every navigation (`useHeadMeta`), so hydrating the page changes nothing a
 * crawler read.
 *
 * @param {string} html
 * @param {Object} page
 * @returns {string}
 */
function writeHeadMeta(html, page) {
  // A Page states its own (`getHeadMeta`); plain page data, which callers may hand in, its fields.
  const meta = typeof page?.getHeadMeta === 'function' ? page.getHeadMeta() : { description: page?.description || null }
  const end = html.indexOf('</head>')
  if (!meta || end === -1) return html
  const og = meta.og || {}
  const keywords = Array.isArray(meta.keywords) ? meta.keywords.join(', ') : meta.keywords
  const metaTags = [
    ['name', 'description', meta.description],
    ['name', 'keywords', keywords],
    ['name', 'robots', meta.robots],
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', og.siteName],
    ['property', 'og:title', og.title],
    ['property', 'og:description', og.description],
    ['property', 'og:image', og.image],
    ['property', 'og:url', og.url],
    ['name', 'twitter:card', og.image ? 'summary_large_image' : 'summary'],
    ['name', 'twitter:site', meta.twitter?.site],
    ['name', 'twitter:title', og.title],
    ['name', 'twitter:description', og.description],
    ['name', 'twitter:image', og.image],
  ]
  // The head alone: the page's content is in the body, and none of it is edited here.
  let head = html.slice(0, end)
  const written = []
  for (const [attr, key, value] of metaTags) {
    head = head.replace(new RegExp(`<meta\\b[^>]*\\b(?:name|property)=["']${key}["'][^>]*>\\s*`, 'gi'), '')
    if (value) written.push(`<meta ${attr}="${key}" content="${escapeHtml(value)}">`)
  }
  head = head.replace(/<link\b[^>]*\brel=["']canonical["'][^>]*>\s*/gi, '')
  if (meta.canonical) written.push(`<link rel="canonical" href="${escapeHtml(meta.canonical)}">`)
  head = head.replace(/<link\b[^>]*\bhreflang=["'][^"']*["'][^>]*>\s*/gi, '')
  for (const { hreflang, url } of meta.alternates || []) {
    written.push(`<link rel="alternate" hreflang="${escapeHtml(hreflang)}" href="${escapeHtml(url)}">`)
  }
  return `${head}${written.join('\n')}\n${html.slice(end)}`
}

// ============================================================================
// 404 fallback generation
// ============================================================================

/**
 * Generate 404.html content for static hosting fallback.
 *
 * Serves two purposes on static hosts (GitHub Pages, Cloudflare Pages, etc.):
 *  1. Real 404: pre-rendered custom 404 page content (or blank #root if none defined)
 *  2. Valid dynamic route (e.g. /blog/2): inline script clears #root so SPA renders fresh
 *
 * Flow: static host serves 404.html → inline script runs before React mounts →
 *   - dynamic route: clears #root, React renders the page normally
 *   - real 404: leaves #root with pre-rendered content, React re-renders same 404 page
 *
 * @param {Object} options
 * @param {string} options.baseHtml - Assembled HTML shell (with site content already injected)
 * @param {Object} options.website - Initialized Website instance (from initPrerender)
 * @param {Object} options.siteContent - Site content object (to find dynamic templates)
 * @returns {{ html: string, hasNotFoundPage: boolean }}
 */
export function generate404Html({ baseHtml, website, siteContent }) {
  // Extract patterns for routes that remain as dynamic templates (prerender: false)
  // '/blog/:id' → /^\/blog\/([^/]+)$/. Compiled by the shared matcher rather
  // than a second regex built here: this file used to build its own with
  // `:[^/]+`, which disagreed with core's `:(\w+)` on any param name carrying a
  // non-word character. See @uniweb/core/route-match for the whole story.
  // ⛔ **ROUTE, NOT THE FLAG — a filter must not read absence as "not parametric".**
  // This filtered on `p.isDynamic` alone. A producer that marks only the bracket
  // page (or none at all) left every parametric route out of the list, so a cold
  // hit on one showed the 404 body and never cleared #root for the SPA. The flag
  // is a producer's claim; the `:` in the route is the thing itself, and every
  // flagged page has one — so this is a superset and cannot lose a route.
  const dynamicTemplates = siteContent.pages?.filter((p) => p.isDynamic || isDynamicRoute(p.route)) || []
  const routePatterns = dynamicTemplates.map((p) => routePatternToRegex(p.route).regex.source)

  let html = baseHtml

  // Pre-render the custom 404 page content into #root (if the site defines one),
  // otherwise inject a default 404 message so the page isn't blank before JS loads
  const notFoundPage = website.getNotFoundPage()
  if (notFoundPage) {
    const notFoundResult = renderPage(notFoundPage, website)
    if (notFoundResult && !notFoundResult.error) {
      html = injectPageContent(html, notFoundResult.renderedContent, notFoundPage, {
        sectionOverrideCSS: notFoundResult.sectionOverrideCSS,
      })
    }
  } else {
    const basePath = website.basePath || ''
    html = html.replace(
      /<div id="root">[\s\S]*?<\/div>/,
      `<div id="root">${default404Html(basePath)}</div>`
    )
  }

  // Inject inline script: if path matches a dynamic route, clear #root before React mounts
  // so the SPA renders the correct page rather than the 404 content
  if (routePatterns.length > 0) {
    const patternList = routePatterns.map((p) => `/${p}/`).join(',')
    // The path is normalized here rather than by making every pattern accept a
    // trailing slash — same rule the matcher applies, applied in one place.
    const dynamicScript =
      `<script>(function(){` +
      `var p=[${patternList}],r=window.location.pathname.replace(/\\/+$/,'')||'/';` +
      `if(p.some(function(x){return x.test(r)})){` +
      `var el=document.getElementById('root');if(el)el.innerHTML='';` +
      `}})()</script>`
    html = html.replace('</body>', `${dynamicScript}\n</body>`)
  }

  return { html, hasNotFoundPage: !!notFoundPage }
}
