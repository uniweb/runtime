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
 * **built** foundation artifact (`dist/entry.js`) via
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
import { deriveCacheKey, resolveDefaultLocale } from '@uniweb/core'
// Leaf subpaths, not the package root: this file is pulled into the SSR/Worker
// bundle, and `@uniweb/core` proper drags semantic-parser and theming with it.
import { resolveService, readServiceOptions, resolveServiceUrl } from '@uniweb/core/services'
import Tracker from '@uniweb/core/tracker'
import { buildTheme } from '@uniweb/theming'

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
  const defaultLang = resolveDefaultLocale(content?.config)
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

/**
 * Make sure the site's theme CSS exists on the graph, generating it from
 * the authored config when nothing upstream did.
 *
 * **The authored theme config is the source of truth in every lane;
 * generated CSS is a cache of it.** `uniweb build` fills that cache and
 * bakes the result into `<head>`, so this is a no-op on the static lane.
 * A lane that serves a site WITHOUT running the framework's build — a
 * backend-hosted SPA, a cloud shell-mode fallback — carries only the
 * authored `theme.yml` (that is the correct thing for a sync wire to
 * carry: `theme.css` is a build artifact, and with two publishers only
 * one of which computes it, shipping it would make a site's styling
 * depend on who published last). Without this helper those lanes render
 * with every semantic token unset — no colours, no backgrounds.
 *
 * Generating here rather than in a publish step is what keeps the
 * three-ingredient contract true: site + foundation + runtime converge
 * to a *styled* page with no fourth actor. It also stays one
 * implementation — the alternative was re-deriving the OKLCH shade math
 * in another language and keeping the two bit-compatible.
 *
 * L2, not L3: this reads and writes graph state and renders nothing, so
 * it has a single home here and both boot paths call it. **The
 * `@uniweb/theming` import is deliberately static.** An SSR isolate
 * loads a fixed modules map and cannot resolve a chunk graph, so the SSR
 * entry must include the generator statically; a lazy `import()` in the
 * browser entry only would mean two mechanisms for one behaviour,
 * drifting independently. Measured cost of the generator: ~4.9 KB gzip.
 *
 * Foundation-declared vars reach us through
 * `capabilities.vars` — emitted into `dist/entry.js` by
 * `@uniweb/build`'s `generate-entry.js`. Before that existed they lived
 * only in `dist/meta/schema.json` and a theme generated outside the
 * build silently lost every one of them.
 *
 * Callers own the "should I?" question, because it is environment-
 * specific: the browser entry skips this when the document already
 * carries a prerendered `<style id="uniweb-theme">` (regenerating from
 * an already-processed config is wasted work at best), while the SSR
 * entry always runs it and lets `injectPageContent()` emit the result
 * idempotently.
 *
 * @param {import('@uniweb/core').default} uniweb - From createUniweb(...).
 * @param {object} foundation - Loaded foundation module (built shape).
 */
export function ensureThemeCss(uniweb, foundation) {
  const website = uniweb?.activeWebsite
  const themeData = website?.themeData
  if (!themeData || themeData.css) return

  const caps = foundation?.default?.capabilities || {}
  try {
    const { config, css, links } = buildTheme(themeData, {
      foundationVars: caps.vars || {},
      base: website.basePath || '/',
    })
    // Merge rather than replace: `config` is the processed superset (it
    // adds `palettes`, normalized `contexts`, resolved `fonts`), so this
    // also gives a build-less lane the same themeData shape the static
    // lane has — Theme.getPalette() and friends start working too.
    Object.assign(themeData, config, { css, links })
  } catch (err) {
    // This runs on the path taken when something upstream has already
    // gone wrong. A degraded render that is still legibly the site beats
    // one that looks broken, but neither is worth a boot crash.
    console.warn('[uniweb] theme CSS generation failed:', err?.message || err)
  }
}

