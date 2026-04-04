/**
 * BlockRenderer
 *
 * Bridges Block data to foundation components.
 * Handles theming, wrapper props, and runtime guarantees.
 * Uses EntityStore for entity-aware data resolution.
 */

import React, { useState, useEffect } from 'react'
import { prepareProps, getComponentMeta } from '../prepare-props.js'
import Background from './Background.jsx'

/**
 * Valid color contexts
 */
const VALID_CONTEXTS = ['light', 'medium', 'dark']

/**
 * Build wrapper props from block configuration
 */
const getWrapperProps = (block) => {
  const theme = block.themeName
  const blockClassName = block.state?.className || ''

  // Build context class (context-light, context-medium, context-dark)
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

  // Apply context overrides as inline CSS custom properties.
  // These override the context class tokens for this specific section.
  if (block.contextOverrides) {
    for (const [key, value] of Object.entries(block.contextOverrides)) {
      style[`--${key}`] = value
    }
  }

  // Use stableId for DOM ID if available (stable across reordering)
  // Falls back to positional id for backwards compatibility
  const sectionId = block.stableId || block.id

  return {
    id: `section-${sectionId}`,
    style,
    className,
    background
  }
}

/**
 * BlockRenderer component
 *
 * Two rendering modes:
 * - Bare (as=null/false): component only, no wrapper — used by ChildBlocks (default)
 * - Section (as='section'/'div'/etc.): full treatment with wrapper element, context
 *   classes, background, section ID — used by page-level Blocks component
 *
 * @param {Object} props
 * @param {Block} props.block - Block instance to render
 * @param {string|null} props.as - Wrapper element tag for section mode, or null/false for bare mode
 */
export default function BlockRenderer({ block, as = 'section' }) {
  const Component = block.initComponent()

  // Entity-aware data resolution via EntityStore
  const entityStore = block.website.entityStore
  const meta = getComponentMeta(block.type)

  const resolved = entityStore.resolve(block, meta)

  // Async data for when resolve returns 'pending' (runtime fetches)
  const [asyncData, setAsyncData] = useState(null)

  // Reset async data when block changes (SPA navigation)
  useEffect(() => {
    setAsyncData(null)
  }, [block])

  // Fetch missing data asynchronously
  useEffect(() => {
    if (resolved.status !== 'pending') return

    let cancelled = false
    entityStore.fetch(block, meta).then((result) => {
      if (!cancelled && result.data) setAsyncData(result.data)
    })
    return () => { cancelled = true }
  }, [block])

  // Use sync resolved data when available, fall back to async
  const entityData = resolved.status === 'ready' ? resolved.data : asyncData

  // Signal to component that data is loading
  block.dataLoading = resolved.status === 'pending' && !entityData

  if (!Component) {
    return (
      <div className="block-error" style={{ padding: '1rem', background: '#fef2f2', color: '#dc2626' }}>
        Component not found: {block.type}
      </div>
    )
  }

  // Build content and params with runtime guarantees
  // Sources:
  // 1. parsedContent - semantic parser output (flat: title, paragraphs, links, etc.)
  // 2. block.properties - params from frontmatter (theme, alignment, etc.)
  // 3. meta - defaults from component meta.js
  const prepared = prepareProps(block, meta)
  let params = prepared.params

  let content = {
    ...prepared.content,
    ...block.properties,     // Frontmatter params overlay (legacy support)
  }

  // Merge entity data resolved by EntityStore
  // Only fill in keys that don't already exist — section-level fetch data
  // (already in content.data from parsedContent) takes priority over inherited data.
  if (entityData) {
    const merged = { ...content.data }
    for (const key of Object.keys(entityData)) {
      if (merged[key] === undefined) {
        merged[key] = entityData[key]
      }
    }
    content.data = merged
  }

  const componentProps = {
    content,
    params,
    block
  }

  // Bare mode — component only, no wrapper or section chrome.
  // Used by ChildBlocks for grid cells, tab panels, inline children, insets.
  if (!as) {
    return <Component {...componentProps} />
  }

  // Section mode — full treatment with wrapper, context classes, background.
  const { background, ...wrapperProps } = getWrapperProps(block)

  // Merge Component.className (static classes declared on the component function)
  // Order: context-{theme} + block.state.className + Component.className
  const componentClassName = Component.className
  if (componentClassName) {
    wrapperProps.className = wrapperProps.className
      ? `${wrapperProps.className} ${componentClassName}`
      : componentClassName
  }

  // Check if component handles its own background (background: 'self' in meta.js)
  // Components that render their own background layer (solid colors, insets, effects)
  // opt out so the runtime doesn't render an occluded layer underneath.
  const hasBackground = background?.mode && meta?.background !== 'self'

  // Signal to the component that the engine is rendering a background.
  // Components check block.hasBackground to skip their own opaque bg
  // and let the engine background show through.
  block.hasBackground = hasBackground

  // Determine wrapper element:
  // - Explicit as prop (not 'section') → use as prop directly
  // - Component.as → use component's declared tag (e.g., Header.as = 'header')
  // - fallback → 'section'
  const Wrapper = as !== 'section' ? as : (Component.as || 'section')

  // Render with or without background
  if (hasBackground) {
    return (
      <Wrapper {...wrapperProps}>
        {/* Background layer (positioned absolutely) */}
        <Background
          mode={background.mode}
          color={background.color}
          gradient={background.gradient}
          image={background.image}
          video={background.video}
          overlay={background.overlay}
        />

        {/* Content layer (above background) */}
        <div style={{ position: 'relative', zIndex: 10 }}>
          <Component {...componentProps} />
        </div>
      </Wrapper>
    )
  }

  // No background - simpler render without extra wrapper
  return (
    <Wrapper {...wrapperProps}>
      <Component {...componentProps} />
    </Wrapper>
  )
}
