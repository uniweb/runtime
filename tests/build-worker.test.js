/**
 * Guards on the PUBLISH PATH.
 *
 * ⛔ `build-worker.js` runs from `prepublishOnly` and had zero test coverage
 * until 2026-08-08, when a **comment-only** edit to it broke publishing: the
 * sourcemap exclusion was written as a literal glob whose `*` + `/` sequence
 * terminates a block comment, so the comment ended mid-sentence, the remaining
 * prose parsed as code, and `node build-worker.js` died with
 * `SyntaxError: Unexpected token '*'`. Nothing executed the file between the
 * edit and the release that reached for it.
 *
 * The first response was to write a warning comment telling future editors not
 * to do it again. That response has already been shown not to work here: the
 * head-injection seam carried two prose warnings in one file and still shipped
 * the same class of bug twice, and only a mechanical parity test stopped it.
 * This file is the equivalent guard for the worker build.
 *
 * The `import` below is most of the value: it is what a syntax error fails.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Importing the module IS the syntax guard. It must stay a real static import:
// the CLI block at the bottom of build-worker.js is `process.argv[1]`-guarded,
// so importing it runs nothing.
import { BRIDGES, BRIDGE_EXCLUSIONS, buildWorkerRuntime } from '../build-worker.js'
import { DEFAULT_EXTERNALS } from '@uniweb/build/import-map-plugin'

const here = dirname(fileURLToPath(import.meta.url))

describe('the module loads at all', () => {
  it('exports its build entry point', () => {
    // If build-worker.js does not parse, this file fails to import and every
    // test here fails — which is the point.
    expect(typeof buildWorkerRuntime).toBe('function')
  })

  it('has no block-comment terminator inside a block comment', () => {
    // Belt and braces, and it names the failure precisely instead of leaving a
    // bare SyntaxError. A literal `**/` + `*` glob is the shape that did it.
    const src = readFileSync(join(here, '..', 'build-worker.js'), 'utf8')
    const offenders = src
      .split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => {
        const t = line.trim()
        if (!t.startsWith('*')) return false
        const at = t.indexOf('*/')
        // `*/` ending the line is the legitimate terminator. `*/` with anything
        // after it means the comment closed mid-sentence — the actual bug.
        return at !== -1 && at !== t.length - 2
      })

    expect(
      offenders,
      `line(s) inside a block comment contain "*/", which ends the comment early:\n` +
        offenders.map(([n, l]) => `  ${n}: ${l.trim()}`).join('\n')
    ).toEqual([])
  })
})

describe('the isolate bridge set stays in lockstep with the foundation externals', () => {
  // A drift here does not fail a build. It resolves one bare specifier to two
  // React instances in the isolate, breaking hooks at runtime with no signal.
  const bridged = BRIDGES.map((b) => b.spec)

  it('bridges every foundation-facing external except the documented exclusions', () => {
    const expected = DEFAULT_EXTERNALS.filter((s) => !BRIDGE_EXCLUSIONS.includes(s))
    expect([...bridged].sort()).toEqual([...expected].sort())
  })

  it('the exclusions are real members of DEFAULT_EXTERNALS', () => {
    // Otherwise an exclusion silently stops excluding anything — e.g. after a
    // rename — and the test above keeps passing while the sets diverge.
    for (const spec of BRIDGE_EXCLUSIONS) {
      expect(DEFAULT_EXTERNALS, `"${spec}" is excluded but is not an external`).toContain(spec)
    }
  })

  it('never bridges a host-only specifier', () => {
    // HOST_BRIDGES (vite.config.app.js) serves a host rendering through its own
    // React tree. An SSR isolate renders to string — it mounts no root and needs
    // none of them. Bridging one here would ship dead shims into every isolate.
    for (const hostOnly of ['react-dom/client', 'react-router-dom', '@uniweb/theming']) {
      expect(bridged).not.toContain(hostOnly)
    }
  })

  it('each bridge carries a distinct global and shim path', () => {
    expect(new Set(BRIDGES.map((b) => b.global)).size).toBe(BRIDGES.length)
    expect(new Set(BRIDGES.map((b) => b.shim)).size).toBe(BRIDGES.length)
  })
})
