/**
 * Vite Configuration for SSR Bundle
 *
 * Builds a Node.js-compatible version of the runtime for use in prerender.js.
 * This bundle can be imported directly by Node.js without Vite transpilation.
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

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
      external: [
        'react',
        'react-dom',
        'react-dom/server',
        'react-router-dom',
        '@uniweb/core',
        // Rollup's external matcher is exact-string, so the bare entry above
        // does NOT cover a subpath — the same trap `react-dom/server` sits in
        // two lines up. Without this the leaf module is silently bundled in,
        // and the SSR twin renders section ids from a frozen copy while the
        // SPA uses the live one.
        '@uniweb/core/section-id',
        '@uniweb/semantic-parser',
        '@uniweb/theming'
      ],
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
