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
 * (`@uniweb/build`'s `src/generate-entry.js`) wraps the foundation's
 * source default export under `default.capabilities.*`, so the runtime
 * sees a single canonical shape with no need for fallback chains. This
 * differs from `@uniweb/press` / `@uniweb/unipress`,
 * which DO need to handle a second shape because they're sometimes
 * called from inside a foundation bundle (where the foundation imports
 * its own source as a bare default object).
 */

import React from 'react'
import { deriveCacheKey, resolveDefaultLocale } from '@uniweb/core'
// Leaf subpaths, not the package root: this file is pulled into the SSR/Worker
// bundle, and `@uniweb/core` proper drags semantic-parser and theming with it.
import { resolveService, readServiceOptions } from '@uniweb/core/services'
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
  // runtime, so only the foundations that use it pay for it), so it
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
 * ## `scripts` — a vendor's own script, when the site declares one
 *
 * A second, independent path — vendor tags:
 * nothing is translated between our stream and theirs, and the framework never
 * learns which vendor it is. ⛔ **The loader is INJECTED rather than imported**,
 * because this file is pulled into the SSR/Worker bundle and a script loader is
 * DOM code. The browser entry passes one; the SSR path passes none, so there is
 * no branch to remember.
 *
 * @param {object} uniweb - the singleton
 * @param {object} [options]
 * @param {string} [options.basePath] - the deployment base (router basename)
 * @param {(urls: string[], opts: object) => void} [options.loadScripts] - DOM
 *        loader for declared vendor scripts; omitted outside a browser entry
 */
/**
 * What `tracking.emit` names, when a site names a preset rather than a list.
 *
 * ⭐ **`all` is deliberately ABSENT from this table.** It resolves to `null` —
 * *no narrowing* — so an event added in a later release is included without the
 * site republishing. A literal list would freeze `all` at the moment the site
 * was built and quietly stop meaning "all".
 *
 * ⚖️ **`standard` and `all` select the same events today, and that is not a
 * reason to drop one.** They diverge the moment a new automatic event ships:
 * `standard` is a curated set that a release cannot grow behind an operator's
 * back, `all` is the standing yes. The volume surprise is the thing being
 * avoided — a site that never changed should not start sending more.
 *
 * ⛔ **The curated set is the answer for a site that CONFIGURED ITS OWN
 * DESTINATION. It is NOT the answer for a site whose host supplies one** — see
 * `resolveEmit`, which is where absence stopped meaning one thing.
 */
const EMIT_PRESETS = {
  minimal: ['page_view'],
  standard: ['page_view', 'outbound_click', 'section_view']
}

/** The preset a site gets by declaring a destination and nothing else. */
const DEFAULT_EMIT = 'standard'

/**
 * The site's own selection, as a list of event names or `null` for no narrowing.
 *
 * ⛔ **An unknown preset name resolves to the DEFAULT, not to nothing.** A typo
 * (`emit: sandard`) must not silently take a site dark: the failure mode of a
 * misread selection has to be "you got the usual set", never "you got none and
 * nothing said so".
 *
 * ## ⭐ ABSENCE MEANS TWO DIFFERENT THINGS, and this is where they part
 *
 * **A site that configured its own `endpoint` chose it.** Writing no `emit`
 * there means *"the curated default"*, and `standard` is exactly right — a
 * later framework release must not grow it behind that operator's back.
 *
 * **A site whose HOST supplies the collector has no endpoint of its own.** The
 * operator's whole relationship is *"my host does analytics for me"*, so
 * writing no `emit` there means **"whatever my host offers"** — not a list
 * frozen at the framework version the site was built against.
 *
 * ⇒ **Absent `emit` defers to the host's declared list when there is one, and
 * falls back to `standard` when there is not.** Returning `null` is how the
 * deferral is expressed: it is *no site-tier narrowing*, so `Tracker.arms()` is
 * left with the host's list as the only gate.
 *
 * ⭐ **Why this is a fix and not a relaxation.** §4 of the tracking design says
 * *"the runtime emits what the SITE OWNER buys"* — and before this, an owner
 * paying a host for analytics received a **framework-frozen subset** of what
 * that host stores and bills them for. The only way to close the gap was to
 * hand-edit YAML and republish, **a dependency with no symptom when forgotten**,
 * which is the precise failure that rule was written to reject.
 *
 * ⛔ **The fallback is NOT decoration — it is the standalone-first guarantee.**
 * A static host, a foreign backend, and any Uniweb backend predating the
 * `events` key all declare no list. Deferring unconditionally would arm *every*
 * event, forever, on exactly the sites the framework exists to serve without a
 * backend.
 *
 * ⚠️ **A host that declares an EMPTY list still means it** — `[]` is a
 * statement, not an absence, and it arms nothing. That is unchanged: `arms()`
 * has always read an empty host list that way. Only `undefined` means "nothing
 * declared".
 *
 * @param {string|string[]|undefined} emit - the site's own `tracking.emit`
 * @param {string[]|null} [hostEvents] - the host's declared list, or `null`
 *        when the host declared none. **Only consulted when `emit` is absent**;
 *        an author who names anything still wins.
 * @returns {string[]|null}
 */
function resolveEmit(emit, hostEvents = null) {
  // ⛔ Absent is the ONLY branch that consults the host — this is a default,
  // never an override. `emit: minimal` on a host offering everything still
  // sends one event.
  if (emit == null) return hostEvents ? null : EMIT_PRESETS[DEFAULT_EMIT]
  if (Array.isArray(emit)) return emit
  if (emit === 'all') return null
  return EMIT_PRESETS[emit] || EMIT_PRESETS[DEFAULT_EMIT]
}

export function wireTracker(uniweb, { basePath = '', loadScripts = null } = {}) {
  const website = uniweb?.activeWebsite
  if (!website) return

  // A plain lookup target: `resolveService` reads `.config` and `.basePath`
  // only, so this is the whole of what it needs and carries the *correct* base.
  const target = { config: website.config, basePath }

  const { url } = resolveService(target, 'tracking')
  const options = readServiceOptions(target, 'tracking')

  // Only whether any were declared — normalizing them is the loader's job, and
  // lives behind the loader's dynamic boundary so a site with none never
  // downloads that code either.
  const declaredScripts = options.scripts
  const hasScripts = Array.isArray(declaredScripts) ? declaredScripts.length > 0 : !!declaredScripts

  // Nothing declared on either count — keep the disabled default, nothing
  // armed, nothing queued. This is the state of the large majority of sites.
  if (!url && !hasScripts) return

  // The two narrowings, resolved here rather than in core: this is per-request
  // config reshaping, which is L2's job (see this file's header).
  //
  // ⛔ **`hostEvents` is read from the HOST tier only** — `config.services
  // .tracking.events`, never the merged view. A site cannot widen what a host
  // declined to store, and reading the merge would let it, silently, by writing
  // its own `events:` key.
  //
  // ⛔ **Absent stays absent.** No `events` from the host means NO NARROWING,
  // never an empty set: a host that sends no list is an older or simpler one,
  // and the other reading takes every site on it dark with every gate saying
  // yes. `?? null` rather than `?? []` is the whole of that guard.
  // ⛔ Each tier is read from ITS OWN key, not from the merged `options`. The
  // merge exists so a site can override a host's `consent` or `endpoint`; these
  // two are not overrides of each other but answers to different questions, and
  // reading either off the merge would let one tier answer the other's — a site
  // writing `events:` would widen past what the host stores, silently.
  const hostTracking = website.config?.services?.tracking
  const siteTracking = website.config?.tracking
  const hostEvents =
    hostTracking && Array.isArray(hostTracking.events) ? hostTracking.events : null

  const tracker = new Tracker({
    endpoint: url,
    hostEvents,
    siteEmit: resolveEmit(siteTracking && siteTracking.emit, hostEvents),
    // ⭐ Read off the MERGED view, unlike the two above — and the difference is
    // the point. `events`/`emit` answer different questions per tier, so each is
    // read from its own key; this is one question with two possible answerers,
    // so the ordinary precedence applies: the host declares a batch window that
    // suits its collector, and a site's own `tracking:` overrides it. Absent on
    // both, `Tracker` keeps its default.
    //
    // ⛔ **A field being READABLE is not the same as it being AVAILABLE**, and
    // that is what made this line worth a test rather than a shrug.
    // `readServiceOptions` has always returned this key, so the plan read as
    // finished while nothing wrote the object being read — it would have shipped
    // as *"we set the interval and it did nothing"*, with all three lanes' suites
    // green. The value now has to reach `setInterval`, and a test asserts the
    // delay rather than the field.
    flushIntervalMs: options.flushIntervalMs,
    // Opt-in, not the default. Declaring a destination is itself the operator's
    // decision to track; requiring a second affirmative step would be the
    // framework presuming a jurisdiction on their behalf, which is exactly what
    // it must not do. A site that needs the gate asks for it.
    consentRequired: options.consent === 'required',
    debug: !!options.debug
  })
  uniweb.tracking = tracker

  if (!loadScripts || !hasScripts) return

  // The same suppression the tracker applies to its own events: a server render
  // or a framed authoring preview is not a visit, and a vendor's script must not
  // fire there either. One predicate in core, so the two cannot drift.
  if (!tracker.isLiveDocument()) return

  const load = () => loadScripts(declaredScripts, { basePath, debug: !!options.debug })
  if (tracker.consentStatus() === 'granted') load()
  else tracker.onGranted = load
}
