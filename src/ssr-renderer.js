/**
 * SSR Renderer
 *
 * Hook-free rendering pipeline for SSG (build) and cloud SSR (unicloud).
 * Mirrors BlockRenderer.jsx + Background.jsx using React.createElement
 * directly — no hooks, no JSX, no browser APIs.
 *
 * This is the single source of truth for how blocks render during prerender.
 * When modifying BlockRenderer.jsx or Background.jsx, update this file to match.
 *
 * Exports three layers:
 *   1. Rendering functions (renderBlock, renderBlocks, renderLayout, renderBackground)
 *   2. Initialization (initPrerender, prefetchIcons)
 *   3. Per-page rendering (renderPage, classifyRenderError, injectPageContent, escapeHtml)
 */

import React from 'react'
import { renderToString } from 'react-dom/server'
import { createUniweb } from '@uniweb/core'
import { buildSectionOverrides } from '@uniweb/theming'
import { prepareProps, getComponentMeta } from './prepare-props.js'

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

  const { background = {} } = block.standardOptions
  const style = {}

  // If background has content, ensure relative positioning and a stacking context
  // so the background's z-index stays contained within this section.
  if (background.mode) {
    style.position = 'relative'
    style.isolation = 'isolate'
  }

  // Apply context overrides as inline CSS custom properties
  if (block.contextOverrides) {
    for (const [key, value] of Object.entries(block.contextOverrides)) {
      style[`--${key}`] = value
    }
  }

  // Use stableId for DOM ID if available (stable across reordering)
  const sectionId = block.stableId || block.id

  return { id: `section-${sectionId}`, style, className, background }
}

/**
 * Convert hex/rgb color to rgba with opacity.
 * Mirrors withOpacity() in Background.jsx.
 */
function withOpacity(color, opacity) {
  if (color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${opacity})`
  }
  if (color.startsWith('rgb')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (match) {
      return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${opacity})`
    }
  }
  return color
}

/**
 * Resolve a URL against the site's base path.
 * Mirrors resolveUrl() in Background.jsx.
 */
function resolveUrl(url) {
  if (!url || !url.startsWith('/')) return url
  const basePath = globalThis.uniweb?.activeWebsite?.basePath || ''
  if (!basePath) return url
  if (url.startsWith(basePath + '/') || url === basePath) return url
  return basePath + url
}

/**
 * Render a background element for SSR.
 * Mirrors Background.jsx (color, gradient, image — not video).
 * Video backgrounds require JS for autoplay and are skipped during SSR.
 */
export function renderBackground(background) {
  if (!background?.mode) return null

  const containerStyle = {
    position: 'absolute',
    inset: '0',
    overflow: 'hidden',
    zIndex: 0,
  }

  const children = []

  // Color background
  if (background.mode === 'color' && background.color) {
    children.push(
      React.createElement('div', {
        key: 'bg-color',
        className: 'background-color',
        style: { position: 'absolute', inset: '0', backgroundColor: background.color },
        'aria-hidden': 'true',
      })
    )
  }

  // Gradient background (supports string or object with opacity)
  if (background.mode === 'gradient' && background.gradient) {
    const g = background.gradient

    let bgValue
    if (typeof g === 'string') {
      bgValue = g
    } else {
      const {
        start = 'transparent',
        end = 'transparent',
        angle = 0,
        startPosition = 0,
        endPosition = 100,
        startOpacity = 1,
        endOpacity = 1,
      } = g
      const startColor = startOpacity < 1 ? withOpacity(start, startOpacity) : start
      const endColor = endOpacity < 1 ? withOpacity(end, endOpacity) : end
      bgValue = `linear-gradient(${angle}deg, ${startColor} ${startPosition}%, ${endColor} ${endPosition}%)`
    }

    children.push(
      React.createElement('div', {
        key: 'bg-gradient',
        className: 'background-gradient',
        style: { position: 'absolute', inset: '0', background: bgValue },
        'aria-hidden': 'true',
      })
    )
  }

  // Image background
  if (background.mode === 'image' && background.image?.src) {
    const img = background.image
    children.push(
      React.createElement('div', {
        key: 'bg-image',
        className: 'background-image',
        style: {
          position: 'absolute',
          inset: '0',
          backgroundImage: `url(${resolveUrl(img.src)})`,
          backgroundPosition: img.position || 'center',
          backgroundSize: img.size || 'cover',
          backgroundRepeat: 'no-repeat',
        },
        'aria-hidden': 'true',
      })
    )
  }

  // Overlay (gradient or solid)
  if (background.overlay?.enabled) {
    const ov = background.overlay
    let overlayStyle

    if (ov.gradient) {
      const g = ov.gradient
      overlayStyle = {
        position: 'absolute', inset: '0', pointerEvents: 'none',
        background: `linear-gradient(${g.angle || 180}deg, ${g.start || 'rgba(0,0,0,0.7)'} ${g.startPosition || 0}%, ${g.end || 'rgba(0,0,0,0)'} ${g.endPosition || 100}%)`,
        opacity: ov.opacity ?? 0.5,
      }
    } else {
      const baseColor = ov.type === 'light' ? '255, 255, 255' : '0, 0, 0'
      overlayStyle = {
        position: 'absolute', inset: '0', pointerEvents: 'none',
        backgroundColor: `rgba(${baseColor}, ${ov.opacity ?? 0.5})`,
      }
    }

    children.push(
      React.createElement('div', {
        key: 'bg-overlay',
        className: ov.gradient ? 'background-overlay background-overlay--gradient' : 'background-overlay background-overlay--solid',
        style: overlayStyle,
        'aria-hidden': 'true',
      })
    )
  }

  if (children.length === 0) return null

  return React.createElement('div', {
    className: `background background--${background.mode}`,
    style: containerStyle,
    'aria-hidden': 'true',
  }, ...children)
}

