/**
 * Appearance — site-wide color scheme (light/dark) at SPA boot.
 *
 * The scheme is resolved and applied ONCE, synchronously, inside initRuntime:
 * after initUniweb() (so website.themeData.appearance is readable) and before
 * createRoot().render(). That position is the whole point:
 *
 *   - It precedes React's first paint, so no section renders with the wrong
 *     tokens and then flips.
 *   - It covers every delivery mode, because all three start() branches —
 *     shell-mode __DATA__, runtime/federated, and bundled — funnel into
 *     initRuntime.
 *
 * This is the ONLY place the boot scheme is resolved. Kit's useAppearance()
 * reads the class this sets instead of re-deriving it, so there is exactly one
 * resolver and one boot-time writer. Two writers with independent resolution is
 * precisely the bug this replaced: WebsiteRenderer used to re-apply
 * `appearance.default` from an effect, and because React runs child effects
 * before parent effects it clobbered the visitor's stored preference on every
 * page load — the page came back light while the toggle button still believed
 * it was dark, making the next click a no-op.
 *
 * An inline <head> script would NOT be a general substitute here. Theme CSS is
 * inlined into the document only for prerendered SSG output; in shell mode,
 * runtime/federated mode, and dev it is injected by ThemeProvider once React
 * mounts. A pre-paint script would therefore set a class matching no rules in
 * exactly the modes that matter most. (Prerendered SSG is the one mode where
 * such a script does help, since its CSS is already in <head> — that belongs in
 * the prerender emitter, not here.)
 *
 * Browser-only by design: touches localStorage, matchMedia, and document. Do
 * not import this from ssr-renderer.js.
 */

import { hasDarkScheme } from '@uniweb/core'

export const APPEARANCE_STORAGE_KEY = 'uniweb-appearance'
export const DARK_SCHEME_CLASS = 'scheme-dark'
export const LIGHT_SCHEME_CLASS = 'scheme-light'

/**
 * Read the visitor's stored scheme preference.
 *
 * @returns {'light'|'dark'|null} null when unset or unreadable
 */
function readStoredScheme() {
  if (typeof localStorage === 'undefined') return null
  try {
    const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : null
  } catch {
    // Safari private mode and some embedded webviews throw on access
    return null
  }
}

/**
 * Does the OS currently ask for dark?
 */
function prefersDark() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Resolve the scheme to apply at boot.
 *
 * Precedence: stored visitor preference → system preference (when the theme
 * opts in) → the theme's declared default.
 *
 * @param {Object} appearance - the resolved theme.yml `appearance:` block
 * @returns {'light'|'dark'}
 */
export function resolveBootScheme(appearance = {}) {
  const stored = readStoredScheme()
  if (stored) return stored

  // Follow the OS on first visit when the site opts to respect it AND actually
  // reaches dark. The gate is @uniweb/core's hasDarkScheme() — the same
  // predicate @uniweb/theming uses to decide whether `.scheme-dark` CSS exists —
  // so the boot scheme can never claim a dark that has no matching rules.
  //
  // Previously this branch gated on `schemes.includes('dark')` alone, which
  // neither toggling nor CSS generation consulted: a site with `allowToggle:
  // true` and no `schemes:` (e.g. the `learning` template) toggled to dark by
  // hand but would not follow a system dark preference on first visit. Unifying
  // on hasDarkScheme() removes that divergence — any site that ships a working
  // dark mode now respects the OS on first visit (opt out with
  // `respectSystemPreference: false`).
  if (appearance.respectSystemPreference && hasDarkScheme(appearance) && prefersDark()) {
    return 'dark'
  }

  return appearance.default === 'dark' ? 'dark' : 'light'
}

/**
 * Write a scheme to the document root.
 *
 * Always sets an explicit class rather than relying on the absence of one.
 * `default: 'system'` themes generate a `@media (prefers-color-scheme: dark)`
 * block scoped to `:root:not(.scheme-light)`, so forcing light on a dark OS
 * requires `scheme-light` to be present — removing `scheme-dark` alone would
 * leave the media query still applying dark tokens.
 *
 * @param {'light'|'dark'} scheme
 */
export function applyScheme(scheme) {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  if (scheme === 'dark') {
    root.classList.add(DARK_SCHEME_CLASS)
    root.classList.remove(LIGHT_SCHEME_CLASS)
  } else {
    root.classList.add(LIGHT_SCHEME_CLASS)
    root.classList.remove(DARK_SCHEME_CLASS)
  }
}

/**
 * Resolve and apply the boot scheme. Called by initRuntime.
 *
 * @param {Object} appearance - the resolved theme.yml `appearance:` block
 * @returns {'light'|'dark'|null} the applied scheme, or null when the theme
 *   declares no appearance config
 */
export function initAppearance(appearance) {
  if (!appearance) return null

  const scheme = resolveBootScheme(appearance)
  applyScheme(scheme)
  return scheme
}
