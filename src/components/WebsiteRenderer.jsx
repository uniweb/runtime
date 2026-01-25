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
 * Fonts component - loads custom fonts
 */
function Fonts({ fontsData }) {
  if (!fontsData || !fontsData.length) return null

  const fontLinks = fontsData.map((font, index) => {
    if (font.url) {
      return <link key={index} rel="stylesheet" href={font.url} />
    }
    return null
  })

  return <>{fontLinks.filter(Boolean)}</>
}

/**
 * WebsiteRenderer component
 */
export default function WebsiteRenderer() {
  const website = globalThis.uniweb?.activeWebsite

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

  // Get theme CSS from theme data (pre-generated during build)
  // For SSG mode, CSS is already injected into HTML
  // For federated mode, ThemeProvider injects it at runtime
  const themeCSS = website.themeData?.css

  // Get font imports from theme data
  const fontImports = website.themeData?.fonts?.import

  return (
    <ThemeProvider css={themeCSS}>
      {/* Load custom fonts */}
      <Fonts fontsData={fontImports} />

      {/* Render the page */}
      <PageRenderer />
    </ThemeProvider>
  )
}