/**
 * Render a single block for SSR.
 * Mirrors BlockRenderer.jsx but without hooks (no runtime data fetching).
 *
 * @param {Block} block - Block instance to render
 * @param {Object} [options]
 * @param {boolean} [options.pure=false] - Render component without section wrapper (used by ChildBlocks)
 * @returns {React.ReactElement}
 */
export function renderBlock(block, { pure = false, as = undefined } = {}) {
  const Component = block.initComponent()

  if (!Component) {
    return React.createElement('div', {
      className: 'block-error',
      style: { padding: '1rem', background: '#fef2f2', color: '#dc2626' },
    }, `Component not found: ${block.type}`)
  }

  // Build content and params with runtime guarantees
  const meta = getComponentMeta(block.type)
  const prepared = prepareProps(block, meta)
  const params = prepared.params
  const content = { ...prepared.content, ...block.properties }

  // Resolve inherited entity data (mirrors BlockRenderer.jsx)
  // EntityStore walks page/site hierarchy to find data matching meta.inheritData
  const entityStore = block.website?.entityStore
  if (entityStore) {
    const resolved = entityStore.resolve(block, meta)
    if (resolved.status === 'ready' && resolved.data) {
      const merged = { ...content.data }
      for (const key of Object.keys(resolved.data)) {
        if (merged[key] === undefined) {
          merged[key] = resolved.data[key]
        }
      }
      content.data = merged
    }
  }

  const componentProps = { content, params, block }

  // Pure mode: render component without section wrapper (used by ChildBlocks)
  if (pure) {
    return React.createElement(Component, componentProps)
  }

  // Background handling (mirrors BlockRenderer.jsx)
  const { background, ...wrapperProps } = getWrapperProps(block)

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

  // Use Component.as as the wrapper tag (default: 'section').
  // An explicit `as` prop (e.g. 'div' from ChildBlocks) overrides Component.as,
  // mirroring the BlockRenderer.jsx Wrapper resolution logic.
  const wrapperTag = (as !== undefined && as !== 'section') ? as : (Component.as || 'section')

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
export function renderBlocks(blocks) {
  if (!blocks || blocks.length === 0) return null
  return blocks.map((block, index) =>
    React.createElement(React.Fragment, { key: block.id || index },
      renderBlock(block)
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

  const bodyElement = bodyBlocks ? renderBlocks(bodyBlocks) : null
  const areaElements = {}
  for (const [name, blocks] of Object.entries(areas)) {
    areaElements[name] = renderBlocks(blocks)
  }

  if (RemoteLayout) {
    const params = { ...(layoutMeta?.defaults || {}), ...(page.getLayoutParams() || {}) }
    return React.createElement(RemoteLayout, {
      page, website, params,
      body: bodyElement,
      ...areaElements,
    })
  }

  // Default layout
  return React.createElement(React.Fragment, null,
    areaElements.header && React.createElement('header', null, areaElements.header),
    bodyElement && React.createElement('main', null, bodyElement),
    areaElements.footer && React.createElement('footer', null, areaElements.footer)
  )
}

// ============================================================================
// Layer 2: Initialization
// ============================================================================

/**
 * Create and configure the Uniweb runtime for prerendering.
 *
 * Handles the full initialization sequence in the correct order:
 * createUniweb → setFoundation → capabilities → layoutMeta → basePath → childBlockRenderer.
 *
 * Returns the configured uniweb instance. Consumers can add extras after:
 * - Build: pre-populate DataStore, load extensions
 * - Unicloud: (none needed — payload is complete)
 *
 * NOTE: Does NOT clone content. Cloning is the consumer's responsibility
 * (build modifies content before init; unicloud clones upfront).
 *
 * @param {Object} content - Site content JSON (pages, config, hierarchy)
 * @param {Object} foundation - Loaded foundation module
 * @param {Object} [options]
 * @param {function} [options.onProgress] - Progress callback
 * @returns {Object} Configured uniweb instance
 */
export function initPrerender(content, foundation, options = {}) {
  const { onProgress = () => {} } = options

  onProgress('Initializing runtime...')
  const uniweb = createUniweb(content)
  uniweb.setFoundation(foundation)

  // Set foundation capabilities (Layout, props, etc.)
  if (foundation.default?.capabilities) {
    uniweb.setFoundationConfig(foundation.default.capabilities)
  }

  // Attach layout metadata (areas, transitions, defaults)
  if (foundation.default?.layoutMeta && uniweb.foundationConfig) {
    uniweb.foundationConfig.layoutMeta = foundation.default.layoutMeta
  }

  // Set base path from site config for subdirectory deployments
  if (content.config?.base && uniweb.activeWebsite?.setBasePath) {
    uniweb.activeWebsite.setBasePath(content.config.base)
  }

  // Set childBlockRenderer so ChildBlocks/Visual/Render work during prerender.
  // Mirrors the client's ChildBlocks component in PageRenderer.jsx:
  // - default as='div' so nested blocks use <div> wrapper (not <section>)
  //   matching the client and avoiding React hydration mismatch (error #418)
  uniweb.childBlockRenderer = function InlineChildBlocks({ blocks, from, pure = false, as = 'div' }) {
    const blockList = blocks || from?.childBlocks || []
    return blockList.map((childBlock, index) =>
      React.createElement(React.Fragment, { key: childBlock.id || index },
        renderBlock(childBlock, { pure, as })
      )
    )
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

  const cdnBase = siteContent.config?.icons?.cdnUrl || 'https://uniweb.github.io/icons'

  onProgress(`Fetching ${icons.length} icons for SSR...`)

  const results = await Promise.allSettled(
    icons.map(async (iconRef) => {
      const [family, name] = iconRef.split(':')
      const url = `${cdnBase}/${family}/${family}-${name}.svg`
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const svg = await response.text()
      uniweb.iconCache.set(`${family}:${name}`, svg)
    })
  )

  const succeeded = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected').length
  if (failed > 0) {
    const msg = `Fetched ${succeeded}/${icons.length} icons (${failed} failed)`
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
  website.setActivePage(page.route)

  const element = renderLayout(page, website)

  let renderedContent
  try {
    renderedContent = renderToString(element)
  } catch (err) {
    return { error: classifyRenderError(err) }
  }

  // Build per-page section override CSS (theme pinning, component vars)
  const appearance = website.themeData?.appearance
  const sectionOverrideCSS = buildSectionOverrides(page.getPageBlocks(), appearance)

  return { renderedContent, sectionOverrideCSS }
}

// ============================================================================
// HTML injection
// ============================================================================

/**
 * Escape HTML special characters.
 */
export function escapeHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Inject prerendered content into an HTML shell.
 *
 * Common operations shared by both build and cloud:
 * - Replace #root div with rendered HTML
 * - Update page title
 * - Add/update meta description
 * - Inject section override CSS
 *
 * Build layers its additional injections on top of this return value:
 * __SITE_CONTENT__ JSON, icon cache, theme CSS (build-specific).
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

  // Update page title (use getTitle() so isIndex pages inherit parent title)
  const pageTitle = page.getTitle?.() || page.title
  if (pageTitle) {
    result = result.replace(
      /<title>.*?<\/title>/,
      `<title>${escapeHtml(pageTitle)}</title>`
    )
  }

  // Add/update meta description
  if (page.description) {
    const metaDesc = `<meta name="description" content="${escapeHtml(page.description)}">`
    if (result.includes('<meta name="description"')) {
      result = result.replace(/<meta name="description"[^>]*>/, metaDesc)
    } else {
      result = result.replace('</head>', `${metaDesc}\n</head>`)
    }
  }

  return result
}
