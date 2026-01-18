/**
 * Blocks
 *
 * Renders an array of blocks for a layout area (header, body, footer, panels).
 * Used by the Layout component to pre-render each area.
 */

import React from 'react'
import BlockRenderer from './BlockRenderer.jsx'

/**
 * Render a list of blocks
 *
 * @param {Object} props
 * @param {Block[]} props.blocks - Array of Block instances to render
 * @param {Object} [props.extra] - Extra props to pass to each block
 */
export default function Blocks({ blocks, extra = {} }) {
  if (!blocks || blocks.length === 0) return null

  return blocks.map((block, index) => (
    <React.Fragment key={block.id || index}>
      <BlockRenderer block={block} extra={extra} />
    </React.Fragment>
  ))
}
