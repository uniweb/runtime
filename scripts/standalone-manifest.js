#!/usr/bin/env node

/**
 * `package.standalone.json` — this package's manifest with the workspace
 * protocol resolved, so it can be installed outside the development monorepo.
 *
 * ## Why a second manifest exists
 *
 * `@uniweb/runtime` is developed as a member of a pnpm workspace: its
 * `@uniweb/*` dependencies are declared `workspace:*` and pnpm SYMLINKS them to
 * sibling packages on disk. That is correct for development — it is what makes
 * an edit in a sibling package visible here without publishing.
 *
 * It is unusable for a standalone checkout. `workspace:*` is not a version any
 * registry understands, and there is no lockfile here because the workspace root
 * owns one.
 *
 * That matters because the delivery artifacts (`dist/app/**`, the SSR isolate
 * set) are meant to be reproducible from a tag by CI, and reproducibility needs
 * a pinned dependency graph. Measured 2026-08-08 on `v0.11.0`: hand-pinning the
 * five direct dependencies still produced different bytes, because
 * `@uniweb/semantic-parser` declares `yaml: ^2.8.2` and a fresh install took
 * `2.9.0` where the workspace had `2.8.3`. Only a lockfile pins transitively.
 *
 * ## The shape, and the two simpler ideas that do not work
 *
 *  - **Change `package.json` to plain semver ranges.** pnpm links workspace
 *    packages only for the `workspace:` protocol, so every developer's next
 *    install would silently swap symlinks for registry copies and sibling edits
 *    would stop being picked up.
 *  - **Commit a lockfile against the existing manifest.** A lockfile cannot
 *    encode `workspace:` outside a workspace, so it would disagree with the
 *    manifest and `--frozen-lockfile` would reject it.
 *
 * So `package.json` stays the development manifest, this generates its
 * standalone twin, and the lockfile is generated FROM the twin (see relock.js).
 *
 * ## Modes
 *
 *   --write    regenerate the twin from the versions this workspace links
 *   --apply    copy the twin over package.json (what CI does before installing)
 *   --check    fail if the twin disagrees with the live workspace, or the
 *              lockfile with the twin (the pair is only meaningful together)
 *   --audit    same as --check but advisory — never fails a build
 *   --offline  skip the "is it actually on npm?" probe
 *
 * ⛔ **READ-ONLY with respect to `node_modules/@uniweb/*`.** Those are symlinks
 * into sibling package directories, each its own git repository. Writing through
 * one edits another package's source.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MANIFEST = 'package.json'
const STANDALONE = 'package.standalone.json'
const LOCK = 'pnpm-lock.yaml'

const read = (p) => JSON.parse(readFileSync(p, 'utf8'))

function fail(msg) {
  console.error(`standalone-manifest: ${msg}`)
  process.exit(1)
}

/** Every dependency declared with the `workspace:` protocol. */
function workspaceDeps(pkg) {
  const out = []
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (String(range).startsWith('workspace:')) out.push({ field, name })
    }
  }
  return out
}

/**
 * The version the workspace ACTUALLY links, read from the resolved package
 * rather than guessed from a directory name — a folder name is a hint, not a
 * fact about which package lives in it.
 */
function linkedVersion(name) {
  const p = join('node_modules', name, MANIFEST)
  if (!existsSync(p)) {
    fail(
      `${name} is not installed, so its linked version cannot be read.\n` +
        `This needs the development workspace — run \`pnpm install\` at the workspace root.\n` +
        `(In CI use --apply, which needs none of this.)`
    )
  }
  return read(p).version
}

/**
 * The twin, derived deterministically so --check can compare byte for byte.
 *
 * ⛔ **`version` is deliberately OMITTED, and this is not tidiness.** The twin
 * is a generated file; `pnpm version` bumps `package.json` and does not touch
 * it. If the twin carried a version it would be stale from the moment of every
 * release, and `--apply` would then overwrite the real version with the old one.
 *
 * That is not hypothetical — it broke the v0.11.1 channel run: the twin still
 * said `0.11.0`, `--apply` reinstated it, the publisher decided that version was
 * already published and wrote nothing. Omitting the field makes the whole class
 * unrepresentable, where wiring a `version` hook to regenerate the twin would
 * only have kept it in sync as long as nobody forgot.
 */
function build(pkg) {
  const out = structuredClone(pkg)
  delete out.version
  for (const { field, name } of workspaceDeps(pkg)) {
    // Pinned EXACTLY, not with a caret. The point of the twin is that CI builds
    // what a developer builds; a range lets a runner pick up a sibling release
    // nobody here has run.
    out[field][name] = linkedVersion(name)
  }
  out._generated = {
    by: 'scripts/standalone-manifest.js',
    note:
      'Generated twin of package.json with workspace:* resolved to the versions the ' +
      'development workspace links. Do not edit by hand — run `pnpm relock`. CI applies ' +
      'this over package.json before installing.',
  }
  return out
}

