/**
 * The chunks a host should `<link rel="modulepreload">` — derived, not guessed.
 *
 * `vite.config.app.js` writes this into `dist/app/manifest.json` so a host that
 * generates HTML programmatically emits the same preloads Vite writes into
 * `index.html`. Two producers of one list, so the list must come from the same
 * graph rather than from a shape test that approximates it.
 *
 * ⛔ **The approximation this replaces:** "every non-entry chunk in `assets/`".
 * It cannot tell a chunk the entry always needs from one reached only through a
 * dynamic `import()`, so it over-declared by exactly the modules whose whole
 * design is *a site that does not use this never downloads it* — measured
 * 2026-08-19 on `@uniweb/runtime@0.12.3`, those were `outbound-clicks`,
 * `section-views` and `script-loader`. `index.html` was right the entire time.
 *
 * ⚠️ **Neither side had a symptom.** The site worked, the chunks still appeared
 * split in the bundle listing, and the only evidence was a byte count nobody
 * was watching — which is why the guard is a test rather than a comment.
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
