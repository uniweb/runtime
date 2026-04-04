/**
 * PageRenderer
 *
 * Renders a page using the Layout component for proper orchestration
 * of header, body, footer, and panel areas.
 * Manages head meta tags for SEO and social sharing.
 */

import React, { useMemo, useEffect, useReducer, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import BlockRenderer from './BlockRenderer.jsx'
import Layout from './Layout.jsx'
import { useHeadMeta } from '../hooks/useHeadMeta.js'
import { buildSectionOverrides } from '@uniweb/theming'
import { Default404 } from '../default-404.js'

/**
 * ChildBlocks - renders child blocks of a block
 * Exposed for use by foundation components
 *
 * @param {Object} props
 * @param {Block[]} props.blocks - Explicit array of blocks to render
 * @param {Block} props.from - Parent block to extract childBlocks from (convenience shorthand)
 * @param {boolean} props.pure - If true, render components without wrapper
 * @param {string|false} props.as - Element type to render as (default: 'div' for nested blocks)
 * @param {Object} props.extra - Extra props to pass to each component
 *
 * @example
 * // Explicit blocks array
 * <ChildBlocks blocks={filteredBlocks} />
 *
 * @example
 * // Extract from parent block
 * <ChildBlocks from={block} />
 */
export function ChildBlocks({ blocks, from, pure = false, as = 'div', extra = {} }) {
  const blockList = blocks || from?.childBlocks || []

  return blockList.map((childBlock, index) => (
    <React.Fragment key={childBlock.id || index}>
      <BlockRenderer block={childBlock} pure={pure} as={as} extra={extra} />
    </React.Fragment>
  ))
}

/**
 * Section override styles — pre-built CSS for all section-level overrides on the active page.
 * Injects a <style> tag into <head> (after uniweb-theme) so overrides
 * cascade correctly and don't live inside the React root.
 */
function SectionOverrideStyles({ page, appearance }) {
  const styleRef = useRef(null)

  const css = useMemo(() => {
    if (!page) return ''
    const blocks = page.getPageBlocks()
    return buildSectionOverrides(blocks, appearance)
  }, [page, appearance])

  useEffect(() => {
    if (!css) {
      if (styleRef.current) {
        styleRef.current.remove()
        styleRef.current = null
      }
      return
    }

    if (!styleRef.current) {
      // Reuse the SSR-injected element if present to avoid duplicates
      styleRef.current = document.getElementById('uniweb-page-overrides') || document.createElement('style')
      styleRef.current.id = 'uniweb-page-overrides'
      if (!styleRef.current.parentNode) {
        // Not yet in the DOM — insert after uniweb-theme if it exists, otherwise append to head
        const themeStyle = document.getElementById('uniweb-theme')
        if (themeStyle && themeStyle.nextSibling) {
          themeStyle.parentNode.insertBefore(styleRef.current, themeStyle.nextSibling)
        } else if (themeStyle) {
          themeStyle.parentNode.appendChild(styleRef.current)
        } else {
          document.head.appendChild(styleRef.current)
        }
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
 * PageRenderer component
 *
 * Renders the current page using the Layout system which supports:
 * - Header, body, footer areas
 * - Left and right panels
 * - Foundation-provided custom layouts
 * - Per-page layout preferences
 */
export default function PageRenderer() {
  const location = useLocation()
  const uniweb = globalThis.uniweb
  const website = uniweb?.activeWebsite
  const siteName = website?.name || ''

  // Force re-render counter — incremented by DataStore listener below
  const [, forceUpdate] = useReducer((x) => x + 1, 0)

  // Resolve page from current URL and sync website.activePage immediately.
  // This must happen synchronously (not in an effect) so child components
  // like Header see the correct activePage during the same render cycle.
  const navigate = useNavigate()

  let page = website?.getPage(location.pathname)
  if (page && website) website.setActivePage(location.pathname)

  // ─── Compute navigation targets (before hooks, no early returns) ───

  // Explicit redirect: in page.yml
  const redirectTarget = page?.redirect || null

  // Auto-redirect for content-less pages (structural containers).
  // Folders with page.yml but no markdown keep their route in the hierarchy;
  // when visited directly, redirect to the first descendant with content.
  const autoRedirectRoute = page && !page.redirect && !page.hasContent()
    ? page.getNavigableRoute()
    : null
  const shouldAutoRedirect = !!(autoRedirectRoute && autoRedirectRoute !== page?.route)

  // If no page found, try the 404 page (do NOT fall back to activePage/homepage)
  const isNotFound = !page && !redirectTarget
  if (isNotFound) {
    page = website?.getNotFoundPage?.() || null
  }

  // Head metadata — compute for all cases (redirect pages get a fallback)
  const headMeta = page?.getHeadMeta?.() || {
    title: isNotFound ? 'Page Not Found' : (page?.title || 'Website'),
    description: page?.description || ''
  }

  // ─── All hooks called unconditionally (React rules of hooks) ───

  useEffect(() => {
    if (!redirectTarget) return
    if (redirectTarget.startsWith('http')) {
      window.location.replace(redirectTarget)
    } else {
      navigate(redirectTarget, { replace: true })
    }
  }, [redirectTarget, navigate])

  useEffect(() => {
    if (!shouldAutoRedirect) return
    navigate(autoRedirectRoute, { replace: true })
  }, [shouldAutoRedirect, autoRedirectRoute, navigate])

  useHeadMeta(headMeta, { siteName })

  // For dynamic pages created before collection data was available (hard reload),
  // the page title starts as the template name (e.g. '[id]'). Subscribe to
  // DataStore updates so we re-render once the collection loads — _createDynamicPage
  // then runs again with fresh data and sets the correct title/notFound state.
  const isDynamicPending = !!(page?.dynamicContext && !website?._dynamicPageCache?.has(location.pathname))
  useEffect(() => {
    if (!isDynamicPending || !website?.dataStore) return
    return website.dataStore.onUpdate(forceUpdate)
  }, [isDynamicPending, website])

  // ─── Early returns (after all hooks) ───

  if (redirectTarget) return null
  if (shouldAutoRedirect) return null

  // Rewrite pages are served by an external site — the host handles routing.
  // In SPA mode this shouldn't be reached (host proxies before JS loads),
  // but if it is (e.g., dev mode), do a full page reload to let the host handle it.
  if (page?.rewrite) {
    window.location.reload()
    return null
  }

  if (!page) {
    // No page and no 404 page defined - show shared fallback + dev debug info
    const requestedPath = location.pathname
    const isDev = import.meta.env?.DEV
    return (
      <>
        <Default404 />
        {isDev && (
          <div style={{ marginTop: '0', padding: '1rem', background: '#f1f5f9', borderRadius: '0.5rem', textAlign: 'left', maxWidth: '32rem', margin: '0 auto' }}>
            <p style={{ fontWeight: '600', color: '#475569', marginBottom: '0.5rem' }}>Debug info</p>
            <p style={{ fontSize: '0.875rem', color: '#64748b' }}>Path: {requestedPath}</p>
            <p style={{ fontSize: '0.875rem', color: '#64748b' }}>Locale: {website?.getActiveLocale?.() || 'unknown'}</p>
            <p style={{ fontSize: '0.875rem', color: '#64748b' }}>Known routes: {website?.pageRoutes?.join(', ') || 'none'}</p>
            <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.5rem' }}>Tip: Create a pages/404/ folder with a page.yml and content to customize this page.</p>
          </div>
        )}
      </>
    )
  }

  const appearance = website?.themeData?.appearance

  // Use Layout component for proper orchestration
  return (
    <>
      <SectionOverrideStyles page={page} appearance={appearance} />
      <Layout page={page} website={website} />
    </>
  )
}
