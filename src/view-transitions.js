/**
 * View-transition name resolution for layout areas.
 *
 * When a foundation enables view transitions (the default), the runtime gives
 * each layout region a `view-transition-name` so the browser animates them
 * independently — persistent chrome (header, sidebar, footer) morphs in place
 * while the body crossfades. Without per-region names the browser falls back to
 * a single full-page crossfade, which makes the whole layout (chrome included)
 * flicker on every navigation.
 *
 * This module is pure (no React/DOM) so both the SPA renderer
 * (`components/Layout.jsx`) and the SSR renderer (`ssr-renderer.js`) derive the
 * exact same names — keeping the prerendered HTML and the hydrated SPA aligned.
 */

// Namespace so generated names can't collide with `view-transition-name`s a
// foundation sets inside its own component CSS. The prefix also guarantees a
// valid CSS <custom-ident> (starts with a letter).
const NS = 'uw-'

const toIdent = (name) => NS + String(name).replace(/[^a-zA-Z0-9_-]/g, '-')

/**
 * Build the effective view-transition-name map for a layout.
 *
 * Default: every rendered area plus the implicit `body` gets a stable,
 * namespaced name (`uw-<area>`, `uw-body`). Same-named areas across layouts
 * therefore share a name and morph between layouts automatically.
 *
 * The layout's `meta.js` `transitions` value overrides this:
 *   - an object overrides per region (`{ left: 'sidebar' }` to group across
 *     layouts, or `{ left: null }` to opt one region out);
 *   - `false` opts the whole layout out (back to the full-page crossfade).
 *
 * @param {string[]} areaNames - Names of the areas rendered for this page (excludes `body`).
 * @param {Object|false|null|undefined} explicit - `layoutMeta.transitions`.
 * @returns {Object|null} region → view-transition-name; `null` when opted out.
 *   A region whose value is null/empty in the returned map gets no name.
 */
export function resolveLayoutTransitions(areaNames, explicit) {
  if (explicit === false) return null

  const transitions = { body: toIdent('body') }
  for (const name of areaNames) transitions[name] = toIdent(name)

  return explicit ? { ...transitions, ...explicit } : transitions
}
