/**
 * What the runtime puts on a layout-area wrapper: its stacking layer, and the
 * `view-transition-name` its layout asks for, if any.
 *
 * ⭐ **An area takes no name unless its layout asks.** A navigation crossfades the
 * page, and chrome that stays in place stays steady, since the old page and the new
 * one agree there (measured 2026-11-02 in Chromium and WebKit). A name takes a box out
 * of that crossfade and animates it from where it was on screen to where it lands.
 * That is worth having for a morph a layout means, and does harm to a box nobody
 * thought about. Until 2026-11-02 the runtime named every area, with these results:
 *
 *   - a bar `fixed` in a box that scrolls with the page moved by the whole scroll on a
 *     switch from a scrolled page: the old bar dropped through the page as it faded,
 *     and the new one came down from above;
 *   - a visible footer moved the same way, off the bottom of the screen;
 *   - a box with no height is captured as nothing, so a bar overlaying the page was
 *     gone for the length of every switch;
 *   - in WebKit a bar kept in place, `fixed` or stuck, faded out over a switch and came
 *     back at the end;
 *   - a name makes a Backdrop Root, so a bar's `backdrop-blur` saw nothing past its
 *     wrapper, at rest too.
 *
 * ⛔ **A name is also a capture.** A named element is captured as one image. WebKit
 * captures it whole, off-screen part included, at device resolution, painting every
 * filter in it on the main thread; the page itself is captured at the size of the
 * viewport. Measured 2026-10-30 on a live site, in WebKit on a 3× phone viewport with a
 * desktop CPU: a named body was a 1179 × 22710 capture, 107 MB against 9 MB, and a tap
 * stalled the main thread for up to 842 ms, against 271 ms with no name. Chromium did
 * not stall at all. On an iPhone, that site froze for about 30 s on a tap.
 *
 * The wrapper's standing job is the order areas paint in. A layer makes its wrapper
 * **a stacking context**, as a section's own `z-index` and background routinely make
 * theirs, and with no order they paint by position in the DOM, which put the body over
 * the header on any layout that renders the header first.
 *
 * That is not theoretical. It is the same mechanism `@uniweb/kit`'s `Overlay` exists
 * for (a modal opened from the header, trapped inside the header's wrapper), and it
 * made a real docs page's fixed header unclickable while the identical header on the
 * marketing layout was fine — because that layout's markup happened to wrap its header
 * area in `relative z-40`. A framework that creates stacking contexts owes its users an
 * order; leaving it to DOM order means "does my header work" is answered by an accident
 * of someone's JSX.
 *
 * So this module resolves BOTH halves of the wrapper — the transition name and
 * the stacking layer — and hands back the finished style. It is pure (no
 * React/DOM) so the SPA renderer (`components/Layout.jsx`) and the SSR renderer
 * (`ssr-renderer.js`) produce identical wrappers, keeping prerendered HTML and
 * the hydrated SPA aligned.
 */

import { stickyStyle } from './sticky.js'

/**
 * A layout's view-transition names: what its `meta.js` `transitions` asks for.
 *
 *   - nothing: no area takes a name, and the page crossfades as one (the header above);
 *   - an object names regions (`{ left: 'sidebar' }`), and two layouts that give a
 *     region the same name morph it between them. A body may be named (`{ body: 'main' }`),
 *     and WebKit captures it whole;
 *   - `false` opts the layout out, which leaves its body with no wrapper
 *     (`areaWrapperStyle`).
 *
 * @param {Object|false|null|undefined} explicit - `layoutMeta.transitions`.
 * @returns {Object|null} region → view-transition-name; `null` when opted out.
 *   A region whose value is absent or empty gets no name.
 */
export function resolveLayoutTransitions(explicit) {
  return explicit === false ? null : explicit || {}
}

/**
 * The stacking layer of each area's wrapper.
 *
 * Default: every area except the body gets `1`, and the body gets nothing —
 * content is the backdrop, chrome is above it — and a sticky area gets one more
 * than every area that does not stick (below). That is the whole of what the
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
 * ⭐ The one ordering the framework does know is a sticky area's (`sticky.js` — any of its sections
 * is). It stays in view while the rest of the page scrolls under it, so it is lifted above every
 * area that does not stick: the runtime made it stick, so it owes it the layer. Left equal to them,
 * a footer taller than the space below a stuck header paints over the header at the bottom of the
 * page, since it comes later in the DOM (measured 2026-10-19: a 521px footer on a 480px-tall
 * phone). That is a fact about the box, not a reading of the area's name, and the layout's
 * `layers` still rank a sticky area it names.
 *
 * @param {string[]} areaNames - Names of the areas rendered for this page (excludes `body`).
 * @param {Object|false|null|undefined} explicit - `layoutMeta.layers`.
 * @param {Object} [sticky] - region → its stickiness, or null (`layoutStickiness`).
 * @returns {Object} region → z-index. Empty when the layout opts out.
 */
export function resolveLayoutLayers(areaNames, explicit, sticky = null) {
  if (explicit === false) return {}

  const layers = {}
  for (const name of areaNames) layers[name] = 1
  if (explicit) Object.assign(layers, explicit)

  const lifted = areaNames.filter((name) => sticky?.[name] && !(explicit && name in explicit))
  if (lifted.length > 0) {
    const under = Object.entries(layers)
      .filter(([name, layer]) => !sticky?.[name] && Number.isFinite(layer))
      .map(([, layer]) => layer)
    const above = Math.max(0, ...under) + 1
    for (const name of lifted) layers[name] = above
  }

  return layers
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
 * A sticky area (`sticky.js` — any of its sections is) is `position: sticky` in place of
 * `relative`, keeping its layer and its transition name. Only a foundation's layout passes one: the
 * built-in layout's area wrapper sits in its zone, as tall as itself, so the zone sticks instead.
 *
 * @param {string} region - Area name, or `body`.
 * @param {Object|null} transitions - region → view-transition-name.
 * @param {Object} layers - region → z-index.
 * @param {{ top: string }|null} [sticky] - the area's stickiness, when its box is the one that sticks
 * @returns {Object|null} Inline style object, or null for no wrapper.
 */
export function areaWrapperStyle(region, transitions, layers, sticky = null) {
  const style = {}

  const name = transitions?.[region]
  if (name) style.viewTransitionName = name
  else if (transitions && region === 'body') style.isolation = 'isolate'

  const layer = layers?.[region]
  if (sticky) {
    Object.assign(style, stickyStyle(sticky.top, layer))
  } else if (layer != null) {
    style.position = 'relative'
    style.zIndex = layer
  }

  return Object.keys(style).length > 0 ? style : null
}

/**
 * The props for one area's wrapper element — its style, and `data-uw-sticky="area"` when it is
 * the box that sticks (`sticky.js`) — or `null` when the region needs no wrapper. Both renderers
 * build the wrapper from this, so the prerendered page and the browser's agree.
 *
 * @param {string} region - Area name, or `body`.
 * @param {Object|null} transitions - region → view-transition-name.
 * @param {Object} layers - region → z-index.
 * @param {{ top: string }|null} [sticky] - the area's stickiness, when its box is the one that sticks
 * @returns {{ style: Object, 'data-uw-sticky'?: 'area' }|null}
 */
export function areaWrapperProps(region, transitions, layers, sticky = null) {
  const style = areaWrapperStyle(region, transitions, layers, sticky)
  if (!style) return null
  return sticky ? { style, 'data-uw-sticky': 'area' } : { style }
}
