/**
 * Load the third-party scripts a site declares under `tracking.tags`.
 *
 * ## What this is for
 *
 * A site's own tracking goes to an endpoint (see `wireTracker`). Some operators
 * additionally want a vendor's own tag — an analytics product or a tag manager
 * — which brings its own script, its own storage and its own reporting. That is
 * a second, independent path: nothing is translated between them and the
 * framework never learns which vendor it is loading. A URL arrives in config
 * and is loaded.
 *
 * ## ⛔ This file is DOM-only and must stay out of the SSR bundle
 *
 * `wire-foundation.js` is imported by `ssr-renderer.js` and therefore ends up
 * inside the Worker bundle, so it cannot import this module. Instead the
 * browser entry (`index.jsx`) passes `loadTagScripts` *in* to `wireTracker`,
 * and the SSR path passes nothing — so there is no branch to remember and no
 * DOM code in a bundle that has no DOM.
 *
 * ## ⛔ A tag that fails to load produces nothing
 *
 * No retry, no thrown error, no state a component could read. That is not a
 * style choice about error handling — it follows from who could act on it. On a
 * site whose code is a foundation, the foundation is written once for many
 * sites by an author who never heard of this operator's vendor, has no channel
 * to whoever chose it, and has nothing to render differently about. The visitor
 * has no stake. The only party who can act is the operator, and `debug` is
 * already their switch.
 *
 * ## ⭐ This module is loaded on demand, and that is the point
 *
 * `index.jsx` reaches it through `import('./tag-loader.js')` inside the
 * "there are tags" branch, so it becomes its own chunk. **A site that declares
 * no tags — the large majority — never downloads a byte of it**, which matters
 * because `@uniweb/runtime` and `@uniweb/core` are not tree-shaken and reach
 * every site whether they use a feature or not.
 *
 * ⚖️ The extra request lands only on sites that *do* declare a tag, and those
 * are about to fetch a vendor's script from another origin anyway — a
 * same-origin fetch of a few hundred bytes, after hydration and off the
 * critical path, against a cross-origin script an order of magnitude larger.
 *
 * Design: `kb/framework/plans/tracking-vendor-tags.md`.
 */

import { resolveServiceUrl } from '@uniweb/core/services'

/**
 * Only a fetched script is a tag. `data:` executes inline code and would turn a
 * URL field into a code field — which is the thing this capability exists to
 * avoid being. `javascript:` does not execute in `src` at all. Relative stays
 * allowed on purpose: a host may serve a vendor's script from the site's own
 * origin, and that is its business.
 */
const LOADABLE_SCHEME = /^https?:$/

/** Loaded once per document, across every call. */
const loaded = new Set()

/**
 * @param {string} url - already resolved against the site's base
 * @returns {boolean}
 */
function isLoadable(url) {
  if (!url) return false
  if (url.startsWith('/')) return true // site-relative — same origin by construction
  try {
    return LOADABLE_SCHEME.test(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * Normalize `tracking.tags` into resolved script URLs.
 *
 * Accepts a bare string or `{ src }` **from the start**, and deliberately: the
 * open question of whether some vendor needs more than a URL is unresolved
 * (`tracking-vendor-tags.md` §14.2), and tolerating both now means a later
 * per-tag field costs nobody a migration. Same tolerance `readEndpoint` already
 * shows for `submit:` and `tracking:` themselves.
 *
 * ⛔ **There is no field for inline code, and that is the whole shape.** A tag
 * is a URL we fetch. Anything else and this becomes `head.html` with extra
 * steps, which is what it exists to replace.
 *
 * Each entry goes through `resolveServiceUrl`, so an absolute URL passes
 * through untouched and a site-relative one is joined to the deployment base —
 * the same rule the endpoint follows, from the same function.
 *
 * ⚖️ **This lives here rather than in `wireTracker` so it rides the dynamic
 * boundary too.** A site that declares no tags never downloads it.
 *
 * @param {*} declared - the raw `tags` value from either tier
 * @param {string} [basePath]
 * @returns {string[]}
 */
export function resolveTagUrls(declared, basePath = '') {
  if (!declared) return []
  const list = Array.isArray(declared) ? declared : [declared]

  return list
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim()
      if (typeof entry?.src === 'string') return entry.src.trim()
      return ''
    })
    .filter(Boolean)
    .map((src) => resolveServiceUrl(src, basePath))
    .filter(Boolean)
}

/**
 * Resolve the declared tags and append each as an async script, once per
 * document.
 *
 * @param {*} declared - the raw `tags` value from either tier
 * @param {object} [options]
 * @param {string} [options.basePath] - the deployment base
 * @param {boolean} [options.debug=false] - the operator's switch; the only
 *        place a failure is ever reported
 */
export function loadTagScripts(declared, { basePath = '', debug = false } = {}) {
  if (typeof document === 'undefined') return

  for (const url of resolveTagUrls(declared, basePath)) {
    if (!isLoadable(url)) {
      if (debug) console.warn('[uniweb] tracking tag skipped, not a fetchable script URL:', url)
      continue
    }
    if (loaded.has(url)) continue
    loaded.add(url)

    const script = document.createElement('script')
    script.async = true
    script.src = url
    if (debug) {
      script.addEventListener('error', () =>
        console.warn('[uniweb] tracking tag failed to load:', url)
      )
    }
    // `<head>`, matching where a vendor's own snippet is normally installed.
    // Position affects how early the vendor's tags fire, not whether they do.
    document.head.appendChild(script)
  }
}

export default loadTagScripts