/**
 * Does this version actually exist on the registry?
 *
 * ⚠️ The gap this closes: the twin pins what the workspace LINKS, but CI
 * installs from the REGISTRY. Those agree only while every sibling package on
 * disk has been published at its current version. Bump a sibling locally
 * without publishing and the twin names a version no registry has heard of —
 * which would otherwise surface far away, as a lockfile resolution error on a
 * runner, reading like a broken lockfile rather than an unpublished dependency.
 *
 * ⭐ During a cascading release this is safe because of the publish ORDER,
 * which is dependency-first: a dependency published earlier in the run is
 * already on the registry by the time this package's turn comes, and one
 * published later has not been bumped yet, so its linked version is still its
 * published one. That ordering is load-bearing here — if this ever starts
 * failing during a release, check whether the publish order changed before
 * suspecting this file.
 */
function publishedOnRegistry(name, version) {
  const r = spawnSync('npm', ['view', `${name}@${version}`, 'version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (r.error) return { ok: true, skipped: 'npm not runnable' }
  if (r.status !== 0) return { ok: false }
  return { ok: r.stdout.trim() === version }
}

/** Block the thread. `npm view` is spawnSync, so this whole file is synchronous. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// How long to keep asking. See verifyPublished() — this is a propagation
// window, not a network-flake retry. Overridable (comma-separated ms, empty for
// a single attempt) so a test can exercise the failure path without waiting out
// the real window.
const PROBE_DELAYS_MS = (process.env.UNIWEB_STANDALONE_PROBE_DELAYS ?? '3000,6000,12000,24000')
  .split(',')
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n > 0)

/**
 * ⛔ **"Not on the registry" is a race for the first minute after a publish,
 * and answering it too fast is what broke the 0.11.5 release.**
 *
 * A single probe treats a negative as final. It is not: `npm view` forces
 * `preferOnline`, so it does reach the network, but the registry's packument
 * takes a beat to propagate after `pnpm publish` returns. Measured 2026-08-12,
 * during the release that exposed this — the same probe loop, seconds apart:
 *
 *     @uniweb/core@0.8.5    published 38s earlier  →  found
 *     @uniweb/build@0.18.5  published 10s earlier  →  "not on the registry"
 *
 * Both were published. The release aborted on the second one.
 *
 * This is exactly the case the caller cannot distinguish from a genuinely
 * unpublished sibling, and it is the COMMON case: this probe runs at the end of
 * a release, on versions minted moments ago (`runPostPublishRelock` in the
 * monorepo's scripts/framework/publish.js). So a negative is retried over a
 * window wider than propagation takes, and only a version still missing at the
 * end is reported as unpublished.
 *
 * The failing set is retried as a GROUP, so the wait is bounded by the window
 * (~45s) rather than multiplied by how many pins are pending.
 */
function verifyPublished(pins) {
  let pending = pins
  for (let attempt = 0; ; attempt++) {
    const missing = []
    for (const pin of pending) {
      const r = publishedOnRegistry(pin.name, pin.version)
      if (r.skipped) return { skipped: r.skipped, missing: [] }
      if (!r.ok) missing.push(pin)
    }
    if (missing.length === 0) return { missing: [] }
    if (attempt >= PROBE_DELAYS_MS.length) return { missing }

    const wait = PROBE_DELAYS_MS[attempt]
    const names = missing.map((p) => `${p.name}@${p.version}`).join(', ')
    console.log(`  … ${names} not visible on the registry yet — retrying in ${wait / 1000}s`)
    sleepSync(wait)
    pending = missing
  }
}

/**
 * Does the committed lockfile actually agree with the twin?
 *
 * ⛔ **Nothing used to ask this, and `--check` claimed it did.** The pair is
 * two generated files that are only meaningful together — CI runs `--apply`
 * and then `pnpm install --frozen-lockfile`, which compares the manifest's
 * specifiers against the lockfile's. Until 2026-08-12 this check tested only
 * that `pnpm-lock.yaml` EXISTS, so a half-written pair passed both `--check`
 * and the drift test that shells out to it — which is how a twin pinning
 * `@uniweb/core 0.8.5` sat beside a lockfile pinning 0.8.4 with every guard
 * reporting green.
 *
 * So ask pnpm rather than re-implementing its comparison: same command as the
 * runner, in a directory pnpm cannot mistake for a workspace member (see
 * relock.js's header for why that matters). `--lockfile-only --offline` makes
 * it a specifier comparison and nothing else — no resolution, no downloads,
 * ~130ms, and it works with an empty store.
 */
function lockfileAgreesWithTwin() {
  if (!existsSync(LOCK)) return { ok: false, reason: `${LOCK} is missing` }
  if (!existsSync(STANDALONE)) return { ok: false, reason: `${STANDALONE} is missing` }

  const work = mkdtempSync(join(tmpdir(), 'uniweb-runtime-pair-'))
  try {
    copyFileSync(STANDALONE, join(work, MANIFEST))
    copyFileSync(LOCK, join(work, LOCK))
    const r = spawnSync(
      'pnpm',
      ['install', '--frozen-lockfile', '--lockfile-only', '--ignore-scripts', '--offline'],
      { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
    // Unverifiable is not a pass. A guard that goes quiet when its instrument
    // is missing is the failure mode this whole function exists to end.
    if (r.error) {
      return { ok: false, reason: `pnpm could not be run (${r.error.code}), so the pair could not be verified` }
    }
    if (r.status === 0) return { ok: true }

    const out = `${r.stdout}${r.stderr}`
    const detail = out.includes('Failure reason:') ? out.slice(out.indexOf('Failure reason:')) : out
    return { ok: false, reason: detail.trim() }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const mode = argv.find((a) => ['--write', '--apply', '--check', '--audit'].includes(a))
const offline = argv.includes('--offline')

if (!mode) {
  console.error('Usage: standalone-manifest.js --write|--apply|--check|--audit [--offline]')
  process.exit(2)
}

if (mode === '--apply') {
  // CI path: no workspace, no node_modules, nothing to read but the twin.
  if (!existsSync(STANDALONE)) fail(`${STANDALONE} is missing — run \`pnpm relock\`.`)
  const live = read(MANIFEST)
  const twin = read(STANDALONE)

  // MERGE, never replace — and carry the live version across. The twin has no
  // version of its own (see build()); the checkout's is the authoritative one,
  // because a tag build must publish the version its tag names.
  if (!live.version) fail(`${MANIFEST} has no version — refusing to apply.`)
  if (twin.version) {
    // Warn, do not fail. A twin generated before the version field was dropped
    // carries a stale one, and those twins are frozen inside published tags —
    // failing here would make every such tag permanently unbuildable, which is
    // a worse outcome than overriding a field we know to be wrong.
    console.warn(
      `standalone-manifest: ${STANDALONE} carries version ${twin.version}; ignoring it ` +
        `in favour of ${MANIFEST}'s ${live.version}. Run \`pnpm relock\` to drop it.`
    )
  }
  writeFileSync(MANIFEST, `${JSON.stringify({ ...twin, version: live.version }, null, 2)}\n`)
  console.log(`standalone-manifest: applied ${STANDALONE} (version ${live.version} preserved)`)
  process.exit(0)
}

const pkg = read(MANIFEST)
const deps = workspaceDeps(pkg)
const next = build(pkg)
const serialized = `${JSON.stringify(next, null, 2)}\n`

if (mode === '--write') {
  const pins = deps.map(({ field, name }) => ({ field, name, version: next[field][name] }))
  for (const pin of pins) console.log(`  ${pin.name} → ${pin.version}`)

  // ⛔ VERIFY FIRST, WRITE SECOND — the order is the fix, not a preference.
  //
  // This used to write the twin and then probe, so a probe failure exited 1
  // with the twin already rewritten. relock.js then printed "nothing was
  // changed beyond this point", which was false: the twin had moved and the
  // lockfile had not, leaving a pair that cannot install and a dirty working
  // tree that blocks the NEXT release (the monorepo publisher refuses a
  // package with uncommitted changes). That is the 2026-08-12 incident.
  //
  // Writing only after every pin is confirmed makes a failed run a no-op here,
  // which is what the message promised all along.
  if (!offline) {
    const { skipped, missing } = verifyPublished(pins)
    if (skipped) console.log(`  ${skipped} — skipping the registry check`)
    if (missing.length) {
      for (const pin of missing) {
        console.error(`  ⛔ ${pin.name}@${pin.version} is not on the registry — a standalone install cannot resolve it.`)
      }
      fail(
        `${missing.length} pinned version(s) are unpublished, and ${STANDALONE} was NOT changed.\n` +
          `  Publish them first, or re-run with --offline.`
      )
    }
  }

  writeFileSync(STANDALONE, serialized)
  console.log(`standalone-manifest: wrote ${STANDALONE}`)
  process.exit(0)
}

// --check / --audit
const advisory = mode === '--audit'
const problems = []

if (!existsSync(STANDALONE)) {
  problems.push(`${STANDALONE} is missing`)
} else if (readFileSync(STANDALONE, 'utf8') !== serialized) {
  problems.push(
    `${STANDALONE} disagrees with the live workspace — a dependency version moved.\n` +
      `  Run \`pnpm relock\` to regenerate it and its lockfile together.`
  )
}

if (!existsSync(LOCK)) {
  problems.push(`${LOCK} is missing — the twin without a lockfile pins nothing transitively`)
} else {
  // The half that used to go unasked: the two files are a pair, and CI installs
  // them together with --frozen-lockfile.
  const pair = lockfileAgreesWithTwin()
  if (!pair.ok) {
    problems.push(
      `${LOCK} disagrees with ${STANDALONE} — CI's \`pnpm install --frozen-lockfile\` would reject this pair.\n` +
        `${pair.reason
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n')}\n` +
        `  Run \`pnpm relock\` to regenerate both together.`
    )
  }
}

if (problems.length) {
  const label = advisory ? 'standalone-manifest (advisory)' : 'standalone-manifest'
  for (const p of problems) console.error(`${label}: ${p}`)
  process.exit(advisory ? 0 : 1)
}

console.log('standalone-manifest: twin and lockfile agree with the workspace')
