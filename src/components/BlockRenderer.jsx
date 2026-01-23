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

/**
 * Convert hex color to rgba
 */
const hexToRgba = (hex, opacity) => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${opacity})`
}

/**
 * Build wrapper props from block configuration
 */
const getWrapperProps = (block) => {
  const theme = block.themeName
  const blockClassName = block.state?.className || ''

  let className = theme || ''
  if (blockClassName) {
    className = className ? `${className} ${blockClassName}` : blockClassName
  }

  const { background = {}, colors = {} } = block.standardOptions
  const style = {}

  // Handle background modes
  if (background.mode === 'gradient') {
    const {
      enabled = false,
      start = 'transparent',
      end = 'transparent',
      angle = 0,
      startPosition = 0,
      endPosition = 100,
      startOpacity = 0.7,
      endOpacity = 0.3
    } = background.gradient || {}

    if (enabled) {
      style['--bg-color'] = `linear-gradient(${angle}deg,
        ${hexToRgba(start, startOpacity)} ${startPosition}%,
        ${hexToRgba(end, endOpacity)} ${endPosition}%)`
    }
  } else if (background.mode === 'image' || background.mode === 'video') {
    const settings = background[background.mode] || {}
    const { url = '', file = '' } = settings

    if (url || file) {
      style['--bg-color'] = 'transparent'
      style.position = 'relative'
      style.maxWidth = '100%'
    }
  }

  return {
    id: `Section${block.id}`,
    style,
    className
  }
}

/**
 * BlockRenderer component
 */
export default function BlockRenderer({ block, pure = false, extra = {} }) {
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

  if (!Component) {
    return (
      <div className="block-error" style={{ padding: '1rem', background: '#fef2f2', color: '#dc2626' }}>
        Component not found: {block.type}
      </div>
    )
  }

  // Build content and params with runtime guarantees
  // Sources:
  // 1. parsedContent._isPoc - simple PoC format (hardcoded content)
  // 2. parsedContent - semantic parser output (flat: title, paragraphs, links, etc.)
  // 3. block.properties - params from frontmatter (theme, alignment, etc.)
  // 4. meta - defaults from component meta.js
  let content, params

  if (block.parsedContent?._isPoc) {
    // Simple PoC format - content was passed directly
    content = block.parsedContent._pocContent
    params = block.properties
  } else {
    // Get runtime metadata for this component (has defaults, data binding, etc.)
    const meta = getComponentMeta(block.type)

    // Prepare props with runtime guarantees:
    // - Apply param defaults from meta.js
    // - Guarantee content structure exists
    // - Apply cascaded data based on inheritData
    const prepared = prepareProps(block, meta)
    params = prepared.params

    // Merge prepared content with raw access for components that need it
    content = {
      ...prepared.content,
      ...block.properties,     // Frontmatter params overlay (legacy support)
      _prosemirror: block.parsedContent  // Keep original for components that need raw access
    }

    // Merge runtime-fetched data if available
    if (runtimeData && shouldFetchAtRuntime) {
      content.data = mergeIntoData(content.data, runtimeData[fetchConfig.schema], fetchConfig.schema, fetchConfig.merge)
    }
  }

  const componentProps = {
    content,
    params,
    block,
    input: block.input
  }

  if (pure) {
    return <Component {...componentProps} extra={extra} />
  }

  const wrapperProps = getWrapperProps(block)

  return (
    <div {...wrapperProps}>
      <Component {...componentProps} />
    </div>
  )
}
