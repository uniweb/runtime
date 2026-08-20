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
 * ⚠️ **The argument this replaces, recorded so it is not re-derived.** The old
 * design had a runner publish from an extracted npm tarball, so the channel
 * carried "exactly the bytes npm shipped" rather than relying on two builds
 * agreeing at the same version. That held while npm shipped these artifacts.
 * It no longer does — `files` is `src` + `dist/ssr.js`, and `dist/ssr.js` is
 * deliberately NOT in the channel, so the two sets do not intersect and there
 * is nothing left for a local build to disagree with.
 *
 * ⛔ This paragraph used to say `publish-channel.mjs`'s `--from` block "still
 * explains" the retired argument — i.e. it described a stale comment instead of
 * fixing it, and the stale comment then survived two more rounds of work in this
 * file. Both are corrected now. **If you catch a comment describing another
 * comment as out of date, fix the other comment.**
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
 * catch-all refspec; a working clone need not. A clone made with
 * `--single-branch` has a refspec of literally
 * `+refs/heads/main:refs/remotes/origin/main`, so `origin/gh-pages` will never
 * exist there no matter how often you fetch it — the first version of this
 * script died exactly that way. `FETCH_HEAD` works under either refspec.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRANCH = 'gh-pages'
const dryRun = process.argv.includes('--dry-run')

/**
 * ⛔ A network step must be able to FAIL. Left unbounded it HANGS instead, and
 * a hang here is worse than an error by a wide margin.
 *
 * Measured 2026-08-18: `git fetch origin gh-pages` — the first line of
 * `publish()`, and the first thing this script does after printing its header —
 * stalled indefinitely mid-release. Nothing rescued it, at any layer:
 *
 *   - `ssh` sends no keepalives by default (`ServerAliveInterval 0`), so it
 *     never notices a half-open connection and never gives up
 *   - `git` has no transport timeout for SSH at all
 *   - `spawnSync` had no `timeout` here
 *   - and `git` prints nothing until the remote answers, so a stall is
 *     indistinguishable from progress — there was no output to read
 *
 * The release ran it between `pnpm publish` and the tag push, so ^C left npm
 * holding a version whose artifacts were not in the channel and whose tag was
 * never pushed. **A failure at this point is already handled** — the caller
 * warns and carries on to push the tag, and this script is idempotent, so the
 * whole recovery is re-running it. Converting the hang into a failure is
 * therefore the entire fix.
 *
 * Two bounds, because they catch different things and neither covers the other:
 * `ssh` keepalives end a connection whose peer went away (~60s), while the
 * `spawnSync` timeout is the outer backstop for a `git` that is stuck for some
 * other reason, or a remote that answers just often enough to look alive.
 */
const NET_TIMEOUT_MS = Number(process.env.CHANNEL_NET_TIMEOUT_MS || 180_000)

/**
 * Appended, never assigned over: `ssh` takes the FIRST occurrence of a
 * duplicated `-o`, so anything already in `GIT_SSH_COMMAND` still wins.
 * (Verified against OpenSSH 10.2 with `ssh -G -o X=11 -o X=99`.) Inert for an
 * HTTPS remote, which never runs `ssh` — NET_TIMEOUT_MS covers that case.
 */
const SSH_KEEPALIVE = '-o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o ConnectTimeout=20'
const netEnv = () => ({
  ...process.env,
  GIT_SSH_COMMAND: `${process.env.GIT_SSH_COMMAND || 'ssh'} ${SSH_KEEPALIVE}`,
})

const { name, version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))

/**
 * ⛔ Failure THROWS; it must never `process.exit()`.
 *
 * This script holds a git worktree, and `process.exit()` skips `finally`. The
 * leak is not a temp directory — it is a REGISTERED worktree that outlives the
 * run and accumulates one entry in `git worktree list` per invocation, pointing
 * at a path the OS will eventually delete underneath it. Caught by reading
 * `git worktree list` after the first dry run of this file, which had exited
 * through the most common path of all: "already published, nothing to do".
 */
class ChannelError extends Error {
  constructor(message, hint) {
    super(message)
    this.hint = hint
  }
}

function fail(message, hint) {
  throw new ChannelError(message, hint)
}

/** `net: true` for anything that talks to origin — see NET_TIMEOUT_MS. */
function run(cmd, args, { cwd = pkgDir, capture = false, net = false } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    ...(net ? { timeout: NET_TIMEOUT_MS, killSignal: 'SIGKILL', env: netEnv() } : {}),
  })
  // ETIMEDOUT is the bound above firing, not a broken command — say which,
  // because the generic branch below reads as "git is not installed".
  if (r.error?.code === 'ETIMEDOUT') {
    fail(
      `\`${cmd} ${args.join(' ')}\` got no answer in ${NET_TIMEOUT_MS / 1000}s`,
      'the network stalled — re-run `pnpm channel:publish`, it is idempotent (raise CHANNEL_NET_TIMEOUT_MS on a slow link)'
    )
  }
  if (r.error) fail(`could not run ${cmd} (${r.error.code})`)
  return r
}

function mustRun(cmd, args, opts, hint) {
  const r = run(cmd, args, opts)
  if (r.status !== 0) fail(`\`${cmd} ${args.join(' ')}\` failed`, hint)
  return r
}

console.log(`\n── ${name}@${version} → ${BRANCH}${dryRun ? ' (dry run)' : ''}`)

/** Everything that can fail. Returns; never exits — see ChannelError. */
function publish(work) {
  mustRun('git', ['fetch', 'origin', BRANCH], { net: true }, `is there a ${BRANCH} branch on origin?`)
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
    return
  }

  if (dryRun) {
    console.log(`\nchannel: [dry-run] would commit and push:\n${status.stdout}`)
    return
  }

  // `index.json` + `<version>/` is everything publish-channel.mjs writes — it
  // publishes to the branch ROOT (no package-name prefix; see that file's
  // header). Named rather than `-A` so this can never carry something else that
  // happens to be in the worktree, which is why the move to the root did not
  // cost this property: the script already knows the version.
  mustRun('git', ['add', '--', 'index.json', version], { cwd: work })
  mustRun('git', ['commit', '-m', `runtime v${version}`], { cwd: work })
  mustRun(
    'git',
    ['push', 'origin', `HEAD:${BRANCH}`],
    { cwd: work, net: true },
    `someone else pushed ${BRANCH} first — re-run \`pnpm channel:publish\`, it is idempotent`
  )

  console.log(`\nchannel: published ${version}`)
}

const work = mkdtempSync(join(tmpdir(), 'uniweb-runtime-channel-'))
try {
  publish(work)
} catch (err) {
  if (!(err instanceof ChannelError)) throw err
  console.error(`\nchannel: ${err.message}`)
  if (err.hint) console.error(`channel: ${err.hint}`)
  process.exitCode = 1
} finally {
  // DEREGISTER, not just delete: `git worktree remove` does both, where an
  // `rmSync` alone leaves the registration pointing at a vanished path.
  spawnSync('git', ['worktree', 'remove', '--force', work], { cwd: pkgDir, stdio: 'ignore' })
  rmSync(work, { recursive: true, force: true })
}
