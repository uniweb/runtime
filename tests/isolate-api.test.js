/**
 * The isolate API is pinned HERE, because framework is the lane that can break it.
 *
 * A host renders in an isolate against the site's pinned runtime, loaded as an
 * artifact — it cannot import our names, so it feature-detects, and a renamed or
 * dropped export is indistinguishable from an old runtime: it falls back forever,
 * serving pages with no error and no log (hosting's own note on the coupling,
 * framework-surface.json `undeclarable`). Backend holds the floor as a constant.
 * Neither can see a symbol. This suite can.
 *
 * Three things it asserts, and forgetting any of them fails in this repo:
 *   1. every name `ISOLATE_API` promises is exported by `src/ssr.js` — a rename or a
 *      removal fails here before it ships;
 *   2. every export of `src/ssr.js` is stamped with the version it first shipped in
 *      — a new export cannot ride out without a floor entry, which is how the copy
 *      backend holds would silently fall behind (open-work I3a-iv);
 *   3. the built artifact `dist/ssr.js`, when present, exports the same set — the
 *      isolate loads the build, not the source.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ISOLATE_API, ISOLATE_API_FLOOR, compareVersions } from '../src/isolate-api.js'
import * as ssr from '../src/ssr.js'

const promised = Object.keys(ISOLATE_API).sort()
const exported = Object.keys(ssr).sort()

describe('the isolate API — what @uniweb/runtime/ssr promises a host', () => {
  it('every promised name is exported by src/ssr.js — a rename or removal fails here first', () => {
    const missing = promised.filter((name) => !(name in ssr))
    expect(missing, `renamed or dropped from src/ssr.js: ${missing.join(', ')} — a host feature-detecting this name falls back forever`).toEqual([])
  })

  it('every export of src/ssr.js is stamped with the version it first shipped in', () => {
    const unstamped = exported.filter((name) => !(name in ISOLATE_API))
    expect(unstamped, `add to ISOLATE_API with its first published version (git tag --contains): ${unstamped.join(', ')}`).toEqual([])
  })

  it('each stamp is a version, and the package is at or above every one of them', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
    for (const [name, since] of Object.entries(ISOLATE_API)) {
      expect(since, name).toMatch(/^\d+\.\d+\.\d+$/)
      expect(compareVersions(pkg.version, since), `${name} claims to ship since ${since}, later than this package (${pkg.version})`).toBeGreaterThanOrEqual(0)
    }
  })

  it('the floor is the newest stamp — 0.14.2, the composed render entry — and a version the channel index can carry', () => {
    expect(ISOLATE_API_FLOOR).toBe('0.14.2')
    expect(ISOLATE_API_FLOOR).toMatch(/^\d+\.\d+\.\d+$/)
    expect(ISOLATE_API.prefetchAndHydrate).toBe(ISOLATE_API_FLOOR)
    expect(ISOLATE_API.createPageRenderer).toBe(ISOLATE_API_FLOOR)
    // and the entry hosting feature-detects today shipped one version earlier
    expect(ISOLATE_API.prefetchPageData).toBe('0.14.1')
  })

  it('the built artifact exports the same set — the isolate loads dist/ssr.js, not the source', async () => {
    const dist = new URL('../dist/ssr.js', import.meta.url)
    if (!existsSync(dist)) return // built by `pnpm build:ssr` / prepublishOnly; absent on a fresh clone
    const built = await import(dist.href)
    const missing = promised.filter((name) => !(name in built))
    expect(missing, `dist/ssr.js is stale or the build dropped: ${missing.join(', ')} — run pnpm build:ssr`).toEqual([])
  })
})

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    expect(compareVersions('0.14.2', '0.9.5')).toBeGreaterThan(0)
    expect(compareVersions('0.14.10', '0.14.2')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0)
    expect(compareVersions('0.14.2', '0.14.2')).toBe(0)
  })
})
