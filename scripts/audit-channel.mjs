#!/usr/bin/env node

/**
 * Does the channel carry every version npm does?
 *
 *   node scripts/audit-channel.mjs <index.json>
 *
 * ## What this replaces, and why the shape changed
 *
 * The channel used to be built by a GitHub Action on tag push, so a failed run
 * left a version on npm with nothing in the channel and nobody watching. The
 * daily cron existed to retry that — it re-resolved the LATEST tag and rebuilt
 * it if the index was missing it.
 *
 * The release publishes the channel itself now (scripts/release-channel.mjs),
 * so there is nothing to retry: a failure is loud, in the release output, in
 * front of the person running it. What is still worth asking is the question
 * the cron was gesturing at — *is anything missing?* — and asking it directly
 * is both cheaper and strictly better:
 *
 *   - it needs no toolchain, no install, no build, and no standalone manifest
 *   - it sees EVERY gap, not just the newest tag (the retry could only ever
 *     fix the latest one, so an older hole stayed invisible forever)
 *
 * ## Only versions the channel could plausibly have
 *
 * npm carries releases older than the channel itself. Anything below the
 * earliest version in the index is legitimately absent, so the floor is read
 * from the index rather than hardcoded — it moves on its own if the channel is
 * ever rebuilt from a later point.
 *
 * ## ⚠️ Recovering a missing version is NOT a byte-exact rebuild
 *
 * Say so plainly rather than implying otherwise: the recovery is to check the
 * tag out in the development workspace, build, and run `pnpm channel:publish`.
 * That builds against the siblings the workspace links TODAY, not the ones
 * that release shipped with. Exact historical rebuilds went away with the
 * standalone manifest, deliberately — that manifest never pinned the right
 * versions anyway (it was regenerated after the release that tagged it, so it
 * always lagged by one round), so what was lost is the appearance of the
 * property, not the property.
 */

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const PACKAGE = '@uniweb/runtime'
const indexPath = process.argv[2]

if (!indexPath) {
  console.error('Usage: audit-channel.mjs <index.json>')
  process.exit(2)
}

/** [major, minor, patch]; null for anything that is not a plain release. */
const parse = (v) => {
  const parts = String(v).split('.').map(Number)
  return parts.length === 3 && parts.every(Number.isInteger) ? parts : null
}
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

const index = JSON.parse(readFileSync(indexPath, 'utf8'))
const inChannel = Object.keys(index.versions ?? {})
if (inChannel.length === 0) {
  console.error('audit: the channel index lists no versions at all')
  process.exit(1)
}

const npm = spawnSync('npm', ['view', PACKAGE, 'versions', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})
if (npm.status !== 0) {
  console.error(`audit: could not read ${PACKAGE} versions from npm\n${npm.stderr}`)
  process.exit(1)
}
const onNpm = JSON.parse(npm.stdout)

const releases = (list) => list.map((v) => ({ v, parts: parse(v) })).filter((x) => x.parts)
const channelReleases = releases(inChannel)
const floor = channelReleases.map((x) => x.parts).sort(compare)[0]

const missing = releases(onNpm)
  .filter((x) => compare(x.parts, floor) >= 0)
  .filter((x) => !index.versions[x.v])
  .map((x) => x.v)

// The reverse is not a fault — a channel version npm never had would be odd,
// but it is not a gap in delivery, so it is reported and does not fail.
const extra = channelReleases.map((x) => x.v).filter((v) => !onNpm.includes(v))

console.log(`audit: ${PACKAGE} — ${inChannel.length} in the channel, floor ${floor.join('.')}`)
if (extra.length) console.log(`audit: in the channel but not on npm: ${extra.join(', ')}`)

if (missing.length === 0) {
  console.log('audit: every published version since the floor is in the channel')
  process.exit(0)
}

console.error(`\naudit: ${missing.length} version(s) on npm are MISSING from the channel:`)
for (const v of missing) console.error(`  ${PACKAGE}@${v}`)
console.error(
  '\nRecover one by checking that tag out in the development workspace, then:' +
    '\n  pnpm build && pnpm build:worker && pnpm channel:publish' +
    '\n(built against the siblings the workspace links today — see this file’s header)'
)
process.exit(1)
