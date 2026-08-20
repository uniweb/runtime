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
 * ⭐ **Whether a bridge deserves its own hint is a live proposal, not a gap.**
 * Measured across three built foundations: each emitted exactly three bridges
 * (`@uniweb/core`, `react`, `react/jsx-runtime`, ~2.3 KB gzip) where the shell's
 * `index.html` preloads all thirteen at ~73 KB — of which `react-dom/server`
 * alone is 57.8 KB the browser never executes. So copying the shell's preload
 * list into this field would be a pessimisation, not a fix.
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
