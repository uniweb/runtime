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
 *   2. A page's HTML — `writePageAppearance()` writes what `pageAppearance()` says
 *      the page carries. injectPageContent() in ssr-renderer.js calls it for a
 *      prerendered page, on every prerender lane, the framework's SSG and a host's
 *      render alike; emitting from a lane-specific injector is how the hosted lane
 *      silently missed it once already. @uniweb/build's site plugin calls it for
 *      the shell a page the browser renders itself starts as (`uniweb dev`, a
 *      build that doesn't prerender), whose empty page paints its background too.
 *      A page paints before the runtime's module script runs, styled from :root
 *      (light) tokens unless a scheme class says otherwise, and its HTML is one
 *      document for every visitor. So:
 *        - its `<html>` is written in the scheme every first visit resolves to,
 *          where the browser can't change that (a dark default, or a site that
 *          doesn't follow the system), and the page is right before any script
 *          runs, and with none;
 *        - the SAME function, serialized into a synchronous <head> script,
 *          corrects what only the browser knows: a visitor's choice, on a site
 *          with a switch, and the system's preference, where it decides. Only a
 *          script ahead of the body runs before the first paint. A page that
 *          needs neither carries no script.
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
 * ssr-renderer.js can import this module in Node and in a server-side isolate.
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
 * Precedence: stored visitor preference (on a site with a switch) → OS preference
 * (when the site opts in) → the theme's declared default.
 *
 * ⭐ A STORED CHOICE COUNTS ONLY ON A SITE WITH A SWITCH (`allowToggle`). The key is
 * the origin's, so on a site with none a stored value is another site's: one served
 * on the same `localhost` port, or the site this one replaced at its address. ⛔ Until
 * 2026-11-11 it applied anyway, so a site set to one look showed the other to a
 * visitor who had chosen it elsewhere, with no switch to undo it.
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
 * @param {boolean} [honorStored] - the site offers a switch, so a stored choice is the visitor's
 * @returns {'light'|'dark'} the scheme applied
 */
export function applyBootScheme(respectSystem, fallback, honorStored) {
  var stored = null
  if (honorStored) {
    try {
      stored = localStorage.getItem('uniweb-appearance')
    } catch (e) {
      // Safari private mode and some embedded webviews throw on access
    }
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
 * @returns {{respectSystem: boolean, fallback: 'light'|'dark', honorStored: boolean}|null}
 */
export function resolveAppearanceBoot(appearance) {
  if (!appearance || !hasDarkScheme(appearance)) return null

  return {
    respectSystem: appearance.respectSystemPreference !== false,
    fallback: appearance.default === 'dark' ? 'dark' : 'light',
    // Only a site with a switch has a choice of its own to remember (`applyBootScheme`).
    honorStored: appearance.allowToggle === true,
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

  return applyBootScheme(opts.respectSystem, opts.fallback, opts.honorStored)
}

/**
 * What a page's HTML carries for its look, a prerendered page and a shell alike.
 *
 * - `scheme`: the class its `<html>` is written with, the scheme every first visit
 *   resolves to, or null when the visitor's system decides it. A dark default is
 *   dark whatever the system says, since `applyBootScheme` follows a system only
 *   to dark, and a site that doesn't follow the system shows its default.
 *   ⛔ Never `light` for a site that follows the system: under `default: system`
 *   the theme's `@media (prefers-color-scheme: dark)` block is scoped to
 *   `:root:not(.scheme-light)`, so a page written `scheme-light` would stay light
 *   for a dark system's visitor until a script ran, and for good without one.
 * - `script`: the pre-paint script, or '' when the browser knows nothing the
 *   render doesn't: no switch, so no visitor's choice to apply, and a scheme the
 *   system can't change.
 *
 * ⛔ Until 2026-11-11 a page's `<html>` carried no class, and every page of a site
 * with dark carried the script. So a site set to dark depended on a script for its
 * look, and a reader that ran none (scripts off, a strict content security policy)
 * saw it light.
 *
 * @param {Object} [appearance] - the resolved theme.yml `appearance:` block
 * @returns {{ scheme: 'light'|'dark'|null, script: string }}
 */
export function pageAppearance(appearance) {
  const opts = resolveAppearanceBoot(appearance)
  if (!opts) return { scheme: null, script: '' }

  const scheme = opts.fallback === 'dark' || !opts.respectSystem ? opts.fallback : null
  const script = opts.honorStored || scheme === null ? bootScript(opts) : ''
  return { scheme, script }
}

/**
 * `html` carrying the page's look (`pageAppearance`): the scheme class on its
 * `<html>`, and the pre-paint script before `</head>` where the browser decides.
 * Idempotent, since a page's HTML may pass through more than one writer: a
 * prerendered page starts as a shell that may carry both already.
 *
 * @param {string} html - a page's HTML, or the shell it starts as
 * @param {Object} [appearance] - the resolved theme.yml `appearance:` block
 * @returns {string}
 */
export function writePageAppearance(html, appearance) {
  const { scheme, script } = pageAppearance(appearance)
  let result = writeSchemeClass(html, scheme)
  if (script && !result.includes('id="uniweb-appearance"')) {
    result = result.replace('</head>', () => `  ${script}\n</head>`)
  }
  return result
}

/**
 * `html` with its `<html>` start tag carrying the class of `scheme`, in place of
 * either scheme class it held, every other class kept. Unchanged for no scheme,
 * or with no `<html>` tag. Idempotent, since a page's HTML may pass through more
 * than one injector.
 *
 * @param {string} html
 * @param {'light'|'dark'|null} scheme
 * @returns {string}
 */
export function writeSchemeClass(html, scheme) {
  if (scheme !== 'dark' && scheme !== 'light') return html
  const name = scheme === 'dark' ? 'scheme-dark' : 'scheme-light'

  return html.replace(/<html(\s[^>]*)?>/i, (tag, attrs = '') => {
    const held = attrs.match(/\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
    if (!held) return `<html${attrs} class="${name}">`
    const kept = (held[1] ?? held[2])
      .split(/\s+/)
      .filter((c) => c && c !== 'scheme-dark' && c !== 'scheme-light')
    return `<html${attrs.replace(held[0], () => ` class="${[...kept, name].join(' ')}"`)}>`
  })
}

/**
 * The pre-paint <script> alone, for a caller that writes no scheme class.
 *
 * Returns '' when the site has no dark scheme — a light-only page always renders
 * light, so there is nothing to correct before paint and no reason to ship the
 * bytes. A page whose body is empty until the bundle renders needs it too: its
 * background paints in the light tokens until the bundle boots, about 0.4 s on a
 * dark site under `uniweb dev`. Exported for a lane that assembles a shell
 * without a per-page render (`ssr.js`); a page's HTML is written by
 * writePageAppearance() instead, which adds the class and leaves this out where
 * the class says everything.
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
  return opts ? bootScript(opts) : ''
}

/** The pre-paint `<script>`, for what resolveAppearanceBoot returned. */
function bootScript(opts) {
  const call = `(${applyBootScheme.toString()})(${opts.respectSystem}, ${JSON.stringify(opts.fallback)}, ${opts.honorStored})`

  return `<script id="uniweb-appearance">${call}</script>`
}
