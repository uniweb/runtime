/**
 * Vite Configuration for Runtime Shell (Browser App)
 *
 * Builds a standalone browser app that boots a Uniweb site from __DATA__
 * injected by a dynamic backend (unicloud, PHP, etc.).
 *
 * Produces:
 *   dist/app/
 *   ├── index.html
 *   ├── assets/          (runtime JS chunks)
 *   └── _importmap/      (bridge modules for foundation externals)
 *
 * The import map modules re-export from the bundled copies of React,
 * react-dom, and @uniweb/core — so foundations loaded via dynamic import()
 * share the same instances as the runtime.
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { importMapPlugin, DEFAULT_EXTERNALS, bridgeFileName } from '@uniweb/build/import-map-plugin'

/**
 * Bridges this build adds ON TOP of the foundation-facing default set.
 *
 * These exist for a host that renders Uniweb content ITSELF rather than just
 * booting the shell — e.g. a live-preview host that drives the runtime through
 * its own React tree. Such a host should import the runtime's library surface
 * from the version the site actually uses, not bundle a second copy: a bundled
 * copy silently drifts a version away from the site it is rendering.
 *
 * ⛔ These are deliberately NOT in `DEFAULT_EXTERNALS`. That list is the
 * FOUNDATION-facing contract — what every foundation and site build
 * externalizes — and foundations import none of these. Widening it would
 * change what every foundation links against to serve one host.
 *
 * Router and theming are here for INSTANCE identity, not convenience: the
 * host's `MemoryRouter`/`useNavigate` must be the same module instance as the
 * runtime's internal `Routes` (two router copies = context that silently
 * reads empty), and a second `@uniweb/theming` copy means live theme edits
 * compute tokens with a `buildTheme` that can drift from the one that
 * rendered the page.
 *
 * `hasDefault` is declared where the module cannot be enumerated by importing
 * it in Node — see the `External` typedef in the plugin. `/provider`'s entire
 * surface IS its default export, and getting that wrong is silent.
 */
const HOST_BRIDGES = [
  { spec: '@uniweb/runtime/provider', hasDefault: true },   // RuntimeProvider
  { spec: '@uniweb/runtime/setup', hasDefault: false },     // initUniweb, decodeData, …
  '@uniweb/runtime/foundation-loader',                      // loadFoundation, loadExtensions
  '@uniweb/runtime/default-fetcher',                        // createDefaultFetcher

  // ⛔ NAMED, not wholesale — this one line is worth 106 KB on every site.
  //
  // A bridge re-exports whatever it names, so `export *` on this package
  // retains react-router's DATA-router runtime (createBrowserRouter,
  // RouterProvider, Form, Await, HydratedRouter…) that the runtime never
  // uses — and because the shell's entry shares the chunk, the entry's own
  // closure absorbs it. Measured on this build, entry closure:
  //
  //     baseline (no host bridges)  441 KB
  //     + this list                 449 KB   (+8)
  //     + `react-router-dom` bare   555 KB   (+114)
  //
  // Everything below is the DECLARATIVE surface, which is nearly free. Adding
  // a data-router export here would re-introduce the whole 106 KB — measure
  // the entry closure before extending it, don't assume the next one is free.
  {
    spec: 'react-router-dom',
    named: [
      'MemoryRouter', 'BrowserRouter', 'HashRouter', 'Routes', 'Route',
      'Link', 'NavLink', 'Navigate', 'Outlet',
      'useNavigate', 'useLocation', 'useParams', 'useSearchParams',
      'useMatch', 'useResolvedPath', 'useHref', 'useInRouterContext',
    ],
  },

  '@uniweb/theming',

  // The reconciler. React 19 keeps `createRoot`/`hydrateRoot` on this subpath,
  // and `react-dom` (main) does NOT cover it — Rollup's external matcher is
  // exact-string, the same trap `react-dom/server` sits in.
  //
  // Bridged for the PAIRING INVARIANT: React requires the reconciler and
  // `react` to be version-matched. A host bundling its own `react-dom/client`
  // pairs the channel's `react` with a build-pinned reconciler — fine while
  // they agree, and wrong precisely when a host renders an OLDER runtime
  // version, which is the case the versioned lane exists for. Bridging makes
  // them channel-matched by construction.
  //
  // Free, measured: the shell's own entry already imports `createRoot`
  // (`src/index.jsx`), so the reconciler chunk is in the entry closure either
  // way. Bridging adds an export surface, not bytes — entry closure 449 KB
  // both with and without. Verified one instance: the entry and the bridge
  // both reach the same reconciler chunk.
  'react-dom/client',
]

