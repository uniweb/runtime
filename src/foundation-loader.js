/**
 * Foundation and extension loading
 *
 * Handles dynamic import of foundations (primary and extensions)
 * with CSS loading in parallel.
 */

/**
 * Resolve a foundation/extension URL so that absolute-path forms
 * (`/_module/...`) anchor to the document's origin, not to the importing
 * runtime's host. Pass-through for fully-absolute (https://...) and
 * already-protocol-relative inputs; pass-through if there's no document
 * (SSR contexts).
 */
function resolveAgainstDocument(url) {
  if (typeof url !== 'string' || !url) return url
  if (typeof window === 'undefined' || !window.location) return url
  // Already absolute (https://, http://, //)
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(url)) return url
  // Host-absolute path (/foo) — anchor to document origin so an
  // import from a CDN-loaded runtime doesn't pull from the CDN host.
  if (url.startsWith('/')) return window.location.origin + url
  // Relative paths (foo, ./foo, ../foo) keep their natural ES-module
  // resolution (against the importer). Foundations don't use this
  // form today; passing through preserves any future caller's intent.
  return url
}

/**
 * Load foundation CSS from URL.
 *
 * ⭐ **Exported for the test, and the test exists because a HOST builds on this.**
 * The skip below is what lets a shell put the stylesheet in the head itself —
 * so the sheet applies during HTML parse instead of waiting for the runtime to
 * boot, parse `__DATA__` and inject it. Hosting shipped that on the strength of
 * this guard (channel `framework-hosting-ea29`, 2026-08-19); until then nothing
 * asserted it, so a refactor would have produced two `<link>` tags and two
 * fetches on their lane with every test here still green.
 *
 * ⛔ **The guard is an ATTRIBUTE-VALUE match, so the href must be byte-identical
 * to what the caller passes** — and the caller passes the URL *after*
 * `resolveAgainstDocument`. An absolute `https://…` is a pass-through and
 * matches; a root-relative `/foo.css` is rewritten to `origin + /foo.css` and
 * would NOT match a literal `href="/foo.css"` in the head. If a host ever emits
 * a root-relative one, this comparison has to become resolved-to-resolved.
 *
 * @param {string} url - URL to foundation's CSS file
 */
export async function loadFoundationCSS(url) {
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
  const rawUrl = typeof source === 'string' ? source : source.url
  // Auto-derive CSS URL from JS URL by convention: entry.js → assets/style.css.
  // Pre-Phase-5 foundations were named foundation.js + assets/foundation.css;
  // those keep working when an explicit `cssUrl` is passed in `source`.
  const rawCssUrl = typeof source === 'object' ? source.cssUrl
    : rawUrl.replace(/[^/]+\.js$/, 'assets/style.css')

  // Phase 5: when the runtime is loaded from a different host than the
  // document (e.g. runtime served from cdn.uniweb.app, page on
  // www.uniweb.io), ES-module dynamic imports resolve relative paths
  // against the IMPORTING script's URL — not the document's. Site-bound
  // foundation URLs like `/_module/io/0.1.2/entry.js` would resolve to
  // cdn.uniweb.app/_module/... and 404. Force resolution against the
  // document origin so site-bound paths land on the site host.
  const url = resolveAgainstDocument(rawUrl)
  const cssUrl = rawCssUrl ? resolveAgainstDocument(rawCssUrl) : rawCssUrl

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

  // No base resolution here, deliberately: a module URL that reaches the
  // runtime is FINAL. `loadFoundation()` anchors a root-relative URL to the
  // document origin (which HOST serves it) and nothing else, so an extension
  // and the primary foundation resolve by exactly one rule.
  //
  // This used to prefix root-relative URLs with `import.meta.env.BASE_URL`
  // while the primary — which reaches `loadFoundation()` straight from
  // `initRuntime()` — did not, so one string resolved to two places depending
  // on which slot it sat in. Two reasons that was wrong: a module URL is a
  // SERVE LOCATION, not a path under the site's mount point (a host may serve
  // a site under one subpath and serve its foundation from an entirely
  // different root, so prefixing would corrupt it); and
  // BASE_URL is a build-time constant of whichever bundle the runtime shipped
  // in, which `setup.js buildDefaultFetcher()` had already ruled the wrong
  // authority for the sibling problem.
  //
  // The deployment base is now applied by the producer, which knows it:
  // `@uniweb/build` → `src/site/extension-urls.js`.
  const results = await Promise.allSettled(
    urls.map((url) => loadFoundation(url)),
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
