/**
 * WebsiteRenderer
 *
 * Top-level renderer that sets up theme styles and renders pages.
 * Manages scroll memory for navigation and optional analytics.
 */

import React from 'react'
import PageRenderer from './PageRenderer.jsx'
import ThemeProvider from './ThemeProvider.jsx'
import { useRememberScroll } from '../hooks/useRememberScroll.js'
import { useLinkInterceptor } from '../hooks/useLinkInterceptor.js'

/**
 * WebsiteRenderer component
 */
export default function WebsiteRenderer() {
  const website = globalThis.uniweb.activeWebsite

  // The appearance scheme is applied in initRuntime, before React renders — not
  // here. This component used to re-apply `appearance.default` from an effect,
  // which ran after kit's useAppearance() effect (React runs child effects
  // first) and silently discarded the visitor's stored preference on every page
  // load. See appearance.js.

  // Enable SPA navigation for links rendered as plain HTML
  useLinkInterceptor({ enabled: true })

  // Enable scroll memory for navigation
  useRememberScroll({ enabled: true })

  if (!website) {
    return (
      <div className="website-loading" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
        Loading website...
      </div>
    )
  }

  // Theme CSS (pre-generated during build).
  // Font <link> tags are injected into <head> by the build pipeline (assembler)
  // or by DynamicApp.jsx (editor preview) — not handled by React.
  const themeCSS = website.themeData?.css

  return (
    <ThemeProvider css={themeCSS}>
      <PageRenderer />
    </ThemeProvider>
  )
}
