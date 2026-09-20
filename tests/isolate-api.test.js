/**
 * The isolate API is pinned HERE, because framework is the lane that can break it.
 *
 * A host renders in an isolate against the site's pinned runtime, loaded as an
 * artifact — it cannot import our names, so it feature-detects, and a renamed or
 * dropped export is indistinguishable from an old runtime: it falls back forever,
 * serving pages with no error and no log (the host's own note on the coupling,
 * their own note on the coupling). A publisher holds the floor as a constant.
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
import { ISOLATE_API, MIN_USABLE_RUNTIME, WIRE_FLOOR, UNRELEASED, UNRELEASED_EXPORTS, compareVersions } from '../src/isolate-api.js'
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
      if (since === UNRELEASED) continue // in the tree, in no published version — see below
      expect(since, name).toMatch(/^\d+\.\d+\.\d+$/)
      expect(compareVersions(pkg.version, since), `${name} claims to ship since ${since}, later than this package (${pkg.version})`).toBeGreaterThanOrEqual(0)
    }
  })

  // ⭐ The floor is a promise about a PUBLISHED artifact, so an export that has
  // not published must not raise it. Backend refuses to serve a site below the
  // floor and a host at it may skip feature detection — so a floor naming a
  // version that lacks the export breaks the guarantee in the one direction the
  // floor exists to prevent.
  it('an UNRELEASED export is stamped, but does NOT raise the floor', () => {
    for (const name of UNRELEASED_EXPORTS) {
      expect(name in ssr, `${name} is stamped UNRELEASED but not exported`).toBe(true)
      expect(ISOLATE_API[name]).toBe(UNRELEASED)
    }
    const published = Object.values(ISOLATE_API).filter((v) => v !== UNRELEASED)
    expect(published).not.toContain(UNRELEASED)
    // ⚠️ AT OR ABOVE, not equal to: since 2026-09-06 the floor also absorbs
    // `WIRE_FLOOR`, so it can sit above every export stamp. What must stay true
    // is only that an UNRELEASED export never lifts it.
    const apiMax = published.reduce((max, v) => (compareVersions(v, max) > 0 ? v : max), '0.0.0')
    expect(compareVersions(MIN_USABLE_RUNTIME, apiMax), 'the floor is at or above every published stamp').toBeGreaterThanOrEqual(0)
    for (const name of UNRELEASED_EXPORTS) {
      expect(ISOLATE_API[name]).toBe(UNRELEASED)
    }
  })

  // ⚠️ The obligation the sentinel creates, and the only thing that will remind
  // anyone: after the publish that ships them, UNRELEASED exports must be
  // restamped with the version it produced, or the floor stays below its own API
  // forever and hosts feature-detect what they could have relied on.
  it('names what is owed after the next publish', () => {
    if (UNRELEASED_EXPORTS.length === 0) return // the steady state
    expect(
      UNRELEASED_EXPORTS,
      `after the next @uniweb/runtime publish, restamp these with the version it produced ` +
        `and raise MIN_USABLE_RUNTIME: ${UNRELEASED_EXPORTS.join(', ')}`,
    ).toBeInstanceOf(Array)
  })

  // ⚠️ EVERY NUMBER HERE IS SPELLED OUT ON PURPOSE. Deriving them would assert
  // the implementation against itself and pass for any value; literals are what
  // make raising the floor a deliberate edit a reviewer sees. It is also the
  // number a publisher ratchets, so a silent move is the thing to prevent.
  it('the floor is 0.26.6 — the newest stamp, which has overtaken the WIRE floor', () => {
    expect(MIN_USABLE_RUNTIME).toBe('0.26.6')
    expect(MIN_USABLE_RUNTIME).toMatch(/^\d+\.\d+\.\d+$/)

    // ⭐ 2026-09-19 — WHY THIS NUMBER MOVED, and it is the first time an export has moved it.
    // `loadPageData` shipped in 0.26.6 (verified from the published tarball, not from a version
    // number), and step 3 of `isolate-api.js`'s sequence restamps an `UNRELEASED` export with the
    // version that published it. That necessarily lifts the floor: a floor BELOW the newest stamp
    // would promise a host an export the floor's own version does not contain, which is the one
    // direction the floor exists to prevent. ⇒ The wire reason below is unchanged and still sits
    // underneath; what changed is that the export map now leads it.
    // ⚠️ Backend ratchets this number from the channel index, so it reaches published sites at the
    // NEXT channel publish, not at this commit.

    // ⭐ THE FLOOR IS SET ON THE WIRE, NOT DERIVED FROM THE EXPORT MAP — and the
    // REASON changed on 2026-09-12 while the mechanism did not.
    //
    // It was 0.18.0 because of a COMPATIBILITY BREAK: below that, a runtime sends
    // `depth` on every records question, the door refuses it as an unknown field,
    // and every live-records fetch fails. Such a runtime exports every name in the
    // map and still cannot be used — which a floor derived from export presence
    // alone cannot say. That break is still real and still below this number.
    //
    // ⭐ It was raised to 0.21.0 for an additional reason [Diego, 2026-09-12]: while
    // in 0.x, the floor may be raised simply so nobody has to check what a version
    // supports. ⇒ A raise no longer implies an incompatibility at the new number.
    //
    // ⭐ 0.25.0 (2026-09-14) is both: raised on Diego's word after the publish, and the
    // first runtime that asks the records service with `narrow` — every earlier one
    // sends a top-level `match` or `cursor`, which the service now refuses.
    expect(WIRE_FLOOR).toBe('0.25.0')
    expect(ISOLATE_API.collectSiteRecords).toBe('0.17.0')
    expect(compareVersions(WIRE_FLOOR, ISOLATE_API.collectSiteRecords)).toBeGreaterThan(0)
    // the render's data step, and the first export ever to sit above the wire floor
    expect(ISOLATE_API.loadPageData).toBe('0.26.6')
    expect(compareVersions(ISOLATE_API.loadPageData, WIRE_FLOOR)).toBeGreaterThan(0)

    // the composed render entry, which was the floor until 0.17.0
    expect(ISOLATE_API.prefetchAndHydrate).toBe('0.14.2')
    expect(ISOLATE_API.createPageRenderer).toBe('0.14.2')
    // ⛔ And the entry a host used to feature-detect is GONE (2026-09-20): `prefetchPageData`,
    // `resolvePageFetchConfigs` and `executeFetchConfigs` worked from the payload alone, the one
    // host that called them confirmed the switch to `loadPageData`, and a name that no longer
    // exists must not be stamped — the map would promise it.
    expect(ISOLATE_API.prefetchPageData).toBeUndefined()
    expect(ISOLATE_API.resolvePageFetchConfigs).toBeUndefined()
    expect(ISOLATE_API.executeFetchConfigs).toBeUndefined()
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
