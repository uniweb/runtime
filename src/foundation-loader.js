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

  // Skip if already present (e.g., injected by SSR into the static HTML)
  if (document.querySelector(`link[rel="stylesheet"][href="${url}"]`)) return

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
  // Auto-derive CSS URL from JS URL by convention: entry.js → assets/style.css.
  // Pre-Phase-5 foundations were named foundation.js + assets/foundation.css;
  // those keep working when an explicit `cssUrl` is passed in `source`.
  const cssUrl = typeof source === 'object' ? source.cssUrl
    : url.replace(/[^/]+\.js$/, 'assets/style.css')

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
 * Load extensions (secondary foundations) in parallel. Returns the loaded
 * modules so the caller can pass them into `new Uniweb(...)` / `initUniweb(...)`.
 * Extensions that fail to load are logged and omitted from the result.
 *
 * @param {Array<string|Object>} urls - Extension URLs or {url, cssUrl} objects
 * @returns {Promise<Array<Object>>} Loaded extension modules, in source order.
 */
export async function loadExtensions(urls) {
  if (!urls?.length) return []

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
    urls.map((url) => loadFoundation(resolveUrl(url))),
  )

  const loaded = []
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      loaded.push(results[i].value)
      console.log(`[Runtime] Extension loaded: ${urls[i]}`)
    } else {
      console.warn(`[Runtime] Extension failed to load: ${urls[i]}`, results[i].reason)
    }
  }
  return loaded
}
