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
 *   --check    fail if the twin disagrees with the live workspace
 *   --audit    same as --check but advisory — never fails a build
 *   --offline  skip the "is it actually on npm?" probe
 *
 * ⛔ **READ-ONLY with respect to `node_modules/@uniweb/*`.** Those are symlinks
 * into sibling package directories, each its own git repository. Writing through
 * one edits another package's source.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const MANIFEST = 'package.json'
const STANDALONE = 'package.standalone.json'

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
  writeFileSync(STANDALONE, serialized)
  console.log(`standalone-manifest: wrote ${STANDALONE}`)
  for (const { name } of deps) console.log(`  ${name} → ${next.dependencies?.[name] ?? next.devDependencies?.[name]}`)

  if (!offline) {
    let bad = 0
    for (const { field, name } of deps) {
      const v = next[field][name]
      const r = publishedOnRegistry(name, v)
      if (r.skipped) continue
      if (!r.ok) {
        console.error(`  ⛔ ${name}@${v} is not on the registry — a standalone install cannot resolve it.`)
        bad++
      }
    }
    if (bad) fail(`${bad} pinned version(s) are unpublished. Publish them first, or re-run with --offline.`)
  }
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

if (!existsSync('pnpm-lock.yaml')) {
  problems.push('pnpm-lock.yaml is missing — the twin without a lockfile pins nothing transitively')
}

if (problems.length) {
  const label = advisory ? 'standalone-manifest (advisory)' : 'standalone-manifest'
  for (const p of problems) console.error(`${label}: ${p}`)
  process.exit(advisory ? 0 : 1)
}

console.log('standalone-manifest: twin and lockfile agree with the workspace')
