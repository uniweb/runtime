/**
 * The two helpers the background renderers share — one home, because they are
 * not rendering.
 *
 * ## Why this module exists
 *
 * Backgrounds were an L3 pair until 2026-10-25: `components/Background.jsx`
 * rendered for the browser and `ssr-renderer.js` with `React.createElement`
 * only. ⛔ **Only the RENDERING was ever meant to be twinned — "pure data →
 * L1, one home" — and two pure helpers had been dragged across the seam with
 * it**: a base-path joiner and a colour-opacity converter, byte-identical in
 * both files. The rendering is one copy now too (`background.js`: it needs no
 * hooks or DOM); these stay apart from it because they are not rendering.
 *
 * ⚠️ **And the copies had already drifted from the rule they were copying.**
 * The base-path joiner is `@uniweb/core`'s `applyBasePath`, whose own docblock
 * says it moved down to core *"rather than grow a second copy (the failure
 * `@uniweb/core/route-match` was created to end, after one matcher was
 * implemented twice and the copies diverged)"*. Two copies grew anyway, in the
 * runtime, and **both were missing its protocol-relative guard** — so an author
 * writing `//cdn.example.com/hero.jpg` on a site with `base: /docs/` got
 * `/docs//cdn.example.com/hero.jpg`. Measured 2026-09-06; the exact garbage
 * `applyBasePath` documents itself as existing to prevent.
 *
 * ⇒ The lesson is narrower than "don't duplicate": **when a twinned pair needs a
 * helper, the helper is the thing that must not be twinned.** A twin is a
 * commitment to keep two renderers in step; every pure function pulled inside it
 * silently joins that commitment.
 */

import { applyBasePath } from '@uniweb/core/base-path'

/**
 * A site-root-relative URL with the deployment base applied.
 *
 * The base comes off the active website rather than being passed in, because
 * both callers render from the singleton and neither has it to hand. The join
 * itself is core's — protocol-relative and absolute URLs pass through, and an
 * already-based path is not based twice.
 *
 * @param {string} url
 * @returns {string}
 */
export function siteUrl(url) {
  return applyBasePath(url, globalThis.uniweb?.activeWebsite?.basePath || '')
}

/**
 * A colour with an alpha applied, for an overlay drawn over a background.
 *
 * Hex and `rgb()` / `rgba()` are converted; anything else — a named colour, a
 * `var(--token)`, `oklch(…)` — is returned unchanged, because a wrong guess
 * here paints the wrong colour rather than failing.
 *
 * @param {string} color
 * @param {number} opacity
 * @returns {string}
 */
export function withOpacity(color, opacity) {
  if (typeof color !== 'string' || !color) return color
  if (color.startsWith('#')) {
    // `#rgb` and `#rgba` are written out first; an alpha pair is replaced by `opacity`.
    // ⛔ Until 2026-10-25 every hex was read as six digits, so `#000` gave `rgba(0, 0, NaN, …)`,
    // and a gradient using it was invalid CSS that drew nothing.
    let hex = color.slice(1)
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('')
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return color
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${opacity})`
  }
  if (color.startsWith('rgb')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (match) return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${opacity})`
  }
  return color
}
