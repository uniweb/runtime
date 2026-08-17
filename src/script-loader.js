/**
 * Load the third-party scripts a site declares under `tracking.scripts`.
 *
 * ## What this is, exactly
 *
 * **A list of URLs.** Each one becomes `<script async src="…">` in `<head>`.
 * That is the whole capability — no inline code, no configuration object, no
 * vendor knowledge. The framework does not construct a URL, does not hold a URL
 * template, and never sees an account or measurement id: whatever the operator
 * (or their host) declared is what gets fetched.
 *
 * A site's own tracking goes to an endpoint (see `wireTracker`). A vendor's
 * script is a **second, independent path** — it measures its own way, stores its
 * own state and reports to its own service. Nothing is translated between them.
 *
 * ⚖️ **The name is `scripts`, not `tags`, deliberately.** "Tag" is the analytics
 * industry's word, and in a tag manager it means the individual trackers
 * configured in *that vendor's* web UI — which is a different thing from what
 * this holds. One entry here is a *loader*: for a tag manager it is the whole
 * container, and its actual tags live somewhere we never see. The key is only
 * ever read by someone editing `site.yml` by hand, so accuracy serves them
 * better than a friendlier borrowed word — and `scripts` says plainly that
 * third-party code is being put on a visitor's page.
 *
 * ## ⛔ This file is DOM-only and must stay out of the SSR bundle
 *
 * `wire-foundation.js` is imported by `ssr-renderer.js` and therefore ends up
 * inside the Worker bundle, so it cannot import this module. Instead the
 * browser entry (`index.jsx`) passes `loadScripts` *in* to `wireTracker`, and
 * the SSR path passes nothing — so there is no branch to remember and no DOM
 * code in a bundle that has no DOM.
 *
 * ## ⛔ A script that fails to load produces nothing
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
 * `index.jsx` reaches it through `import('./script-loader.js')` inside the
 * "there are scripts" branch, so it becomes its own chunk. **A site that
 * declares none — the large majority — never downloads a byte of it**, which
 * matters because `@uniweb/runtime` and `@uniweb/core` are not tree-shaken and
 * reach every site whether they use a feature or not.
 *
 * ⚖️ The extra request lands only on sites that *do* declare one, and those are
 * about to fetch a vendor's script from another origin anyway — a same-origin
 * fetch of a few hundred bytes, after hydration and off the critical path,
 * against a cross-origin script an order of magnitude larger.
 *
 * Part of the vendor-tag design.
 */

import { resolveServiceUrl } from '@uniweb/core/services'

/**
 * Only a **fetched** script qualifies. `data:` executes inline code and would
 * turn a URL field into a code field — the thing this capability exists to avoid
 * being. `javascript:` does not execute in `src` at all. Relative stays allowed
 * on purpose: a host may serve a vendor's script from the site's own origin, and
 * that is its business.
 */
const LOADABLE_SCHEME = /^https?:$/

/** Loaded once per document, across every call. */
const loaded = new Set()

/**
 * ⛔ **Resolve against the document before testing the scheme — do not
 * special-case a leading slash.** An earlier version short-circuited
 * `url.startsWith('/')` as *"site-relative, same origin by construction"*, which
 * is **false for a protocol-relative URL**: `//other.example.com/x.js` starts
 * with a slash, is cross-origin, and skipped the scheme test entirely on the
 * strength of a comment that was not true of it.
 *
 * The security property survived by luck — a protocol-relative URL inherits the
 * page's scheme, so it can still never be `data:` — but the check was not doing
 * what it claimed, which is worse than a check that visibly does less.
 *
 * Resolving first makes the test mean what it says and removes the special case:
 * `//host` inherits the page scheme and passes, `/js/x.js` and a bare relative
 * path resolve to this origin and pass, `data:` and `javascript:` keep their own
 * protocol and are refused.
 *
 * @param {string} url - already joined to the site's base by `resolveScriptUrls`
 * @returns {boolean}
 */
function isLoadable(url) {
  if (!url) return false
  try {
    const base = typeof location !== 'undefined' ? location.href : undefined
    return LOADABLE_SCHEME.test(new URL(url, base).protocol)
  } catch {
    return false
  }
}

/**
 * Normalize `tracking.scripts` into resolved URLs.
 *
 * Accepts a bare string or `{ src }` **from the start**, and deliberately: the
 * open question of whether some vendor needs more than a URL is unresolved
 * (`tracking-vendor-tags.md` §14.2), and tolerating both now means a later
 * per-entry field costs nobody a migration. Same tolerance `readEndpoint`
 * already shows for `submit:` and `tracking:` themselves.
 *
 * ⛔ **There is no field for inline code, and that is the whole shape.** An
 * entry is a URL we fetch. Anything else and this becomes `head.html` with extra
 * steps, which is what it exists to replace.
 *
 * Each entry goes through `resolveServiceUrl`, so an absolute URL passes
 * through untouched and a site-relative one is joined to the deployment base —
 * the same rule the endpoint follows, from the same function.
 *
 * ⚖️ **This lives here rather than in `wireTracker` so it rides the dynamic
 * boundary too.** A site that declares no scripts never downloads it.
 *
 * @param {*} declared - the raw `scripts` value from either tier
 * @param {string} [basePath]
 * @returns {string[]}
 */
export function resolveScriptUrls(declared, basePath = '') {
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
 * Resolve the declared scripts and append each one, once per document.
 *
 * @param {*} declared - the raw `scripts` value from either tier
 * @param {object} [options]
 * @param {string} [options.basePath] - the deployment base
 * @param {boolean} [options.debug=false] - the operator's switch; the only
 *        place a failure is ever reported
 */
export function loadScripts(declared, { basePath = '', debug = false } = {}) {
  if (typeof document === 'undefined') return

  for (const url of resolveScriptUrls(declared, basePath)) {
    if (!isLoadable(url)) {
      if (debug) console.warn('[uniweb] tracking script skipped, not a fetchable URL:', url)
      continue
    }
    if (loaded.has(url)) continue
    loaded.add(url)

    const script = document.createElement('script')
    script.async = true
    script.src = url
    if (debug) {
      script.addEventListener('error', () =>
        console.warn('[uniweb] tracking script failed to load:', url)
      )
    }
    // `<head>`, matching where a vendor's own snippet is normally installed.
    // Position affects how early the vendor's own code runs, not whether it does.
    document.head.appendChild(script)
  }
}

export default loadScripts
