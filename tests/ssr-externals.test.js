/**
 * The SSR bundle must not inline `@uniweb/core`, including its subpaths.
 *
 * ⛔ The failure this guards is SILENT and produces no import to grep for.
 * Rollup's string matcher is exact, so a `'@uniweb/core'` entry leaves
 * `@uniweb/core/datastore` to be bundled in. The output then holds a FROZEN copy
 * of that leaf next to the live one the bare specifier still imports, and the two
 * drift apart the next time core changes — no build error, no runtime throw, just
 * two functions that used to be one.
 *
 * Measured on 2026-09-03, before the fix: `dist/ssr.js` defined `deriveCacheKey`
 * locally at :986 and imported the real one as `deriveCacheKey$1` at :1, so
 * `hydrateDataStore` keyed the datastore with the live copy (:302) while
 * `resolvePageFetchConfigs` de-duplicated with the frozen one (:1303).
 * `dist/worker-runtime.js` carried two copies each of `deriveCacheKey`,
 * `resolveFetchConfigs` and `routePatternToRegex`.
 *
 * ⭐ These tests RUN the config's own matchers rather than restating the list.
 * A second list of subpaths would be the same drift with one more place to
 * forget. And a guard that merely ASSERTS a relationship reads exactly like one
 * that checks it: this repo has shipped a check whose message named an agreement
 * it never actually compared, and it passed a full suite while doing so.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { EXTERNAL } from '../vite.config.ssr.js'

const here = dirname(fileURLToPath(import.meta.url))
const require_ = createRequire(import.meta.url)

/** The config's real decision for one specifier. */
const isExternal = (spec) => EXTERNAL.some((re) => re.test(spec))

/**
 * Every subpath `@uniweb/core` actually publishes, read from its own package.json.
 *
 * Resolved by WALKING UP from a listed entry point to the nearest package.json
 * that names the package — not by `require.resolve('@uniweb/core/package.json')`,
 * which an `exports` map without a `./package.json` entry refuses (it does not
 * have one), and not by counting `..` from a path whose depth is core's business.
 */
function corePackageJson() {
  let dir = dirname(require_.resolve('@uniweb/core'))
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8'))
      if (pkg.name === '@uniweb/core') return pkg
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('could not locate @uniweb/core package.json from its resolved entry')
}

function coreSpecifiers() {
  const { exports: map } = corePackageJson()
  return Object.keys(map).map((k) => (k === '.' ? '@uniweb/core' : `@uniweb/core${k.slice(1)}`))
}

describe('every @uniweb/core entry point is external to the SSR bundle', () => {
  it('covers the package and each subpath it exports', () => {
    const inlined = coreSpecifiers().filter((s) => !isExternal(s))
    expect(
      inlined,
      `these @uniweb/core entry points would be INLINED as frozen copies:\n` +
        inlined.map((s) => `  ${s}`).join('\n')
    ).toEqual([])
  })

  it('covers a subpath that does not exist yet', () => {
    // The point of a regex over a list: the guard must hold for the import
    // somebody adds next week, not only for today's exports map.
    expect(isExternal('@uniweb/core/not-invented-yet')).toBe(true)
  })
})

describe('every bare import in src/ is either external or deliberately bundled', () => {
  // Catches the same class one step earlier: a NEW package (not just a new
  // subpath) reaching the SSR graph without an entry here.
  const BUNDLED_ON_PURPOSE = []

  it('has no unlisted third-party import', () => {
    const files = readFileSync(join(here, '..', 'dist', 'ssr.js'), 'utf8')
    const specs = [...files.matchAll(/^import\s[^'"]*from\s+["']([^."'][^'"]*)["']/gm)].map((m) => m[1])
    const unlisted = [...new Set(specs)].filter((s) => !isExternal(s) && !BUNDLED_ON_PURPOSE.includes(s))
    expect(
      unlisted,
      `dist/ssr.js imports these, but EXTERNAL does not match them — they are ` +
        `external by accident, not by decision:\n` + unlisted.map((s) => `  ${s}`).join('\n')
    ).toEqual([])
  })
})

describe('the anchors do what the comment claims', () => {
  it('react does not swallow react-dom or react-router-dom', () => {
    // `/^react(\/.*)?$/` must not match a package whose name merely starts with
    // "react" — the reason the pattern is anchored on a slash.
    const reactOnly = EXTERNAL.find((re) => re.source.startsWith('^react('))
    expect(reactOnly.test('react')).toBe(true)
    expect(reactOnly.test('react/jsx-runtime')).toBe(true)
    expect(reactOnly.test('react-dom')).toBe(false)
    expect(reactOnly.test('react-router-dom')).toBe(false)
  })

  it('CONTROL — an unrelated package is not externalized', () => {
    // Otherwise a matcher that is too loose passes every test above by matching
    // everything, which is the failure mode of a guard written in a hurry.
    expect(isExternal('lodash')).toBe(false)
    expect(isExternal('@uniweb/kit')).toBe(false)
    expect(isExternal('@uniweb/core-extras')).toBe(false)
  })
})
