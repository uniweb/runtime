#!/usr/bin/env node

/**
 * `pnpm relock` — regenerate the standalone twin AND its lockfile, together.
 *
 * ## Why one command rather than two documented steps
 *
 * `package.standalone.json` and `pnpm-lock.yaml` are a PAIR: the lockfile is
 * generated from the twin, and `pnpm install --frozen-lockfile` rejects them if
 * they disagree. Two steps in a comment is a recipe somebody performs half of,
 * and the half-done state fails on a runner rather than here.
 *
 * ## 🕳️ Why the lockfile is generated in a TEMP DIRECTORY
 *
 * **This is the step an independent attempt gets wrong.** pnpm resolves against
 * whatever workspace it finds by walking up from the cwd. Run inside this
 * package, it finds the development workspace root, resolves the `@uniweb/*`
 * dependencies to the sibling packages on disk, and writes a lockfile carrying
 * `link:`/`workspace:` entries — which is precisely the lockfile that cannot be
 * installed standalone, produced by the command meant to prevent that.
 *
 * A directory outside any workspace has no root to find, so pnpm resolves from
 * the registry, which is what CI does.
 *
 * ## What this buys
 *
 * A lockfile is the only thing that pins TRANSITIVE dependencies. Measured on
 * `v0.11.0`: pinning the direct dependencies by hand still produced different
 * bytes than the published build, because `@uniweb/semantic-parser` declares
 * `yaml: ^2.8.2` and a fresh install resolved `2.9.0` where the workspace had
 * `2.8.3` — a difference that lands as real code in the SSR isolate bundle.
 *
 * Usage:  pnpm relock  [--offline]
 */

import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TWIN = 'package.standalone.json'
const LOCK = 'pnpm-lock.yaml'
const offline = process.argv.includes('--offline')

function step(label, cmd, args, opts = {}) {
  console.log(`\n── ${label}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.status !== 0) {
    console.error(`\nrelock: "${label}" failed — nothing was changed beyond this point.`)
    process.exit(r.status ?? 1)
  }
}

// 1. The twin, from the versions this workspace links (and verified against the
//    registry unless --offline). Must come first: the lockfile derives from it.
step('regenerate the standalone manifest', process.execPath, [
  join('scripts', 'standalone-manifest.js'),
  '--write',
  ...(offline ? ['--offline'] : []),
])

// 2. The lockfile, resolved from the registry in a directory pnpm cannot
//    mistake for a workspace member. See the header.
const work = mkdtempSync(join(tmpdir(), 'uniweb-runtime-relock-'))
try {
  cpSync(TWIN, join(work, 'package.json'))
  step('resolve dependencies from the registry', 'pnpm', ['install', '--lockfile-only', '--ignore-scripts'], {
    cwd: work,
  })

  const produced = join(work, LOCK)
  if (!existsSync(produced)) {
    console.error(`relock: pnpm produced no ${LOCK} in ${work}`)
    process.exit(1)
  }
  cpSync(produced, LOCK)
  console.log(`\nrelock: wrote ${TWIN} + ${LOCK}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

// 3. Prove the pair agrees, rather than assuming the two steps above composed.
//    This is the same comparison `--frozen-lockfile` performs on the runner, so
//    a failure here is one that would otherwise have surfaced in CI.
step('verify the pair', process.execPath, [join('scripts', 'standalone-manifest.js'), '--check', '--offline'])
