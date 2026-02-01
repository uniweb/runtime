/**
 * BlockRenderer
 *
 * Bridges Block data to foundation components.
 * Handles theming, wrapper props, and runtime guarantees.
 * Supports runtime data fetching for prerender: false configs.
 */

import React, { useState, useEffect } from 'react'
import { prepareProps, getComponentMeta } from '../prepare-props.js'
import { executeFetchClient, mergeIntoData } from '../data-fetcher-client.js'
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

  // If background has content, ensure relative positioning for z-index stacking
  if (background.mode) {
    style.position = 'relative'
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
 * @param {Object} props
 * @param {Block} props.block - Block instance to render
 * @param {boolean} props.pure - If true, render component without wrapper
 * @param {string|false} props.as - Element type to render as ('section', 'div', 'article', etc.) or false for Fragment
 * @param {Object} props.extra - Extra props to pass to the component
 */
export default function BlockRenderer({ block, pure = false, as = 'section', extra = {} }) {
  // State for runtime-fetched data (when prerender: false)
  const [runtimeData, setRuntimeData] = useState(null)
  const [fetchError, setFetchError] = useState(null)

  const Component = block.initComponent()

  // Runtime fetch for prerender: false configurations
  const fetchConfig = block.fetch
  const shouldFetchAtRuntime = fetchConfig && fetchConfig.prerender === false

  useEffect(() => {
    if (!shouldFetchAtRuntime) return

    let cancelled = false

    async function doFetch() {
      const result = await executeFetchClient(fetchConfig)
      if (cancelled) return

      if (result.error) {
        setFetchError(result.error)
      }
      if (result.data) {
        setRuntimeData({ [fetchConfig.schema]: result.data })
      }
    }

    doFetch()

    return () => {
      cancelled = true
    }
  }, [shouldFetchAtRuntime, fetchConfig])

  // Signal to component that a runtime fetch is in progress
  // Set synchronously so the first render sees dataLoading = true
  if (shouldFetchAtRuntime && !runtimeData && !fetchError) {
    block.dataLoading = true
  } else if (shouldFetchAtRuntime) {
    block.dataLoading = false
  }

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
  const meta = getComponentMeta(block.type)

  // Prepare props with runtime guarantees:
  // - Apply param defaults from meta.js
  // - Guarantee content structure exists
  // - Apply cascaded data based on inheritData
  const prepared = prepareProps(block, meta)
  let params = prepared.params

  let content = {
    ...prepared.content,
    ...block.properties,     // Frontmatter params overlay (legacy support)
  }

  // Merge runtime-fetched data if available
  if (runtimeData && shouldFetchAtRuntime) {
    content.data = mergeIntoData(content.data, runtimeData[fetchConfig.schema], fetchConfig.schema, fetchConfig.merge)
  }

  const { background, ...wrapperProps } = getWrapperProps(block)

  // Check if component handles its own background (background: 'self' in meta.js)
  // Components that render their own background layer (solid colors, insets, effects)
  // opt out so the runtime doesn't render an occluded layer underneath.
  const hasBackground = background?.mode && meta?.background !== 'self'

  // Signal to the component that the engine is rendering a background.
  // Components check block.hasBackground to skip their own opaque bg
  // and let the engine background show through.
  block.hasBackground = hasBackground

  const componentProps = {
    content,
    params,
    block
  }

  if (pure) {
    return <Component {...componentProps} extra={extra} />
  }

  // Determine wrapper element: string tag name, or Fragment if false
  const Wrapper = as === false ? React.Fragment : as
  // Fragment doesn't accept props, so only pass them for real elements
  const wrapperElementProps = as === false ? {} : wrapperProps

  // Render with or without background
  if (hasBackground) {
    return (
      <Wrapper {...wrapperElementProps}>
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
        <div className="relative z-10">
          <Component {...componentProps} />
        </div>
      </Wrapper>
    )
  }

  // No background - simpler render without extra wrapper
  return (
    <Wrapper {...wrapperElementProps}>
      <Component {...componentProps} />
    </Wrapper>
  )
}
