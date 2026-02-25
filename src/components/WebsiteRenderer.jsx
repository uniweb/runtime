/**
 * WebsiteRenderer
 *
 * Top-level renderer that sets up theme styles and renders pages.
 * Manages scroll memory for navigation and optional analytics.
 */

import React, { useMemo, useEffect, useRef } from 'react'
import PageRenderer from './PageRenderer.jsx'
import ThemeProvider from './ThemeProvider.jsx'
import { useRememberScroll } from '../hooks/useRememberScroll.js'
import { useLinkInterceptor } from '../hooks/useLinkInterceptor.js'
import { buildSectionOverrides } from '@uniweb/theming'

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
 * Section override styles — pre-built CSS for all section-level overrides on the active page.
 * Injects a <style> tag into <head> (after uniweb-theme) so overrides
 * cascade correctly and don't live inside the React root.
 */
function SectionOverrideStyles({ website }) {
  const page = website.activePage
  const appearance = website.themeData?.config?.appearance
  const styleRef = useRef(null)

  const css = useMemo(() => {
    if (!page) return ''
    const blocks = page.getPageBlocks()
    return buildSectionOverrides(blocks, appearance)
  }, [page, appearance])

  useEffect(() => {
    if (!css) {
      // Remove existing tag if CSS is empty
      if (styleRef.current) {
        styleRef.current.remove()
        styleRef.current = null
      }
      return
    }

    if (!styleRef.current) {
      styleRef.current = document.createElement('style')
      styleRef.current.id = 'uniweb-page-overrides'
      // Insert after uniweb-theme if it exists, otherwise append to head
      const themeStyle = document.getElementById('uniweb-theme')
      if (themeStyle && themeStyle.nextSibling) {
        themeStyle.parentNode.insertBefore(styleRef.current, themeStyle.nextSibling)
      } else if (themeStyle) {
        themeStyle.parentNode.appendChild(styleRef.current)
      } else {
        document.head.appendChild(styleRef.current)
      }
    }

    styleRef.current.textContent = css

    return () => {
      if (styleRef.current) {
        styleRef.current.remove()
        styleRef.current = null
      }
    }
  }, [css])

  return null
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

      {/* Section override CSS (per-page, pre-built) */}
      <SectionOverrideStyles website={website} />

      {/* Render the page */}
      <PageRenderer />
    </ThemeProvider>
  )
}
