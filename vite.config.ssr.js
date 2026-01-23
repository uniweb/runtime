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
        '@uniweb/semantic-parser'
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
