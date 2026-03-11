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
 *
 * See: kb/plans/runtime-shell-and-cdn.md
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync, writeFileSync } from 'fs'
// Relative import avoids a cyclic workspace dependency
// (@uniweb/build optionally depends on @uniweb/runtime)
import { importMapPlugin, DEFAULT_EXTERNALS } from '../build/src/import-map-plugin.js'

/**
 * Emit manifest.json after the build completes.
 *
 * The manifest describes the build output so consumers (unicloud, PHP)
 * can generate HTML programmatically without parsing index.html.
 * See: kb/plans/runtime-shell-and-cdn.md (Phase 2)
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
      const importMap = {}
      for (const specifier of DEFAULT_EXTERNALS) {
        const fileName = `_importmap/${specifier.replace(/\//g, '-')}.js`
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
    sourcemap: true,
  },
})
