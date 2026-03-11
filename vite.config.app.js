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
// Relative import avoids a cyclic workspace dependency
// (@uniweb/build optionally depends on @uniweb/runtime)
import { importMapPlugin } from '../build/src/import-map-plugin.js'

export default defineConfig({
  // Root set to shell directory so index.html lands at dist/app/index.html
  // (not dist/app/src/shell/index.html)
  root: resolve(__dirname, 'src/shell'),

  plugins: [
    react(),
    importMapPlugin({
      name: 'runtime-shell:import-map',
    }),
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
