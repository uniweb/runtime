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
import { existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => JSON.parse(readFileSync(join(pkgDir, p), 'utf8'))
const script = (name) => join(pkgDir, 'scripts', name)

/** A lockfile in the shape pnpm writes, pinning `name` at `specifier`. */
const lockfileFor = (name, specifier) => `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      '${name}':
        specifier: ${specifier}
        version: ${specifier}

packages:

  '${name}@${specifier}':
    resolution: {integrity: sha512-AAAA}

snapshots:

  '${name}@${specifier}': {}
`

function scratch(files) {
  const dir = mkdtempSync(join(tmpdir(), 'standalone-pair-'))
  for (const [rel, body] of Object.entries(files)) {
    const target = join(dir, rel)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`)
  }
  return dir
}

// `--check` reads the versions the workspace LINKS, which only exist in a
// development checkout. A standalone CI checkout has none, and does not need
// them: it consumes the pair rather than verifying it against a workspace.
const inWorkspace = existsSync(join(pkgDir, 'node_modules', '@uniweb', 'core', 'package.json'))

// One test probes the registry on purpose. It fails closed on an unreachable
// network; only a missing npm binary would invert it.
const hasNpm = !spawnSync('npm', ['--version'], { stdio: 'ignore' }).error

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
    // Only the workspace deps, the generation marker, and the deliberately
    // omitted version may differ. Anything else diverging means the twin was
    // hand-edited or a script drifted.
    const dev = read('package.json')
    const twin = read('package.standalone.json')
    const strip = (m) => {
      const c = structuredClone(m)
      delete c._generated
      delete c.version // omitted from the twin on purpose — see the --apply suite
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

describe('--apply never changes the version', () => {
  // ⛔ The v0.11.1 channel run failed here. The twin carried `version: 0.11.0`
  // from before the release bumped package.json; --apply copied the whole twin
  // over, reinstating the old version; the publisher then decided that version
  // was already published and wrote nothing. `pnpm version` bumps package.json
  // and never the twin, so a twin that carries a version is stale from the
  // moment of every release.
  it('the twin carries no version at all', () => {
    expect(read('package.standalone.json').version).toBeUndefined()
  })

  it('applying the twin preserves the checkout version, even a stale-versioned twin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'standalone-apply-'))
    try {
      // A tag built before the fix: twin WITH a version, package.json newer.
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '2.0.0', dependencies: {} }, null, 2))
      writeFileSync(
        join(dir, 'package.standalone.json'),
        JSON.stringify({ name: 'x', version: '1.0.0', dependencies: { dep: '1.2.3' } }, null, 2)
      )
      const r = spawnSync(process.execPath, [join(pkgDir, 'scripts', 'standalone-manifest.js'), '--apply'], {
        cwd: dir,
        encoding: 'utf8',
      })
      expect(r.status, r.stderr).toBe(0)

      const applied = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      expect(applied.version, 'the checkout version must win').toBe('2.0.0')
      expect(applied.dependencies.dep, "the twin's resolved deps must be applied").toBe('1.2.3')
      // Loud, but not fatal — a frozen tag must stay buildable.
      expect(r.stderr + r.stdout).toMatch(/carries version 1\.0\.0/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('a half-relocked pair is caught', () => {
  // ⛔ THE REGRESSION THIS FILE FAILED TO CATCH. On 2026-08-12 the 0.11.5
  // release left a twin pinning `@uniweb/core 0.8.5` beside a lockfile pinning
  // 0.8.4 — a pair CI's `--frozen-lockfile` rejects outright — and this suite
  // passed 6/6, because `--check` only asserted that a lockfile EXISTED.
  it('--check fails when the lockfile names a different version than the twin', () => {
    const dir = scratch({
      'package.json': { name: 'x', version: '1.0.0', dependencies: { '@uniweb/core': 'workspace:^' } },
      'node_modules/@uniweb/core/package.json': { name: '@uniweb/core', version: '1.2.3' },
    })
    try {
      // Generate the twin the same way a developer would, so the only thing
      // wrong with this checkout is the lockfile.
      const written = spawnSync(process.execPath, [script('standalone-manifest.js'), '--write', '--offline'], {
        cwd: dir,
        encoding: 'utf8',
      })
      expect(written.status, written.stderr).toBe(0)
      expect(JSON.parse(readFileSync(join(dir, 'package.standalone.json'), 'utf8')).dependencies['@uniweb/core']).toBe('1.2.3')

      // A lockfile from before that pin moved — the half-relocked state.
      writeFileSync(join(dir, 'pnpm-lock.yaml'), lockfileFor('@uniweb/core', '9.9.9'))

      const checked = spawnSync(process.execPath, [script('standalone-manifest.js'), '--check', '--offline'], {
        cwd: dir,
        encoding: 'utf8',
      })
      const out = `${checked.stdout}${checked.stderr}`
      expect(checked.status, `--check passed on a mismatched pair:\n${out}`).not.toBe(0)
      expect(out).toMatch(/pnpm-lock\.yaml disagrees with package\.standalone\.json/)
      expect(out, 'the failure must name the versions, not just fail').toMatch(/9\.9\.9/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(!hasNpm)('--write leaves the twin alone when a pin is unpublished', () => {
    // ⛔ The ordering bug itself: the write used to come FIRST and the registry
    // probe second, so a failed probe exited non-zero with the twin already
    // rewritten — which is precisely how 0.11.5 ended up half-relocked.
    //
    // The probe is the subject here, so this one does reach the registry. It
    // fails closed: an unreachable registry makes `npm view` non-zero, which is
    // read as "not published", which is the branch being asserted. Only a
    // machine with no npm at all could turn the assertion around, hence skipIf.
    const before = '{ "name": "x", "keep": "me" }\n'
    const dir = scratch({
      'package.json': { name: 'x', version: '1.0.0', dependencies: { '@uniweb/core': 'workspace:^' } },
      'node_modules/@uniweb/core/package.json': { name: '@uniweb/core', version: '99.99.99' },
      'package.standalone.json': before,
    })
    try {
      const r = spawnSync(process.execPath, [script('standalone-manifest.js'), '--write'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, UNIWEB_STANDALONE_PROBE_DELAYS: '' }, // one attempt, no waiting
      })
      expect(r.status, `--write should refuse an unpublished pin:\n${r.stdout}`).not.toBe(0)
      expect(`${r.stdout}${r.stderr}`).toMatch(/99\.99\.99 is not on the registry/)
      expect(readFileSync(join(dir, 'package.standalone.json'), 'utf8'), 'a refused --write must not touch the twin').toBe(before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('relock puts both files back when a later step fails', () => {
    // Step 1 (the twin) succeeds; step 2 (the lockfile) cannot resolve a `file:`
    // dependency that does not exist — deterministic, and offline. What is being
    // asserted is that the twin step 1 rewrote is restored, because the message
    // this script prints on failure promises exactly that.
    const twinBefore = '{ "name": "z", "the-old": "twin" }\n'
    const lockBefore = "lockfileVersion: '9.0'\n"
    const dir = scratch({
      'package.json': { name: 'z', version: '1.0.0', dependencies: { nope: 'file:./nowhere' } },
      'package.standalone.json': twinBefore,
      'pnpm-lock.yaml': lockBefore,
    })
    cpSync(join(pkgDir, 'scripts'), join(dir, 'scripts'), { recursive: true })
    try {
      const r = spawnSync(process.execPath, [join(dir, 'scripts', 'relock.js'), '--offline'], {
        cwd: dir,
        encoding: 'utf8',
      })
      expect(r.status, `relock should have failed:\n${r.stdout}`).not.toBe(0)
      expect(readFileSync(join(dir, 'package.standalone.json'), 'utf8'), 'the twin must be restored').toBe(twinBefore)
      expect(readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8')).toBe(lockBefore)
      expect(`${r.stdout}${r.stderr}`).toMatch(/restored package\.standalone\.json/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
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