/**
 * L2: give the site's tracker its destination.
 *
 * Replaces the disabled `Tracker` that `createUniweb` declares (see
 * `core/src/uniweb.js`) with a configured one, when — and only when — a
 * destination resolves. With none, the disabled default stays and every
 * `track()` call in the site remains a silent no-op, which is the default
 * state for the large majority of sites.
 *
 * ⛔ **WHY THE BASE PATH IS PASSED IN RATHER THAN READ OFF THE WEBSITE.**
 * `resolveService` joins a root-relative endpoint to `website.basePath`, and
 * that field is still `''` until `setBasePath()` runs — which happens later,
 * from `RuntimeProvider`. Resolving against the website as-is would silently
 * drop the prefix on every subdirectory deployment, and the symptom would be a
 * collector quietly receiving nothing. So the caller supplies the basename it
 * has already derived, and the lookup is done against that. `resolveService`
 * reads only `.config` and `.basePath`, so a plain object is a complete input.
 *
 * ⚖️ **Not called from the SSR path, deliberately.** The tracker is
 * browser-guarded, so wiring it there would produce a configured object that
 * can never emit — a slot that looks live and is not. The SSR twin has no
 * page-view effect either; suppression is structural rather than a flag.
 *
 * ## `tags` — a vendor's own script, when the site declares one
 *
 * A second, independent path (`kb/framework/plans/tracking-vendor-tags.md`):
 * nothing is translated between our stream and theirs, and the framework never
 * learns which vendor it is. ⛔ **The loader is INJECTED rather than imported**,
 * because this file is pulled into the SSR/Worker bundle and a script loader is
 * DOM code. The browser entry passes one; the SSR path passes none, so there is
 * no branch to remember.
 *
 * @param {object} uniweb - the singleton
 * @param {object} [options]
 * @param {string} [options.basePath] - the deployment base (router basename)
 * @param {(urls: string[], opts: object) => void} [options.loadTags] - DOM
 *        loader for declared vendor tags; omitted outside a browser entry
 */
export function wireTracker(uniweb, { basePath = '', loadTags = null } = {}) {
  const website = uniweb?.activeWebsite
  if (!website) return

  // A plain lookup target: `resolveService` reads `.config` and `.basePath`
  // only, so this is the whole of what it needs and carries the *correct* base.
  const target = { config: website.config, basePath }

  const { url } = resolveService(target, 'tracking')
  const options = readServiceOptions(target, 'tracking')
  const tags = resolveTagUrls(options.tags, basePath)

  // Nothing declared on either count — keep the disabled default, nothing
  // armed, nothing queued. This is the state of the large majority of sites.
  if (!url && tags.length === 0) return

  const tracker = new Tracker({
    endpoint: url,
    // Opt-in, not the default. Declaring a destination is itself the operator's
    // decision to track; requiring a second affirmative step would be the
    // framework presuming a jurisdiction on their behalf, which is exactly what
    // it must not do. A site that needs the gate asks for it.
    consentRequired: options.consent === 'required',
    debug: !!options.debug
  })
  uniweb.tracking = tracker

  if (!loadTags || tags.length === 0) return

  // The same suppression the tracker applies to its own events: a server render
  // or a framed authoring preview is not a visit, and a vendor's tag must not
  // fire there either. One predicate in core, so the two cannot drift.
  if (!tracker.isLiveDocument()) return

  const load = () => loadTags(tags, { debug: !!options.debug })
  if (tracker.consentStatus() === 'granted') load()
  else tracker.onGranted = load
}

/**
 * Normalize `tracking.tags` into resolved script URLs.
 *
 * Accepts a bare string or `{ src }` **from the start**, and deliberately: the
 * open question of whether some vendor needs more than a URL is unresolved
 * (`tracking-vendor-tags.md` §14.2), and tolerating both now means a later
 * per-tag field costs nobody a migration. Same tolerance `readEndpoint` already
 * shows for `submit:` and `tracking:` themselves.
 *
 * ⛔ **There is no field for inline code, and that is the whole shape.** A tag
 * is a URL we fetch. Anything else and this becomes `head.html` with extra
 * steps, which is what it exists to replace.
 *
 * Each entry goes through `resolveServiceUrl`, so an absolute URL passes
 * through untouched and a site-relative one is joined to the deployment base —
 * the same rule the endpoint follows, from the same function.
 *
 * @param {*} declared
 * @param {string} basePath
 * @returns {string[]}
 */
function resolveTagUrls(declared, basePath) {
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
