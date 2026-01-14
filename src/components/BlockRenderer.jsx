/**
 * BlockRenderer
 *
 * Bridges Block data to foundation components.
 * Handles theming and wrapper props.
 */

import React from 'react'

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
  const Component = block.initComponent()

  if (!Component) {
    return (
      <div className="block-error" style={{ padding: '1rem', background: '#fef2f2', color: '#dc2626' }}>
        Component not found: {block.component}
      </div>
    )
  }

  // Build content for component
  // Components expect content as a simple object with all data
  // Sources:
  // 1. parsedContent.raw - simple PoC format (hardcoded content)
  // 2. block.properties - params from frontmatter (title, subtitle, features, etc.)
  // 3. parsedContent - full ProseMirror structure (markdown body)
  let content

  if (block.parsedContent?.raw) {
    // Simple PoC format - content was passed directly
    content = block.parsedContent.raw
  } else {
    // Collected content - merge params (frontmatter) with parsed content
    content = {
      ...block.properties,  // Frontmatter data (title, subtitle, features, items, etc.)
      _prosemirror: block.parsedContent  // Keep ProseMirror for components that need it
    }
  }

  const componentProps = {
    content,
    params: block.properties,
    block,
    page: globalThis.uniweb?.activeWebsite?.activePage,
    website: globalThis.uniweb?.activeWebsite,
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
