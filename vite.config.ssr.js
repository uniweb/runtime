/**
 * Vite Configuration for SSR Bundle
 *
 * Builds a Node.js-compatible version of the runtime for use in prerender.js.
 * This bundle can be imported directly by Node.js without Vite transpilation.
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

/**
 * Every package this bundle must NOT inline, as REGEXES matching the package
 * AND all of its subpaths.
 *
 * ⛔ Strings are wrong here, and were wrong twice. Rollup's string matcher is
 * EXACT, so `'@uniweb/core'` does not cover `@uniweb/core/datastore`: the leaf
 * is bundled in silently, and the bundle then runs a FROZEN copy of core beside
 * the live one it imports by bare specifier. Nothing fails — there is no build
 * error, and no import left in the output to grep for. The two copies simply
 * stop being the same function whenever core moves.
 *
 * The instance was patched twice before the class was:
 *   2026-07  `@uniweb/core/section-id` pinned as a string, after the SSR twin
 *            rendered section ids from a frozen copy while the SPA used the live
 *            one. That fixed the one subpath anyone had noticed.
 *   2026-09  `prefetch.js` imported four more (`fetch-config`, `datastore`,
 *            `route-match`, `locale-config`), so `dist/worker-runtime.js` shipped
 *            TWO copies each of `deriveCacheKey`, `resolveFetchConfigs` and
 *            `routePatternToRegex` — `hydrateDataStore` keying the datastore with
 *            the live `deriveCacheKey` (dist/ssr.js:302) while
 *            `resolvePageFetchConfigs` de-duplicated with the frozen one (:1303).
 *            `@uniweb/core/route-match` had already been frozen this way by
 *            `ssr-renderer.js` — and that one is a cross-boundary contract: a
 *            host decides which page a path names and the runtime hydrates over
 *            that decision, so the matcher has to exist exactly once.
 *
 * A regex closes the class: a subpath added tomorrow is external without anyone
 * remembering this file exists. `tests/ssr-externals.test.js` runs THESE matchers
 * against `@uniweb/core`'s real `exports` map rather than restating the list —
 * a second list would just be the same drift with an extra place to forget.
 *
 * `(\/.*)?$` is anchored, so `/^react(\/.*)?$/` covers `react/jsx-runtime` and
 * does not swallow `react-dom`.
 */
export const EXTERNAL = [
  /^react(\/.*)?$/,
  /^react-dom(\/.*)?$/,
  /^react-router-dom(\/.*)?$/,
  /^@uniweb\/core(\/.*)?$/,
  /^@uniweb\/semantic-parser(\/.*)?$/,
  /^@uniweb\/theming(\/.*)?$/,
]

export default defineConfig({
  plugins: [react()],

  build: {
    // SSR mode - outputs Node.js-compatible code
    ssr: true,

    // Library configuration
    lib: {
      entry: resolve(__dirname, 'src/ssr.js'),
      formats: ['es'],
      fileName: () => 'ssr.js'
    },

    // Output directory
    outDir: 'dist',

    // Don't empty the output directory (in case other builds exist)
    emptyOutDir: false,

    // Externalize dependencies - they'll be resolved at runtime
    rollupOptions: {
      external: EXTERNAL,
      output: {
        // Preserve module structure for better debugging
        preserveModules: false,
        // Use ESM format
        format: 'es'
      }
    },

    // Generate source maps for debugging
    sourcemap: true,

    // Don't minify for better debugging
    minify: false
  },

  // Resolve aliases
  resolve: {
    alias: {
      // Ensure consistent React resolution
    }
  }
})
