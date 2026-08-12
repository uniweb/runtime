#!/usr/bin/env node

/**
 * `pnpm channel:publish` — put THIS build into the distribution channel, from
 * the machine that built it.
 *
 *   node scripts/release-channel.mjs [--dry-run]
 *
 * ## Why the release publishes the channel, rather than a runner rebuilding it
 *
 * `prepublishOnly` is `build && build:worker`, so by the time `pnpm publish`
 * returns, `dist/` already holds the delivery set — built from the working tree
 * that was released, against the sibling packages the workspace SYMLINKS. That
 * is the most correct artifact that will ever exist for this version: the
 * siblings are the code, not a version number, so nothing is pending a bump.
 *
 * The job that used to do this rebuilt the tag on a runner instead, and the
 * rebuild was measurably worse. A runner has no workspace, so it installed the
 * siblings from the registry via a committed manifest twin — and that twin is
 * regenerated AFTER the release that tags it, so a tag always carried the
 * PREVIOUS round's pins. Measured on v0.11.5: the tag's twin said
 * `@uniweb/core 0.8.4` while the npm tarball for the same release declared
 * `^0.8.5`, and the CI log confirms `+ @uniweb/core 0.8.4`. The channel got a
 * runtime fix without the core fix it was released alongside.
 *
 * ⚠️ **The argument this replaces, so it is not re-derived from a stale
 * comment.** `publish-channel.mjs`'s `--from` still explains that CI passes an
 * extracted npm tarball so the channel carries "exactly the bytes npm shipped",
 * because "a local build can differ from a published one at the same version".
 * That was true of a design where npm shipped these artifacts. It no longer
 * does — `files` is `src` + `dist/ssr.js`, and `dist/ssr.js` is deliberately
 * NOT in the channel. The two sets no longer intersect, so there is nothing
 * left for a local build to disagree with.
 *
 * ## The split with publish-channel.mjs
 *
 * `publish-channel.mjs` owns the channel's CONTENTS — which files, which
 * layout, the index, immutability. This owns the BRANCH: getting `gh-pages`
 * onto disk, committing, pushing, cleaning up. It is deliberately thin, because
 * everything interesting is already in the other file.
 *
 * The worktree is DETACHED on purpose: `-B gh-pages` would move a local branch
 * that a developer may have checked out for their own reasons, and this script
 * has no business touching it. It pushes `HEAD:gh-pages` instead.
 *
 * ⚠️ And it checks out `FETCH_HEAD`, not `origin/gh-pages`. The CI job could
 * name the remote-tracking ref because `actions/checkout` configures a
 * catch-all refspec; a working clone need not. The Uniweb workspace clones
 * `--single-branch` (scripts/init.js), so this repo's refspec is literally
 * `+refs/heads/main:refs/remotes/origin/main` and `origin/gh-pages` will never
 * exist no matter how often you fetch it — the first version of this script
 * died exactly there.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRANCH = 'gh-pages'
const dryRun = process.argv.includes('--dry-run')

const { name, version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))

function fail(message, hint) {
  console.error(`\nchannel: ${message}`)
  if (hint) console.error(`channel: ${hint}`)
  process.exit(1)
}

function run(cmd, args, { cwd = pkgDir, capture = false } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (r.error) fail(`could not run ${cmd} (${r.error.code})`)
  return r
}

function mustRun(cmd, args, opts, hint) {
  const r = run(cmd, args, opts)
  if (r.status !== 0) fail(`\`${cmd} ${args.join(' ')}\` failed`, hint)
  return r
}

console.log(`\n── ${name}@${version} → ${BRANCH}${dryRun ? ' (dry run)' : ''}`)

mustRun('git', ['fetch', 'origin', BRANCH], {}, `is there a ${BRANCH} branch on origin?`)

const work = mkdtempSync(join(tmpdir(), 'uniweb-runtime-channel-'))
try {
  // FETCH_HEAD, not origin/gh-pages — see the header.
  mustRun('git', ['worktree', 'add', '--detach', work, 'FETCH_HEAD'])

  mustRun(
    process.execPath,
    [
      join('scripts', 'publish-channel.mjs'),
      '--channel',
      work,
      // A version already in the channel is immutable, so re-running a release
      // step must be a no-op rather than an error.
      '--skip-if-published',
      ...(dryRun ? ['--dry-run'] : []),
    ],
    {},
    'the build may be incomplete — run `pnpm build && pnpm build:worker`'
  )

  const status = run('git', ['status', '--porcelain'], { cwd: work, capture: true })
  if (!status.stdout.trim()) {
    console.log(`channel: ${version} is already published — nothing to push.`)
    process.exit(0)
  }

  if (dryRun) {
    console.log(`\nchannel: [dry-run] would commit and push:\n${status.stdout}`)
    process.exit(0)
  }

  // `runtime/` is everything publish-channel.mjs writes. Named rather than
  // `-A` so this can never carry something else that happens to be in the
  // worktree.
  mustRun('git', ['add', 'runtime'], { cwd: work })
  mustRun('git', ['commit', '-m', `runtime v${version}`], { cwd: work })
  mustRun(
    'git',
    ['push', 'origin', `HEAD:${BRANCH}`],
    { cwd: work },
    `someone else pushed ${BRANCH} first — re-run \`pnpm channel:publish\`, it is idempotent`
  )

  console.log(`\nchannel: published ${version}`)
} finally {
  spawnSync('git', ['worktree', 'remove', '--force', work], { cwd: pkgDir, stdio: 'ignore' })
  rmSync(work, { recursive: true, force: true })
}
