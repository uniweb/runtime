/**
 * The shell's chunks name no file by a path on the page's origin.
 *
 * The shell is served from an address of its own, never the page's. A chunk reaches another by a
 * relative `import("./x.js")`, which follows it wherever it is served, while a literal `assets/x.js`
 * is resolved against the page. Vite's preload lists were that: 14 requests that 404 on a first load
 * (`vite.config.app.js`). Nothing broke, since each file then loaded from the right place, so no test
 * that renders a page could see them.
 *
 * It reads the built code, and so the outcome rather than the name Vite gives its helper.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { build, loadConfigFromFile, mergeConfig } from 'vite'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

describe('the shell build', () => {
  let outDir
  let chunks
  let indexHtml
  let manifest

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'uniweb-shell-'))
    const { config } = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      join(here, '..', 'vite.config.app.js')
    )
    await build(
      mergeConfig(config, {
        configFile: false,
        logLevel: 'silent',
        build: { outDir, emptyOutDir: true, sourcemap: false },
      })
    )
    chunks = Object.fromEntries(
      readdirSync(join(outDir, 'assets'))
        .filter((f) => f.endsWith('.js'))
        .map((f) => [f, readFileSync(join(outDir, 'assets', f), 'utf8')])
    )
    indexHtml = readFileSync(join(outDir, 'index.html'), 'utf8')
    manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'))
  }, 120_000)

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true })
  })

  it('names no file by its assets path in any chunk', () => {
    const named = Object.entries(chunks).flatMap(([file, code]) =>
      [...code.matchAll(/["'`]\/?assets\/[^"'`]+["'`]/g)].map((m) => `${file}: ${m[0]}`)
    )
    expect(named).toEqual([])
  })

  it('still reaches its lazy chunks, relative to itself', () => {
    // The control: a build with no dynamic imports would pass the test above with nothing to find.
    const code = Object.values(chunks).join('\n')
    expect(code).toMatch(/import\("\.\/link-intent-[^"]+\.js"\)/)
    expect(code).toMatch(/import\("\.\/document-tracking-[^"]+\.js"\)/)
  })

  it('leaves what a host preloads alone: the manifest names the entry and its closure', () => {
    expect(manifest.entry).toMatch(/^assets\/index-.+\.js$/)
    expect(manifest.preloads.length).toBeGreaterThan(0)
    for (const file of manifest.preloads) expect(chunks[file.replace(/^assets\//, '')]).toBeDefined()
    // Nothing a lazy chunk is for: a site that does not use one never downloads it.
    expect(manifest.preloads.filter((f) => /link-intent|document-tracking|section-views/.test(f))).toEqual([])
  })

  it('leaves index.html its own preload hints', () => {
    expect(indexHtml).toMatch(/rel="modulepreload"/)
  })
})
