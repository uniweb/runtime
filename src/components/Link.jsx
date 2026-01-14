/**
 * Link
 *
 * A wrapper around React Router's Link that integrates with the runtime.
 */

import React from 'react'
import { Link as RouterLink } from 'react-router-dom'

export default function Link({ to, href, children, className, ...props }) {
  const target = to || href

  // External links
  if (target?.startsWith('http') || target?.startsWith('mailto:') || target?.startsWith('tel:')) {
    return (
      <a href={target} className={className} {...props}>
        {children}
      </a>
    )
  }

  // Internal links via React Router
  return (
    <RouterLink to={target || '/'} className={className} {...props}>
      {children}
    </RouterLink>
  )
}
