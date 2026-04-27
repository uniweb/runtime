/**
 * Layer-2 wiring helpers: runtime ↔ Uniweb singleton.
 *
 * After `createUniweb()` constructs the singleton, the runtime fills a
 * few declared slots on it before the first render — foundation
 * capabilities (`defaultInsets`, `xref.build()`), per-request data
 * hydration into `website.dataStore`, locale-scoped content slicing.
 * This step is identical in every environment (browser SPA, SSG
 * prerender, cloud SSR) because it's plain data manipulation on a JS
 * object: no React rendering happens here, no hooks are called, no DOM
 * is touched, no `react-dom/server` is needed.
 *
 * That's why these helpers live in one file imported by both
 * `setup.js` (browser boot) and `ssr-renderer.js` (SSG/cloud-SSR boot),
 * instead of being duplicated into each. Things that genuinely differ
 * between environments — routing components, icon-cache hydration from
 * the DOM, the per-page render loop — stay in the per-environment
 * entries; these helpers cover only the environment-agnostic L2 work.
 *
 * Keeping this file React-free matters for the SPA bundle: `setup.js`
 * pulls `wire-foundation.js` directly, but it must NOT transitively
 * pull `ssr-renderer.js` (which imports `react-dom/server`). The L2
 * helpers therefore live here, while the L3-composing
 * `initPrerenderForLocale` lives in `ssr-renderer.js`.
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
import { deriveCacheKey } from '@uniweb/core'

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

/**
 * Slice a multi-locale site-content payload to one locale.
 *
 * Sites published through the editor ship a single payload that carries
 * all locales nested under `content.locales[locale]` — `pages`, optional
 * `layouts`, and a `config` overlay. The default locale lives at the
 * top level (no nesting). This helper extracts the requested locale's
 * view as a fresh content object the rest of the runtime can consume
 * unchanged.
 *
 * Returns `content` as-is when `locale` is the default, missing, or not
 * present in `content.locales` — callers that already hand us locale-
 * scoped content (e.g., the framework's per-locale SSG path that loads
 * each `dist/{locale}/site-content.json` separately) get pass-through
 * behavior.
 *
 * The shape comes from the editor's publish payload, which is the
 * production canonical for multi-locale content (the Cloudflare Worker
 * SSR path consumes it directly). Build-time SSG pre-flattens to one
 * file per locale and so falls into the pass-through case.
 *
 * @param {Object} content - Site content payload, possibly multi-locale.
 * @param {string} locale - Requested locale code.
 * @returns {Object} Content scoped to the requested locale.
 */
export function sliceContentForLocale(content, locale) {
  const defaultLang = content?.config?.defaultLanguage || 'en'
  const locData = content?.locales?.[locale]
  if (!locale || locale === defaultLang || !locData) return content
  return {
    pages: locData.pages,
    layouts: locData.layouts || content.layouts,
    config: {
      ...locData.config,
      i18n: content.config?.i18n,
      activeLocale: locale,
    },
  }
}

/**
 * Pre-populate a Website's DataStore from build-time / publish-time
 * fetched data so the dispatcher's first probe hits the cache instead
 * of refetching.
 *
 * The cache key MUST go through `deriveCacheKey(entry.config)` and the
 * value MUST be wrapped as `{ data }` — otherwise the dispatcher's
 * lookup at `_dataStore.get(deriveCacheKey(request))` misses every
 * time and `cached.data` reads `undefined`. Three call sites used to
 * inline this loop independently (browser SPA, Node SSG, Cloudflare
 * Worker SSR); the Cloudflare one was using the wrong shape, silently
 * killing prefetched-data reuse in production. This helper is the one
 * canonical implementation.
 *
 * @param {import('@uniweb/core').Website} website
 * @param {Array<{config: Object, data: any}>} fetchedData
 */
export function hydrateDataStore(website, fetchedData) {
  if (!website?.dataStore || !fetchedData?.length) return
  for (const entry of fetchedData) {
    website.dataStore.set(deriveCacheKey(entry.config), { data: entry.data })
  }
}
