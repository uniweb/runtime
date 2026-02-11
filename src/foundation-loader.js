/**
 * Foundation and extension loading
 *
 * Handles dynamic import of foundations (primary and extensions)
 * with CSS loading in parallel.
 */

/**
 * Load foundation CSS from URL
 * @param {string} url - URL to foundation's CSS file
 */
async function loadFoundationCSS(url) {
  if (!url) return

  return new Promise((resolve) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = url
    link.onload = () => {
      console.log('[Runtime] Foundation CSS loaded')
      resolve()
    }
    link.onerror = () => {
      console.warn('[Runtime] Could not load foundation CSS from:', url)
      resolve() // Don't fail for CSS
    }
    document.head.appendChild(link)
  })
}

/**
 * Load a foundation module via dynamic import
 * @param {string|Object} source - URL string or {url, cssUrl} object
 * @returns {Promise<Object>} The loaded foundation module
 */
export async function loadFoundation(source) {
  const url = typeof source === 'string' ? source : source.url
  // Auto-derive CSS URL from JS URL by convention: foundation.js → assets/foundation.css
  const cssUrl = typeof source === 'object' ? source.cssUrl
    : url.replace(/[^/]+\.js$/, 'assets/foundation.css')

  console.log(`[Runtime] Loading foundation from: ${url}`)

  try {
    // Load CSS and JS in parallel
    const [, foundation] = await Promise.all([
      cssUrl ? loadFoundationCSS(cssUrl) : Promise.resolve(),
      import(/* @vite-ignore */ url)
    ])

    const componentNames = Object.keys(foundation).filter(k => k !== 'default')
    console.log('[Runtime] Foundation loaded. Available components:', componentNames)

    return foundation
  } catch (error) {
    console.error('[Runtime] Failed to load foundation:', error)
    throw error
  }
}

/**
 * Load extensions (secondary foundations) in parallel
 * @param {Array<string|Object>} urls - Extension URLs or {url, cssUrl} objects
 * @param {Object} uniwebInstance - The Uniweb instance to register extensions on
 */
export async function loadExtensions(urls, uniwebInstance) {
  if (!urls?.length) return

  // Resolve extension URLs against base path for subdirectory deployments
  // e.g., /effects/foundation.js → /templates/extensions/effects/foundation.js
  const basePath = import.meta.env?.BASE_URL || '/'
  function resolveUrl(source) {
    if (basePath === '/') return source
    if (typeof source === 'string' && source.startsWith('/')) {
      return basePath + source.slice(1)
    }
    if (typeof source === 'object' && source.url?.startsWith('/')) {
      return { ...source, url: basePath + source.url.slice(1) }
    }
    return source
  }

  const results = await Promise.allSettled(
    urls.map(url => loadFoundation(resolveUrl(url)))
  )

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      uniwebInstance.registerExtension(results[i].value)
      console.log(`[Runtime] Extension loaded: ${urls[i]}`)
    } else {
      console.warn(`[Runtime] Extension failed to load: ${urls[i]}`, results[i].reason)
    }
  }
}
