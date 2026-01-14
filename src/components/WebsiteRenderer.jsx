/**
 * WebsiteRenderer
 *
 * Top-level renderer that sets up theme styles and renders pages.
 */

import React from 'react'
import PageRenderer from './PageRenderer.jsx'

/**
 * Build CSS custom properties from theme data
 */
function buildThemeStyles(themeData) {
  if (!themeData) return ''

  const { contexts = {} } = themeData
  const styles = []

  // Generate CSS for each context (light, medium, dark)
  for (const [contextName, contextData] of Object.entries(contexts)) {
    const selector = `.context__${contextName}`
    const vars = []

    if (contextData.colors) {
      for (const [key, value] of Object.entries(contextData.colors)) {
        vars.push(`  --${key}: ${value};`)
      }
    }

    if (vars.length > 0) {
      styles.push(`${selector} {\n${vars.join('\n')}\n}`)
    }
  }

  return styles.join('\n\n')
}

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

  if (!website) {
    return (
      <div className="website-loading" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
        Loading website...
      </div>
    )
  }

  const themeStyles = buildThemeStyles(website.themeData)

  return (
    <>
      {/* Load custom fonts */}
      <Fonts fontsData={website.themeData?.importedFonts} />

      {/* Inject theme CSS variables */}
      {themeStyles && (
        <style dangerouslySetInnerHTML={{ __html: themeStyles }} />
      )}

      {/* Render the page */}
      <PageRenderer />
    </>
  )
}
