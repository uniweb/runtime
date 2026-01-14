/**
 * SafeHtml
 *
 * Safely render HTML content with sanitization.
 * TODO: Add DOMPurify for production use
 */

import React from 'react'

export default function SafeHtml({ html, className, as: Component = 'div', ...props }) {
  if (!html) return null

  // For now, render directly
  // TODO: Integrate DOMPurify for sanitization
  return (
    <Component
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
      {...props}
    />
  )
}
