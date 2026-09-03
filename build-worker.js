#!/usr/bin/env node

/**
 * Build the `ssr-edge` flavor of @uniweb/runtime — the worker-runtime.js SSR
 * isolate bundle plus its three globalThis-bridge shims — into dist/.
 *
 * BUILT AT PUBLISH, BUT NOT SHIPPED BY NPM — and the distinction matters.
 *
 * It is not part of `pnpm build` (which is `build:ssr` + `build:app`), so a
 * local build does not produce it; run `pnpm build:worker` when you want it.
 * `prepublishOnly` DOES run it, but `files` no longer ships the result: the
 * tarball carries `src` plus `dist/ssr.js` and its map, and nothing else.
 *
 * **A consumer reaches this flavor through the distribution channel, not
 * through npm.** Nothing removed from the tarball was ever importable: no
 * `exports` entry reaches this bundle or the browser shell, and they sat there
 * only because the channel job used to read them from a packed tarball —
 * 2.35 MB unpacked became 347 KB, measured on `0.11.1`.
 *
 * ⛔ **`prepublishOnly` is not a pre-flight — it is the PRODUCER.** This block
 * said "the channel workflow builds it from the tag" until 2026-09-03, and was
 * already four days stale when it was written: `ad9f91e` (2026-08-12, "CI no
 * longer builds the tag") deleted that job, and `.github/workflows/audit-channel.yml`
 * now installs nothing and builds nothing. `scripts/release-channel.mjs` publishes
 * the channel from the machine that built it and READS `dist/` — it never rebuilds
 * (`publish-channel.mjs` refuses with "run `pnpm build && pnpm build:worker`" when
 * the bytes are absent). ⇒ **The bytes this script writes ARE the published
 * isolate.** Skipping it does not forfeit a pre-flight; it forfeits the artifact.
 *
 * Falsification, one command — CI builds this, or it does not:
 *   command grep -c 'build:worker' .github/workflows/audit-channel.yml   # 0
 *
 * ⚠️ **Both directions of this claim have been wrong within one week.** Until
 * 2026-08-08 this header said the flavor was not in the tarball while
 * `prepublishOnly` had been putting it there since 2026-08-04; that was
 * corrected, and the correction went stale two commits later when `files`
 * changed. ⇒ **Do not trust this paragraph for what ships.** Read `files` in
 * package.json, or run `npm pack --dry-run`.
 *
 * ⛔ Do not write a sourcemap-exclusion glob in this block comment. The
 * asterisk-then-slash sequence inside such a glob terminates the comment, the
 * remaining prose parses as code, and this file dies with a SyntaxError — which
 * broke a publish on 2026-08-08, because `prepublishOnly` runs it.
 * `tests/build-worker.test.js` now fails on it; use a line comment if you need
 * the literal.
 *
 * Run it: `pnpm build:worker` (after `pnpm build:ssr`, which emits dist/ssr.js).
 *
 * Produces (consumed by a serverless JS isolate that has no package resolution
 * and must run a single React instance — an SSR/edge worker):
 *   dist/worker-runtime.js         React + react-dom + jsx-runtime + @uniweb/core
 *                                  + react-dom/server + the SSR pipeline ALL
 *                                  inlined; writes its instances onto
 *                                  globalThis.__PLATFORM_* at module-eval time.
 *   dist/shims/react.js            modules-map shim re-exporting React's surface
 *                                  from globalThis.__PLATFORM_REACT.
 *   dist/shims/react-dom.js        same idea for react-dom (e.g. createPortal).
 *   dist/shims/react-jsx-runtime.js   same idea for react/jsx-runtime.
 *   dist/shims/uniweb-core.js      same idea for @uniweb/core.
 *
 * The shim set is the foundation-facing subset of @uniweb/build's
 * DEFAULT_EXTERNALS (see the BRIDGES table below) — it must bridge whatever a
 * foundation may import, matching what the SPA import map bridges.
 *
 * This is a build-LINKAGE choice for the isolate environment (everything inlined,
 * one React), the peer of ssr-node's externalized linkage — not deployment code:
 * there are no host / CDN / account references here; uploading and serving the
 * artifact is a separate concern owned by whoever hosts it.
 */

import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The bridge set: every specifier a FOUNDATION may import that must resolve to
 * the isolate's single shared instance.
 *
 * This is the foundation-facing subset of `@uniweb/build`'s `DEFAULT_EXTERNALS`,
 * and it must stay in lockstep with it: whatever the SPA import map bridges, the
 * SSR isolate shims must bridge too, or a foundation resolves the same import to
 * two React instances — which breaks hooks at runtime with no build-time signal.
 *
 * Two deliberate exclusions, both of which a naive "keep them identical" check
 * would get wrong: `react-dom/server` is runtime-internal (worker-runtime owns
 * `renderToString`) and never a foundation import, and `react/jsx-dev-runtime`
 * only appears in dev builds. To add a future shared package, add one row here.
 *
 * EXPORTED so the relationship can be asserted rather than promised in prose —
 * `tests/build-worker.test.js` pins it against `DEFAULT_EXTERNALS`, including
 * the two exclusions. It was a comment for months, and a comment is what the
 * publish-breaking edit in this same header proved insufficient.
 */
export const BRIDGES = [
  { spec: 'react', global: '__PLATFORM_REACT', shim: 'shims/react.js' },
  { spec: 'react-dom', global: '__PLATFORM_REACT_DOM', shim: 'shims/react-dom.js' },
  { spec: 'react/jsx-runtime', global: '__PLATFORM_JSX_RUNTIME', shim: 'shims/react-jsx-runtime.js' },
  { spec: '@uniweb/core', global: '__PLATFORM_UNIWEB_CORE', shim: 'shims/uniweb-core.js' },
]