const APP_EXTERNALS = [...DEFAULT_EXTERNALS, ...HOST_BRIDGES]

/**
 * Emit manifest.json after the build completes.
 *
 * The manifest describes the build output so consumers (unicloud, PHP)
 * can generate HTML programmatically without parsing index.html.
 */
function manifestPlugin() {
  return {
    name: 'runtime-shell:manifest',
    writeBundle(options, bundle) {
      const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

      // Entry: the shell's main chunk (in assets/, not _importmap/ bridge modules
      // which are also marked isEntry by the import map plugin's emitFile)
      const entryChunk = Object.values(bundle)
        .find(c => c.type === 'chunk' && c.isEntry && c.fileName.startsWith('assets/'))

      // Preloadable chunks: non-entry JS in assets/ (Vite already adds these
      // as <link rel="modulepreload"> in index.html — the manifest lists them
      // so programmatic HTML generation can do the same)
      const preloads = Object.values(bundle)
        .filter(c => c.type === 'chunk' && !c.isEntry && c.fileName.startsWith('assets/'))
        .map(c => c.fileName)

      // Import map: bare specifier → relative path to bridge module
      // Same list and same naming helper the plugin emits with — a manifest
      // that names a bridge the build did not emit is a 404 at import time,
      // and nothing before the browser would catch it.
      const importMap = {}
      for (const external of APP_EXTERNALS) {
        const specifier = typeof external === 'string' ? external : external.spec
        const fileName = `_importmap/${bridgeFileName(specifier)}`
        if (bundle[fileName]) {
          importMap[specifier] = fileName
        }
      }

      const manifest = {
        version: pkg.version,
        entry: entryChunk.fileName,
        preloads,
        importMap,
      }

      writeFileSync(
        resolve(options.dir, 'manifest.json'),
        JSON.stringify(manifest, null, 2) + '\n'
      )
    },
  }
}

export default defineConfig({
  // Root set to shell directory so index.html lands at dist/app/index.html
  // (not dist/app/src/shell/index.html)
  root: resolve(__dirname, 'src/shell'),

  plugins: [
    react(),
    importMapPlugin({
      name: 'runtime-shell:import-map',
      externals: APP_EXTERNALS,
    }),
    manifestPlugin(),
  ],

  resolve: {
    // Ensure single instances across workspace packages
    dedupe: ['react', 'react-dom', 'react-router-dom', '@uniweb/core'],
  },

  build: {
    outDir: resolve(__dirname, 'dist/app'),
    emptyOutDir: true,
    // 'hidden' emits the maps but omits the `//# sourceMappingURL=` comment.
    //
    // These maps are dev-only and every delivery path drops them — the npm
    // tarball (`files: !dist/app/**/*.map`), `uniweb runtime register`, the
    // seed, and the distribution channel. With `sourcemap: true` the shipped
    // JS still POINTS at maps that are not there, so every one of those paths
    // ships a dangling reference; the one path that happened to carry the maps
    // was also publishing 7 files of embedded original source into a public
    // bucket.
    //
    // 'hidden' is the only setting that is correct on all of them at once:
    // maps exist locally for debugging, nothing references them, and dropping
    // them leaves nothing dangling. (`dist/ssr.js` keeps its map and its
    // reference — it ships as a module, and the pair travels together.)
    sourcemap: 'hidden',
  },
})
