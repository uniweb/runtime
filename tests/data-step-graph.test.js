/**
 * THE DATA STEP DOES NOT PULL A RENDERER.
 *
 * `loadPageData` fetches. It resolves a page, walks its blocks and dispatches requests — it
 * renders nothing, and nothing in its graph needs React. That was true of the code and false of
 * its imports until 2026-09-20: it reached `resolvePage` (one line, `website.getPage`) through
 * `ssr-renderer.js`, which imports `react-dom/server` at module scope, so the server renderer
 * came with it.
 *
 * ⛔ **The failure is silent and grep cannot find it.** Nothing breaks where this runs today — the
 * isolate bundle and the static build both have React anyway — so the cost only appears for a
 * caller that does not, and only as bundle weight or a resolution error far from the edit that
 * caused it. One added import re-creates it, and it would read as ordinary.
 *
 * ⚖️ **What this does and does not claim.** It says the data step's own graph is renderer-free. It
 * makes no promise about `@uniweb/runtime/ssr` as a whole, which renders and must import React.
 *
 * The walk is transitive and follows relative imports, so a violation two files down fails here.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const ENTRY = join(SRC, 'load-page-data.js')

/** Every specifier a file imports or re-exports, static forms only. */
function specifiersOf(file) {
  const code = readFileSync(file, 'utf8')
  const out = []
  // `import … from 'x'`, `export … from 'x'`, `import 'x'`, and `import('x')`.
  const patterns = [
    /(?:^|\n)\s*import\s[\s\S]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s[\s\S]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(code))) out.push(m[1])
  }
  return out
}

/** Resolve a relative specifier to a file on disk, or null when it is bare. */
function resolveRelative(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec)
  for (const candidate of [base, `${base}.js`, `${base}.jsx`, join(base, 'index.js')]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) return candidate
  }
  return null
}

/** The transitive closure of relative imports from `entry`, and every bare specifier seen. */
function graphOf(entry) {
  const files = new Set()
  const bare = new Map() // specifier -> the file that imported it
  const queue = [entry]
  while (queue.length) {
    const file = queue.pop()
    if (files.has(file)) continue
    files.add(file)
    for (const spec of specifiersOf(file)) {
      const target = resolveRelative(file, spec)
      if (target) queue.push(target)
      else if (!bare.has(spec)) bare.set(spec, file)
    }
  }
  return { files, bare }
}

const isReact = (spec) => spec === 'react' || spec === 'react-dom' || spec.startsWith('react/') || spec.startsWith('react-dom/')

describe('the render data step', () => {
  it('⭐ reaches no renderer — nothing in its graph imports React', () => {
    const { bare } = graphOf(ENTRY)
    const offenders = [...bare.entries()]
      .filter(([spec]) => isReact(spec))
      .map(([spec, file]) => `${file.slice(SRC.length + 1)} imports ${spec}`)

    expect(
      offenders,
      'loadPageData fetches and renders nothing, so its graph must not pull React. ' +
        'The usual cause is reaching for a helper through `ssr-renderer.js`, which imports ' +
        '`react-dom/server` at module scope — move the helper to its own leaf instead ' +
        '(`src/resolve-page.js` is the precedent).'
    ).toEqual([])
  })

  it('the walk actually reached the graph, so an empty result cannot pass by finding nothing', () => {
    const { files, bare } = graphOf(ENTRY)
    // The step's own relative imports, at minimum — if the resolver silently stopped at the entry
    // this list would be one file and the assertion above would be vacuous.
    expect(files.size).toBeGreaterThan(3)
    expect([...bare.keys()]).toContain('@uniweb/core/datastore')
  })

  it('a control: the SSR renderer itself DOES pull React, so the detector is not blind', () => {
    const { bare } = graphOf(join(SRC, 'ssr-renderer.js'))
    expect([...bare.keys()].filter(isReact).length).toBeGreaterThan(0)
  })
})
