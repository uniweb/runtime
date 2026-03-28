/**
 * WebsiteRenderer
 *
 * Top-level renderer that sets up theme styles and renders pages.
 * Manages scroll memory for navigation and optional analytics.
 */

import React, { useEffect } from 'react'
import PageRenderer from './PageRenderer.jsx'
import ThemeProvider from './ThemeProvider.jsx'
import { useRememberScroll } from '../hooks/useRememberScroll.js'
import { useLinkInterceptor } from '../hooks/useLinkInterceptor.js'

/**
 * WebsiteRenderer component
 */
export default function WebsiteRenderer() {
  const website = globalThis.uniweb.activeWebsite

  // Apply default appearance scheme (light/dark/system) on mount
  useEffect(() => {
    const appearance = website?.themeData?.appearance
    if (!appearance) return

    const defaultScheme = appearance.default || 'light'
    const root = document.documentElement
    if (defaultScheme === 'dark') {
      root.classList.add('scheme-dark')
      root.classList.remove('scheme-light')
    } else if (defaultScheme === 'system') {
      // No explicit class — CSS media query decides based on OS preference
      root.classList.remove('scheme-dark')
      root.classList.remove('scheme-light')
    } else {
      root.classList.remove('scheme-dark')
    }
  }, [website?.themeData?.appearance?.default])

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
