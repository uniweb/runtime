import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(
  fileURLToPath(new URL('../src/foundation-loader.js', import.meta.url)),
  'utf8'
)

/**
 * Comments stripped, because the assertions below are about CODE.
 *
 * The first run of this file failed on its own documentation: the comment in
 * `loadExtensions()` explaining why BASE_URL must not be read contains the
 * string "BASE_URL". A guard that its own rationale can break is not a guard —
 * it would force whoever restates the reasoning to weaken the test.
 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n')

/**
 * The loader applies NO deployment base — that is the guarantee.
 *
 * A module URL that reaches the runtime is FINAL: `loadFoundation()` anchors a
 * root-relative URL to the document origin (which HOST serves it) and does
 * nothing else. The primary foundation and every extension therefore resolve
 * by exactly one rule.
 *
 * Until 2026-08-04 they did not. `loadExtensions()` prefixed root-relative
 * URLs with `import.meta.env.BASE_URL`; the primary, which reaches
 * `loadFoundation()` straight from `initRuntime()`, got no such step. So under
 * `base: /docs/` the string `/effects/entry.js` resolved to
 * `/docs/effects/entry.js` as an extension and `/effects/entry.js` as a
 * foundation. Nothing tested it and nothing chose it. It was harmless only by
 * coincidence — on a bundled static site BASE_URL *is* the site's base, and on
 * a hosted site it is '/' so the step was inert.
 *
 * Why the loader is the wrong place, and not merely a redundant one:
 *
 *  1. A module URL is a SERVE LOCATION, not a path under the site's mount
 *     point. A host may serve a site under one subpath and serve its
 *     foundation from an entirely different root.
 *     Prefixing every root-relative module URL with the site's base corrupts
 *     precisely that case.
 *  2. `import.meta.env.BASE_URL` is a build-time constant of whichever bundle
 *     the runtime shipped in. `setup.js buildDefaultFetcher()` had already
 *     ruled that the wrong authority for the sibling problem, preferring the
 *     payload's `content.config.base`.
 *
 * The base is now applied by the producer that knows it — `@uniweb/build`'s
 * `src/site/extension-urls.js`, which resolves the payload's
 * `config.extensions`, the `__FOUNDATION_CONFIG__` define and the preload
 * hints from one helper. The behavioural tests live there.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * These assertions read the SOURCE rather than calling the functions, because
 * the property is an ABSENCE. Both entry points end in `import(url)`, which in
 * a Node test fails for any URL, so a behavioural test cannot distinguish "did
 * not rewrite the URL" from "rewrote it and then failed". A source guard is
 * the instrument that actually catches the regression: someone re-adding a
 * base step here would not fail any other test in this package.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('foundation-loader applies no deployment base', () => {
  it('never reads import.meta.env / BASE_URL', () => {
    // The exact regression: `const basePath = import.meta.env?.BASE_URL || '/'`.
    expect(code).not.toMatch(/import\.meta\.env/)
    expect(code).not.toMatch(/BASE_URL/)
  })

  it('hands loadExtensions urls straight to loadFoundation, unwrapped', () => {
    // Pins the call shape, so reintroducing a resolver between them is a
    // visible edit to this line rather than a silent behavioural change.
    expect(code).toMatch(/urls\.map\(\(url\) => loadFoundation\(url\)\)/)
  })

  it('still anchors root-relative URLs to the document origin', () => {
    // The one resolution the loader DOES own, and must keep: it is about which
    // HOST serves the module (a runtime loaded from a CDN must not resolve a
    // site-relative module against the CDN), not about which subpath.
    expect(code).toMatch(/function resolveAgainstDocument/)
    expect(code).toMatch(/window\.location\.origin \+ url/)
  })
})