/** Specifiers in DEFAULT_EXTERNALS that the isolate deliberately does NOT bridge. */
export const BRIDGE_EXCLUSIONS = ['react-dom/server', 'react/jsx-dev-runtime']

/**
 * Bundle dist/ssr.js into the ssr-edge artifact set.
 *
 * Why globalThis instead of inter-module imports? The isolate's module loader
 * resolves bare specifiers RELATIVE TO THE IMPORTING MODULE'S PACKAGE CONTEXT —
 * from inside the `react/jsx-runtime` shim, `import 'worker-runtime'` would be
 * looked up as `react/worker-runtime`. globalThis sidesteps that entirely.
 *
 * Why inline React (not externalize)? `react-dom/server` is CJS and internally
 * does `require('react')`. With React externalized via the modules map, esbuild
 * emits a runtime "Dynamic require not supported" error. React must live in one
 * self-contained bundle (worker-runtime.js) alongside react-dom/server.
 *
 * @param {string} runtimeDir - the @uniweb/runtime package dir (has dist/ssr.js).
 * @returns {Promise<{ workerRuntime: string, shims: Record<string, string> }>}
 *   workerRuntime = absolute path to dist/worker-runtime.js; shims keyed by their
 *   dist-relative path (`shims/react.js`, …) → the generated code.
 */
export async function buildWorkerRuntime(runtimeDir) {
  const { build: esbuild, stop: esbuildStop } = await import('esbuild')

  const ssrEntry = join(runtimeDir, 'dist', 'ssr.js')
  if (!existsSync(ssrEntry)) {
    throw new Error('dist/ssr.js not found — run `pnpm build:ssr` first')
  }

  // Resolve React/ReactDOM/core to absolute paths so esbuild's prefix-match
  // externalization doesn't stumble over `react-dom/server.browser`.
  const runtimeRequire = createRequire(join(runtimeDir, 'package.json'))
  const reactDir = dirname(runtimeRequire.resolve('react/package.json'))
  const reactDomDir = dirname(runtimeRequire.resolve('react-dom/package.json'))
  const reactDomServerBrowser = join(reactDomDir, 'server.browser.js')

  const alias = {
    react: reactDir,
    'react-dom': reactDomDir,
    'react-dom/server': reactDomServerBrowser,
  }

  // Walk node_modules upward from runtimeDir for esbuild's nodePaths.
  const nodePaths = []
  let dir = runtimeDir
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules')
    if (existsSync(candidate)) nodePaths.push(candidate)
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  const distDir = join(runtimeDir, 'dist')
  const shimsDir = join(distDir, 'shims')
  if (!existsSync(shimsDir)) mkdirSync(shimsDir, { recursive: true })

  // Wrapper entry: set the globalThis bridges, then re-export the SSR pipeline.
  // esbuild bundles this with everything inlined (external: []).
  const wrapperPath = join(distDir, 'worker-runtime-entry.js')
  writeFileSync(
    wrapperPath,
    [
      '// AUTO-GENERATED by build-worker.js — do not edit',
      ...BRIDGES.map((b, i) => `import * as __P${i} from '${b.spec}'`),
      ...BRIDGES.map((b, i) => `globalThis.${b.global} = __P${i}`),
      "export * from './ssr.js'",
      '',
    ].join('\n')
  )

  const outfile = join(distDir, 'worker-runtime.js')
  await esbuild({
    entryPoints: [wrapperPath],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    external: [],
    outfile,
    minify: false,
    nodePaths,
    alias,
    conditions: ['browser', 'module'],
    logLevel: 'warning',
  })
  try {
    await esbuildStop?.()
  } catch {
    // esbuild's service teardown is best-effort
  }

  // Enumerate each package's real export names so the shims re-export each name
  // explicitly. Static `export *` doesn't propagate names from CJS-interop'd
  // packages reliably, so we list them — and the list stays in sync with whatever
  // React / @uniweb/core version is shipped.
  async function namesOf(spec) {
    const m = await import(runtimeRequire.resolve(spec))
    return Object.keys(m).filter((k) => k !== 'module.exports')
  }

  function shim(globalThisKey, names) {
    return [
      `// AUTO-GENERATED — modules-map shim re-exporting from globalThis.${globalThisKey}.`,
      '// worker-runtime.js sets the bridge at module-eval time.',
      `const __ns = globalThis.${globalThisKey}`,
      'export default __ns?.default ?? __ns',
      ...names.filter((n) => n !== 'default').map((n) => `export const ${n} = __ns.${n}`),
      '',
    ].join('\n')
  }

  const shimsByPath = {}
  for (const b of BRIDGES) {
    shimsByPath[b.shim] = shim(b.global, await namesOf(b.spec))
  }
  for (const [rel, code] of Object.entries(shimsByPath)) {
    writeFileSync(join(distDir, rel), code)
  }

  return { workerRuntime: outfile, shims: shimsByPath }
}

// CLI entry — the `build:worker` package script. Builds into this package's dist/.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const runtimeDir = dirname(fileURLToPath(import.meta.url))
  const kb = (p) => (statSync(p).size / 1024).toFixed(1)
  buildWorkerRuntime(runtimeDir)
    .then(({ workerRuntime, shims }) => {
      console.log(`✓ dist/worker-runtime.js (${kb(workerRuntime)} KB)`)
      for (const rel of Object.keys(shims)) {
        console.log(`✓ dist/${rel} (${kb(join(runtimeDir, 'dist', rel))} KB)`)
      }
    })
    .catch((err) => {
      console.error(`✗ build:worker failed: ${err.message}`)
      process.exit(1)
    })
}
