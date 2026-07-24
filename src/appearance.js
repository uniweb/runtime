/**
 * Appearance — site-wide color scheme (light/dark).
 *
 * ONE resolver, reached two ways:
 *
 *   1. SPA boot — `initAppearance()` runs inside initRuntime, after initUniweb()
 *      (so website.themeData.appearance is readable) and before
 *      createRoot().render(). That position precedes React's first paint, so no
 *      section renders with the wrong tokens and then flips, and it covers every
 *      delivery mode because all three start() branches funnel into initRuntime.
 *
 *   2. Prerendered HTML — `renderAppearanceBootScript()` serializes the SAME
 *      function into a synchronous <head> script. HTML that ships real body
 *      content is styled from :root (light) tokens until a bundle loads, so
 *      without this a dark visitor sees a flash of light. The script is emitted
 *      by injectPageContent() in ssr-renderer.js, which every prerender lane
 *      goes through — the framework's SSG and the cloud worker's JIT render
 *      alike. Emitting it from a lane-specific injector is how the cloud lane
 *      silently missed it once already.
 *
 * Why serialize instead of hand-writing the inline script: the two paths must
 * agree exactly. `applyBootScheme` is therefore written to be SELF-CONTAINED —
 * it references no module-scope binding, only its two arguments and the browser
 * globals it needs — so `Function.prototype.toString()` yields a script that
 * behaves identically to calling it directly. Keep it that way: an import, a
 * module const, or a helper call would survive `toString()` as an undefined
 * identifier at first paint. appearance.test.js pins the equivalence.
 *
 * Environment-neutral by construction. `applyBootScheme` no-ops its DOM writes
 * outside a browser, and `renderAppearanceBootScript` only stringifies — so
 * ssr-renderer.js can import this module in Node and in a Cloudflare isolate.
 *
 * Two writers with independent resolution is the bug this replaced:
 * WebsiteRenderer used to re-apply `appearance.default` from an effect, and
 * because React runs child effects before parent effects it clobbered the
 * visitor's stored preference on every page load — the page came back light
 * while the toggle button still believed it was dark, making the next click a
 * no-op.
 */

import { hasDarkScheme } from '@uniweb/core'

export const APPEARANCE_STORAGE_KEY = 'uniweb-appearance'
export const DARK_SCHEME_CLASS = 'scheme-dark'
export const LIGHT_SCHEME_CLASS = 'scheme-light'

/**
 * Resolve and apply the visitor's color scheme.
 *
 * Precedence: stored visitor preference → OS preference (when the site opts in)
 * → the theme's declared default.
 *
 * SELF-CONTAINED ON PURPOSE — see the module header. This function is both
 * called directly (SPA boot) and serialized with toString() into the pre-paint
 * <script> of prerendered HTML. It must never reference anything outside its own
 * arguments and the browser globals below; the storage key and class names are
 * inlined as literals rather than read from the exported constants for exactly
 * that reason.
 *
 * Written in ES5 so it needs no transpilation in the inline-script form, and
 * every browser access is guarded: Safari private mode throws on localStorage,
 * old webviews lack matchMedia, and Node has no document.
 *
 * @param {boolean} respectSystem - follow prefers-color-scheme when unset
 * @param {'light'|'dark'} fallback - the theme's declared default
 * @returns {'light'|'dark'} the scheme applied
 */
export function applyBootScheme(respectSystem, fallback) {
  var stored = null
  try {
    stored = localStorage.getItem('uniweb-appearance')
  } catch (e) {
    // Safari private mode and some embedded webviews throw on access
  }

  var hasStored = stored === 'light' || stored === 'dark'
  var scheme = hasStored ? stored : fallback

  if (!hasStored && respectSystem) {
    try {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) scheme = 'dark'
    } catch (e) {
      // No matchMedia — keep the declared default
    }
  }

  try {
    var root = document.documentElement
    // Always set an explicit class rather than relying on the absence of one.
    // `default: system` themes emit a `@media (prefers-color-scheme: dark)`
    // block scoped to `:root:not(.scheme-light)`, so forcing light on a dark OS
    // requires `scheme-light` to be present — removing `scheme-dark` alone would
    // leave the media query still applying dark tokens.
    if (scheme === 'dark') {
      root.classList.add('scheme-dark')
      root.classList.remove('scheme-light')
    } else {
      root.classList.add('scheme-light')
      root.classList.remove('scheme-dark')
    }
  } catch (e) {
    // No DOM (Node / prerender) — the resolved scheme is still returned
  }

  return scheme
}

/**
 * Reduce a theme's `appearance:` block to the two arguments applyBootScheme
 * takes, or null when the site can never show dark.
 *
 * THE ONLY PLACE `appearance.*` FIELDS ARE READ. Both the SPA boot and the
 * inline-script emitter go through here, so the two cannot disagree about what
 * `respectSystemPreference` defaults to. They used to: the runtime treated an
 * unset value as false while the script emitter and @uniweb/core's
 * Theme.getAppearance() treated it as true. Those agreed only by the grace of
 * @uniweb/theming's normalizeAppearance() always injecting the key — any path
 * handing raw theme.yml appearance to the runtime would have produced a
 * pre-paint script and a boot resolver that disagree, i.e. the exact
 * flash-then-flip this whole module exists to prevent. Unset means true, which
 * is what the docs promise and what core already did.
 *
 * The null gate is @uniweb/core's hasDarkScheme() — the same predicate
 * @uniweb/theming uses to decide whether `.scheme-dark` CSS is generated at all.
 * Sharing it means we can never apply a scheme that has no matching rules, and
 * a light-only site correctly gets no class and no inline script.
 *
 * @param {Object} [appearance] - the resolved theme.yml `appearance:` block
 * @returns {{respectSystem: boolean, fallback: 'light'|'dark'}|null}
 */
export function resolveAppearanceBoot(appearance) {
  if (!appearance || !hasDarkScheme(appearance)) return null

  return {
    respectSystem: appearance.respectSystemPreference !== false,
    fallback: appearance.default === 'dark' ? 'dark' : 'light',
  }
}

/**
 * Resolve and apply the boot scheme in the browser. Called by initRuntime.
 *
 * @param {Object} [appearance] - the resolved theme.yml `appearance:` block
 * @returns {'light'|'dark'|null} the applied scheme, or null when the site has
 *   no dark scheme to switch to (nothing is written to the document)
 */
export function initAppearance(appearance) {
  const opts = resolveAppearanceBoot(appearance)
  if (!opts) return null

  return applyBootScheme(opts.respectSystem, opts.fallback)
}

/**
 * Emit the pre-paint <script> for prerendered HTML.
 *
 * Returns '' when the site has no dark scheme — a light-only page always renders
 * light, so there is nothing to correct before paint and no reason to ship the
 * bytes. Pure SPA builds don't need it either: the body is empty until the
 * bundle renders and initAppearance() runs before that first render.
 *
 * Only a boolean and a JSON-quoted 'light'/'dark' are interpolated, both derived
 * from resolveAppearanceBoot rather than taken from the theme verbatim, so
 * author-supplied theme.yml values cannot inject script.
 *
 * @param {Object} [appearance] - the resolved theme.yml `appearance:` block
 * @returns {string} a `<script>` tag, or '' when no script is needed
 */
export function renderAppearanceBootScript(appearance) {
  const opts = resolveAppearanceBoot(appearance)
  if (!opts) return ''

  const call = `(${applyBootScheme.toString()})(${opts.respectSystem}, ${JSON.stringify(opts.fallback)})`

  return `<script id="uniweb-appearance">${call}</script>`
}
