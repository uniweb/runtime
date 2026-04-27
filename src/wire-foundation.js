/**
 * Layer-2 wiring: runtime ↔ foundation.
 *
 * After `createUniweb()` constructs the singleton, the runtime fills a
 * few declared slots on it before the first render — `defaultInsets`,
 * foundation capability hooks like `xref.build()`, and similar. This
 * step is identical in every environment (browser SPA, SSG prerender,
 * cloud SSR) because it's plain assignment on a JS object: no React
 * rendering happens here, no hooks are called, no DOM is touched.
 *
 * That's why the wiring lives in one file imported by both `setup.js`
 * (browser boot) and `ssr-renderer.js` (SSG/cloud-SSR boot), instead of
 * being duplicated into each. Things that genuinely differ between
 * environments — routing components, icon-cache hydration from the DOM
 * — stay in the per-environment entries; this helper covers only the
 * environment-agnostic part.
 *
 * Adding a new framework-level capability:
 *   1. Read the foundation declaration via `foundation.default.capabilities.<name>`.
 *   2. Apply it to the uniweb singleton (set a slot, call a build hook,
 *      register something on `activeWebsite`).
 *   3. Provide a runtime fallback if the capability is one foundations
 *      may legitimately not declare (see `FallbackRef`).
 *
 * Foundation export shape contract: the runtime always loads the
 * **built** foundation artifact (`dist/foundation.js`) via
 * `loadFoundation()` in `foundation-loader.js`, which does `import(url)`
 * and returns a module namespace. The build pipeline
 * (`framework/build/src/generate-entry.js`) wraps the foundation's
 * source default export under `default.capabilities.*`, so the runtime
 * sees a single canonical shape with no need for fallback chains. See
 * `framework/CLAUDE.md` "Three-Layer Runtime Model" for the rationale
 * and for how this differs from `@uniweb/press` / `@uniweb/unipress`,
 * which DO need to handle a second shape because they're sometimes
 * called from inside a foundation bundle (where the foundation imports
 * its own source as a bare default object).
 */

import React from 'react'

/**
 * Renders unhandled `[#id]` cross-reference markers as plain text. Used
 * when the active foundation didn't declare its own `<Ref>` via
 * `defaultInsets`. Pure `React.createElement` — safe in every
 * environment, including the hook-free SSR pipeline.
 *
 * Foundations that support cross-references override this by exporting
 * `defaultInsets: { Ref }` (with kit's xref-aware Ref) from their
 * source — the build pipeline carries it through into
 * `default.capabilities.defaultInsets`.
 */
export function FallbackRef({ params }) {
  return React.createElement(
    'span',
    { className: 'xref xref--unhandled' },
    `[${params?.key || '?'}]`,
  )
}

/**
 * Wire foundation-declared capabilities onto a freshly constructed
 * Uniweb singleton. Called once, after `createUniweb()`, before any
 * rendering. Identical for SPA, SSG, and cloud SSR.
 *
 * @param {import('@uniweb/core').default} uniweb - From createUniweb(...).
 * @param {object} foundation - Loaded foundation module (built shape).
 */
export function wireFoundationCapabilities(uniweb, foundation) {
  const caps = foundation?.default?.capabilities || {}

  // defaultInsets: framework provides FallbackRef as the floor;
  // foundation overrides win. `getComponent()` on the Uniweb singleton
  // (core/uniweb.js) falls back to defaultInsets[name] when no
  // foundation/extension component matches — that's how `<Ref>` becomes
  // available to every foundation without each one having to register
  // it explicitly.
  uniweb.defaultInsets = { Ref: FallbackRef, ...(caps.defaultInsets || {}) }

  // xref: foundations supporting cross-references export
  // `xref.build(website, { foundationKinds })`. The runtime can't
  // import kit directly (kit is bundled into each foundation, not into
  // runtime — see CLAUDE.md gotcha #9 on tree-shaking), so it
  // dispatches through the foundation's reference. Foundations without
  // xref skip this entirely; kit's xref module never enters their
  // bundle thanks to tree-shaking at foundation-build time.
  if (caps.xref?.build && uniweb.activeWebsite) {
    caps.xref.build(uniweb.activeWebsite, {
      foundationKinds: caps.xref.kinds || {},
    })
  }
}
