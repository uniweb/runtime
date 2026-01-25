/**
 * ThemeProvider
 *
 * Injects theme CSS into the document head.
 * For SSG mode, CSS is pre-injected during build (checks for existing style tag).
 * For federated mode, injects CSS at runtime from theme data.
 */

import React, { useEffect, useRef } from 'react'

const THEME_STYLE_ID = 'uniweb-theme'

/**
 * Check if theme CSS is already injected (SSG mode)
 */
function isThemeCSSInjected() {
  if (typeof document === 'undefined') return false
  return document.getElementById(THEME_STYLE_ID) !== null
}

/**
 * ThemeProvider component
 *
 * @param {Object} props
 * @param {string} props.css - Theme CSS string
 * @param {React.ReactNode} props.children - Child components
 */
export default function ThemeProvider({ css, children }) {
  const styleRef = useRef(null)

  useEffect(() => {
    // Skip if CSS already exists (SSG mode) or no CSS provided
    if (!css || isThemeCSSInjected()) {
      return
    }

    // Create and inject style element
    const styleElement = document.createElement('style')
    styleElement.id = THEME_STYLE_ID
    styleElement.textContent = css
    document.head.appendChild(styleElement)
    styleRef.current = styleElement

    return () => {
      // Cleanup on unmount (for dynamic theme changes)
      if (styleRef.current && styleRef.current.parentNode) {
        styleRef.current.parentNode.removeChild(styleRef.current)
        styleRef.current = null
      }
    }
  }, [css])

  // Update CSS if it changes (for dynamic themes in federated mode)
  useEffect(() => {
    if (!css) return

    const existingStyle = document.getElementById(THEME_STYLE_ID)
    if (existingStyle && existingStyle.textContent !== css) {
      existingStyle.textContent = css
    }
  }, [css])

  return <>{children}</>
}

/**
 * Hook to access theme data
 * Returns the theme object from the active website
 */
export function useThemeData() {
  return globalThis.uniweb?.activeWebsite?.theme || null
}
