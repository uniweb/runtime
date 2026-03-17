/**
 * Default 404 Page Content
 *
 * Single source of truth for the fallback 404 page shown when a site
 * has no custom 404 page defined. Used by:
 *   - PageRenderer.jsx (client-side, as React elements)
 *   - ssr-renderer.js generate404Html (build-time, as HTML string)
 *
 * The wrapper uses min-height + flex centering so the 404 content
 * renders at the same position regardless of parent layout context.
 * This prevents a visible flash when React hydrates over the SSR content.
 */

import React from 'react'

const styles = {
  wrapper: {
    minHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
    textAlign: 'center',
  },
  heading: { fontSize: '3rem', fontWeight: 'bold', color: '#1f2937', marginBottom: '1rem' },
  message: { color: '#64748b', marginBottom: '2rem' },
  link: { color: '#3b82f6', textDecoration: 'underline' },
}

/**
 * React element for client-side rendering (PageRenderer).
 * Reads basePath from the runtime so the homepage link works
 * in subdirectory deployments (e.g., /sites/testproject).
 */
export function Default404() {
  const basePath = globalThis.uniweb?.activeWebsite?.basePath || ''
  const homeHref = basePath ? `${basePath}/` : '/'
  return React.createElement('div', { className: 'page-not-found', style: styles.wrapper },
    React.createElement('h1', { style: styles.heading }, '404'),
    React.createElement('p', { style: styles.message }, 'Page not found'),
    React.createElement('a', { href: homeHref, style: styles.link }, 'Go to homepage')
  )
}

/**
 * Static HTML string for SSR injection (generate404Html).
 *
 * @param {string} [basePath] - Base path prefix for the homepage link (e.g., '/sites/testproject')
 */
export function default404Html(basePath = '') {
  const homeHref = basePath ? `${basePath}/` : '/'
  return (
    `<div class="page-not-found" style="min-height:80vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center">` +
    `<h1 style="font-size:3rem;font-weight:bold;color:#1f2937;margin-bottom:1rem">404</h1>` +
    `<p style="color:#64748b;margin-bottom:2rem">Page not found</p>` +
    `<a href="${homeHref}" style="color:#3b82f6;text-decoration:underline">Go to homepage</a>` +
    `</div>`
  )
}
