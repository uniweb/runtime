/**
 * The chunks a host should `<link rel="modulepreload">` — derived, not guessed.
 *
 * `vite.config.app.js` writes this into `dist/app/manifest.json` so a host that
 * generates HTML programmatically has an answer without parsing `index.html`.
 *
 * ⛔ **The approximation this replaces:** "every non-entry chunk in `assets/`".
 * It cannot tell a chunk the entry always needs from one reached only through a
 * dynamic `import()`, so it over-declared by exactly the modules whose whole
 * design is *a site that does not use this never downloads it* — measured
 * 2026-08-19 on `@uniweb/runtime@0.12.3`, those were `document-tracking`,
 * `section-views` and `script-loader`. Neither side had a symptom: the site
 * worked, the chunks still appeared split, and the only evidence was a byte
 * count nobody was watching.
 *
 * ## ⛔ `index.html` IS NOT THE TARGET — do not "fix" this to match it
 *
 * The first version of this file said the goal was to emit the same preloads
 * Vite writes into `index.html`. **That is wrong, and acting on it would
 * pessimise every host-generated shell.** Measured the same day, `index.html`
 * preloads all 13 `_importmap/` bridge modules — **73 KB gzipped**, of which
 * `react-dom/server` alone is **57.8 KB**. A browser SPA never executes React's
 * server renderer; that bridge exists because foundations using `@uniweb/press`
 * import it, which is a property of a foundation and unknowable from here.
 *
 * ⭐ **So the manifest and `index.html` legitimately differ, and the manifest is
 * the more correct of the two.** Vite preloads emitted entry files because that
 * is what Vite does with them, not because a shell needs them before first
 * paint.
 *
 * ⇒ **The rule is "what must be loaded before anything can run" — the entry's
 * transitive STATIC closure — not "what some other producer happens to emit".**
 * A bridge is fetched when the foundation resolves its bare specifiers, which
 * is after the entry has run; whether that is worth a preload hint is a
 * separate question with a separate answer, and it is not this field.
 *
 * ## ⛔ Bridges do not belong in this field — ASKED AND ANSWERED, 2026-08-19
 *
 * The answer is not "not yet"; it is **no, and there is a better mechanism**.
 * Do not add a `bridgePreloads` key here, and do not widen `prefix` to sweep
 * `_importmap/` in.
 *
 * `modulepreload` fetches a module **and its dependency graph**. A foundation's
 * bare imports resolve through the import map, so one `modulepreload` on the
 * foundation entry pulls exactly the bridges *that foundation* uses and nothing
 * else — the real graph, per site, walked by the browser. Anything this build
 * could publish is a static guess: one global list answering a per-site
 * question, plus a second key to keep in step with `importMap`.
 *
 * The measurement that makes the difference concrete: all 13 bridges are
 * 73,329 B gzip, of which `react-dom/server` is 57,782 B; the three a real
 * foundation actually imports (`@uniweb/core`, `react`, `react/jsx-runtime`)
 * are 2,329 B. Three built foundations — a starter, an extensions project's
 * primary foundation, and an extension — each emitted exactly those three. That
 * is a mechanism rather than three lucky samples: `@uniweb/kit` is bundled into
 * every foundation and imports the first two, and the automatic JSX transform
 * injects the third.
 *
 * ⚠️ **Getting this wrong is not repairable in place.** This manifest ships
 * inside a version's directory in the distribution channel, and a published
 * version is immutable — so whatever `preloads` says when a version is stocked
 * is what that version says forever. A host on that version cannot be sent a
 * correction; only a new version can.
 *
 * @module @uniweb/runtime/scripts/entry-preloads
 */

/**
 * The entry's transitive STATIC import closure, minus the entry itself.
 *
 * @param {Record<string, {imports?: string[]}>} bundle - Rollup's output bundle
 * @param {string} entryFileName
 * @param {string} [prefix='assets/'] - keep the manifest's existing shape;
 *        `_importmap/` bridges are reported under `importMap`, not here
 * @returns {string[]}
 */
export function entryPreloads(bundle, entryFileName, prefix = 'assets/') {
  const seen = new Set()

  const walk = (fileName) => {
    if (seen.has(fileName)) return
    seen.add(fileName)
    // `.imports` is STATIC imports only. `.dynamicImports` is deliberately NOT
    // followed — that omission is the whole point of this module.
    for (const next of bundle[fileName]?.imports || []) walk(next)
  }
  walk(entryFileName)

  return [...seen].filter((f) => f !== entryFileName && f.startsWith(prefix))
}

export default entryPreloads
