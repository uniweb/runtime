/**
 * Vite Plugin: Site Content
 *
 * Collects site content from pages/ directory and injects it into HTML.
 * Watches for changes in development mode.
 *
 * Usage:
 * ```js
 * import { siteContentPlugin } from '@uniweb/runtime/vite'
 *
 * export default defineConfig({
 *   plugins: [
 *     siteContentPlugin({
 *       sitePath: './site',  // Path to site directory
 *       inject: true,        // Inject into HTML
 *     })
 *   ]
 * })
 * ```
 */

import { resolve } from 'node:path'
import { watch } from 'node:fs'
import { collectSiteContent } from './content-collector.js'

/**
 * Create the site content plugin
 */
export function siteContentPlugin(options = {}) {
  const {
    sitePath = './',
    pagesDir = 'pages',
    variableName = '__SITE_CONTENT__',
    inject = true,
    filename = 'site-content.json',
    watch: shouldWatch = true
  } = options

  let siteContent = null
  let resolvedSitePath = null
  let watcher = null
  let server = null

  return {
    name: 'uniweb:site-content',

    configResolved(config) {
      resolvedSitePath = resolve(config.root, sitePath)
    },

    async buildStart() {
      // Collect content at build start
      try {
        siteContent = await collectSiteContent(resolvedSitePath)
        console.log(`[site-content] Collected ${siteContent.pages?.length || 0} pages`)
      } catch (err) {
        console.error('[site-content] Failed to collect content:', err.message)
        siteContent = { config: {}, theme: {}, pages: [] }
      }
    },

    configureServer(devServer) {
      server = devServer

      // Watch for content changes in dev mode
      if (shouldWatch) {
        const watchPath = resolve(resolvedSitePath, pagesDir)

        // Debounce rebuilds
        let rebuildTimeout = null
        const scheduleRebuild = () => {
          if (rebuildTimeout) clearTimeout(rebuildTimeout)
          rebuildTimeout = setTimeout(async () => {
            console.log('[site-content] Content changed, rebuilding...')
            try {
              siteContent = await collectSiteContent(resolvedSitePath)
              console.log(`[site-content] Rebuilt ${siteContent.pages?.length || 0} pages`)

              // Send full reload to client
              server.ws.send({ type: 'full-reload' })
            } catch (err) {
              console.error('[site-content] Rebuild failed:', err.message)
            }
          }, 100)
        }

        try {
          watcher = watch(watchPath, { recursive: true }, scheduleRebuild)
          console.log(`[site-content] Watching ${watchPath}`)
        } catch (err) {
          console.warn('[site-content] Could not watch pages directory:', err.message)
        }
      }

      // Serve content as JSON endpoint
      devServer.middlewares.use((req, res, next) => {
        if (req.url === `/${filename}`) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(siteContent, null, 2))
          return
        }
        next()
      })
    },

    transformIndexHtml(html) {
      if (!inject || !siteContent) return html

      // Inject content as JSON script tag
      const injection = `<script type="application/json" id="${variableName}">${JSON.stringify(siteContent)}</script>\n`

      // Insert before </head>
      return html.replace('</head>', injection + '</head>')
    },

    generateBundle() {
      // Emit content as JSON file in production build
      this.emitFile({
        type: 'asset',
        fileName: filename,
        source: JSON.stringify(siteContent, null, 2)
      })
    },

    closeBundle() {
      // Clean up watcher
      if (watcher) {
        watcher.close()
        watcher = null
      }
    }
  }
}

export default siteContentPlugin
