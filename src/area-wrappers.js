/**
 * What the runtime puts on a layout-area wrapper.
 *
 * When a foundation enables view transitions (the default), the runtime gives
 * each layout region a `view-transition-name` so the browser animates them
 * independently — persistent chrome (header, sidebar, footer) morphs in place
 * while the body crossfades. Without per-region names the browser falls back to
 * a single full-page crossfade, which makes the whole layout (chrome included)
 * flicker on every navigation.
 *
 * Naming is only half of it. A `view-transition-name` **makes its element a
 * stacking context**, so the moment the runtime adds these wrappers it has
 * decided how the areas paint relative to one another — and with no `z-index`
 * on them they all sit at `auto` and paint in DOM order, which puts the body
 * over the header on any layout that renders the header first.
 *
 * That is not theoretical. It is the same mechanism `@uniweb/kit`'s `Overlay`
 * exists for (a modal opened from the header, trapped inside `uw-header`), and
 * it made a real docs page's fixed header unclickable while the identical
 * header on the marketing layout was fine — because that layout's markup
 * happened to wrap its header area in `relative z-40`. A framework that
 * creates stacking contexts owes its users an order; leaving it to DOM order
 * means "does my header work" is answered by an accident of someone's JSX.
 *
 * So this module resolves BOTH halves of the wrapper — the transition name and
 * the stacking layer — and hands back the finished style. It is pure (no
 * React/DOM) so the SPA renderer (`components/Layout.jsx`) and the SSR renderer
 * (`ssr-renderer.js`) produce identical wrappers, keeping prerendered HTML and
 * the hydrated SPA aligned.
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

/**
 * The stacking layer of each area's wrapper.
 *
 * Default: every area except the body gets `1`, and the body gets nothing —
 * content is the backdrop, chrome is above it. That is the whole of what the
 * framework claims to know, and it is deliberately not more.
 *
 * The body is left unstacked rather than pinned to `0` on purpose. A layer
 * brings `position: relative` with it (see `areaWrapperStyle`), and a
 * positioned body wrapper would become the containing block for every
 * absolutely-positioned descendant on the page — a real behaviour change across
 * every site, to buy an ordering that lifting the chrome already achieves. An
 * unlayered body stays a plain stacking context and paints below anything with
 * a positive z-index, which is exactly the intent.
 *
 * In particular there is no default ordering BETWEEN chrome areas. Area names
 * are free-form (`header`, `footer`, `left` and `right` are conventions the
 * docs promote, but a foundation may define `topbar`, `rail`, `statusbar`,
 * anything), so ranking `header` above `left` would be the framework reading
 * meaning into a string it does not own — and would then behave differently for
 * a layout that spelled the same idea another way. Where two pieces of chrome
 * genuinely overlap, which one wins is a design decision, and the layout says
 * so with `layers`.
 *
 * The shape mirrors `transitions` exactly, so there is one thing to learn:
 *   - an object overrides per region (`{ footer: 0 }`, `{ header: 5 }`), and a
 *     region may be set to `null` to leave it unstacked;
 *   - `false` opts the whole layout out, and the runtime then emits no
 *     stacking at all — for a foundation that would rather own it in its own
 *     markup, which is exactly what the marketing layout above was doing.
 *
 * Layers do NOT depend on view transitions. "Chrome paints above content" is a
 * property of the layout, not of how it animates — and body sections routinely
 * form their own stacking contexts (a section with a background isolates so its
 * background layer stays contained), so a fixed header in an unstacked sibling
 * area is not guaranteed to win against them either way. Tying the two together
 * was what left `DefaultLayout` hand-rolling its own `z-index: 40` on the
 * header: a second mechanism for the same job, which then swallowed `layers`
 * whole — a foundation could set `layers: { header: 0 }` on the default layout
 * and measurably nothing happened.
 *
 * @param {string[]} areaNames - Names of the areas rendered for this page (excludes `body`).
 * @param {Object|false|null|undefined} explicit - `layoutMeta.layers`.
 * @returns {Object} region → z-index. Empty when the layout opts out.
 */
export function resolveLayoutLayers(areaNames, explicit) {
  if (explicit === false) return {}

  const defaults = {}
  for (const name of areaNames) defaults[name] = 1

  return explicit ? { ...defaults, ...explicit } : defaults
}

/**
 * The finished inline style for one area's wrapper, or `null` when the region
 * needs no wrapper at all.
 *
 * Returning the whole style from one place is the point: the SPA and SSR
 * renderers each build these wrappers, and a rule applied in one and forgotten
 * in the other is invisible until a prerendered page and its hydrated self
 * disagree about what paints on top.
 *
 * `position: relative` rides along with a layer because `z-index` does nothing
 * on a static element. It is set only on regions that carry a layer, which is
 * why the default leaves the body at `0` rather than lifting everything: a
 * positioned body wrapper would become the containing block for every
 * absolutely-positioned descendant on the page, and the ordering does not need
 * it.
 *
 * @param {string} region - Area name, or `body`.
 * @param {Object|null} transitions - region → view-transition-name.
 * @param {Object} layers - region → z-index.
 * @returns {Object|null} Inline style object, or null for no wrapper.
 */
export function areaWrapperStyle(region, transitions, layers) {
  const style = {}

  const name = transitions?.[region]
  if (name) style.viewTransitionName = name

  const layer = layers?.[region]
  if (layer != null) {
    style.position = 'relative'
    style.zIndex = layer
  }

  return Object.keys(style).length > 0 ? style : null
}
