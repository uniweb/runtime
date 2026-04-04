/**
 * Blocks
 *
 * Renders an array of blocks for a layout area (header, body, footer, panels).
 * Used by the Layout component to pre-render each area.
 */

import React from 'react'
import BlockRenderer from './BlockRenderer.jsx'

/**
 * Render a list of blocks as top-level sections.
 * Used by Layout to pre-render each area (header, body, footer, panels).
 * Each block gets full section treatment (wrapper, context classes, background).
 *
 * @param {Object} props
 * @param {Block[]} props.blocks - Array of Block instances to render
 */
export default function Blocks({ blocks }) {
  if (!blocks || blocks.length === 0) return null

  return blocks.map((block, index) => (
    <React.Fragment key={block.id || index}>
      <BlockRenderer block={block} />
    </React.Fragment>
  ))
}
