/**
 * Drift detection for the standalone-install pair.
 *
 * `package.standalone.json` + `pnpm-lock.yaml` let CI build this package from a
 * tag without the development workspace. They are GENERATED, so they can go
 * stale the moment a sibling package's version moves — and a stale pair is
 * worse than no pair: CI would build against versions nobody here runs, and the
 * delivery artifacts would differ from what every developer tests.
 *
 * The drift is detected HERE, in the workspace, at the moment a version moves —
 * rather than on a runner that has no way to know what the workspace links.
 *
 * Fix a failure with `pnpm relock`.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => JSON.parse(readFileSync(join(pkgDir, p), 'utf8'))

// `--check` reads the versions the workspace LINKS, which only exist in a
// development checkout. A standalone CI checkout has none, and does not need
// them: it consumes the pair rather than verifying it against a workspace.
const inWorkspace = existsSync(join(pkgDir, 'node_modules', '@uniweb', 'core', 'package.json'))

describe('the standalone pair exists', () => {
  it('ships a twin and a lockfile', () => {
    expect(existsSync(join(pkgDir, 'package.standalone.json')), 'package.standalone.json missing — run `pnpm relock`').toBe(true)
    expect(existsSync(join(pkgDir, 'pnpm-lock.yaml')), 'pnpm-lock.yaml missing — run `pnpm relock`').toBe(true)
  })

  it('the twin resolves every workspace protocol dependency', () => {
    const dev = read('package.json')
    const twin = read('package.standalone.json')
    for (const field of ['dependencies', 'devDependencies']) {
      for (const [name, range] of Object.entries(dev[field] ?? {})) {
        if (!String(range).startsWith('workspace:')) continue
        const pinned = twin[field]?.[name]
        expect(pinned, `${name} is workspace:* but unresolved in the twin`).toBeTruthy()
        expect(String(pinned), `${name} must be pinned exactly, not as a range`).toMatch(/^\d+\.\d+\.\d+/)
      }
    }
  })

  it('the twin is otherwise identical to the development manifest', () => {
    // Only the workspace deps and the generation marker may differ. Anything
    // else diverging means the twin was hand-edited or a script drifted.
    const dev = read('package.json')
    const twin = read('package.standalone.json')
    const strip = (m) => {
      const c = structuredClone(m)
      delete c._generated
      for (const f of ['dependencies', 'devDependencies']) {
        for (const k of Object.keys(c[f] ?? {})) {
          if (String(dev[f]?.[k]).startsWith('workspace:')) c[f][k] = 'workspace:*'
        }
      }
      return c
    }
    expect(strip(twin)).toEqual(strip(dev))
  })
})

describe.skipIf(!inWorkspace)('the pair agrees with the live workspace', () => {
  it('--check passes', () => {
    const r = spawnSync(process.execPath, [join('scripts', 'standalone-manifest.js'), '--check', '--offline'], {
      cwd: pkgDir,
      encoding: 'utf8',
    })
    expect(r.status, `${r.stdout}${r.stderr}\nRun \`pnpm relock\` to regenerate the pair.`).toBe(0)
  })
})
