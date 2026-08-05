#!/usr/bin/env node
/**
 * Publish this runtime build into a versioned distribution channel.
 *
 *   node scripts/publish-channel.mjs --channel <dir> [--dry-run]
 *
 * `--channel` is a checkout of the branch the static host serves (e.g.
 * `gh-pages`). The script writes:
 *
 *   <channel>/runtime/index.json     ← what exists, what is latest, what is poison
 *   <channel>/runtime/<version>/…    ← this build's delivery artifacts
 *
 * ── What gets published, and why not all of `dist/` ──
 *
 * The DELIVERY set: `worker-runtime.js`, `shims/*`, and `app/**` minus
 * sourcemaps. That is the same set `uniweb runtime register` uploads and the
 * same set the npm tarball ships (`files: !dist/app/**\/*.map`). Three
 * producers, one set — a sourcemap is dev-only, and this bucket is public.
 *
 * ── Two halves, two sinks, and the index says which is which ──
 *
 * `browser` (`app/**`) is fetched by a visitor over a URL. `isolate`
 * (`worker-runtime.js` + `shims/*`) is read by the SSR isolate through a
 * storage binding and is **never requested over a URL** — it is internal.
 *
 * They are grouped in the index because until now the split was known only by
 * convention, re-derived by every consumer from "`app/` means browser", and
 * already got wrong: the isolate half was measured world-readable on a public
 * asset domain. Fingerprints are per group for the same reason — the halves
 * land in different sinks, so a consumer holding one half can still verify it.
 *
 * `dist/ssr.js` is deliberately absent: it is a MODULE, reached by
 * `import '@uniweb/runtime/ssr'`, and belongs to the npm package. This channel
 * carries the artifacts a host SERVES, which are assets — nothing here is
 * addressable by `exports`, which is exactly why they fit an asset host better
 * than a module registry.
 *
 * ── Immutability, enforced twice ──
 *
 * A version already in the index, or already on disk, is refused. Two checks
 * rather than one because they fail differently: the index is the record, the
 * directory is the reality, and a channel where those disagree is worse than
 * either failure alone.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { addVersion, parseIndex, serializeIndex } from './channel-index.js'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const DIST = join(pkgRoot, 'dist')

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? null : args[i + 1]
}
const has = (name) => args.includes(`--${name}`)

const channelDir = flag('channel')
const dryRun = has('dry-run')
const layout = flag('layout') || 'split'

if (!channelDir) {
  console.error('Usage: publish-channel.mjs --channel <dir> [--layout flat|split] [--dry-run]')
  process.exit(2)
}
if (!['flat', 'split'].includes(layout)) {
  console.error(`Unknown --layout '${layout}'. Expected 'flat' or 'split'.`)
  process.exit(2)
}

/**
 * Where a file lands, which is the only thing the two layouts differ on.
 *
 *   split   <version>/public/app/**       <version>/internal/worker-runtime.js · shims/*   (default)
 *   flat    <version>/app/**              <version>/worker-runtime.js · shims/*
 *
 * ⚠️ **The prefix is self-description, NOT enforcement** — and that correction
 * came from the consumer. On the target host an object-store custom domain
 * serves the WHOLE store; there is no per-prefix ACL to deny `/internal/` on,
 * so a prefix alone leaves the objects world-readable at their new paths.
 *
 * What actually enforces it is **two stores**: a public one with a domain, and
 * an internal one with none, reachable only through a binding. Enforcement by
 * *absence of an address* rather than by rule — and it costs nothing.
 *
 * The split is still the default, for what it genuinely buys: each half is
 * self-describing, a mis-stocked object is obvious on sight, and a stocker can
 * route the two halves to two stores without consulting the index. `flat`
 * remains for a consumer whose key layout already assumes it.
 *
 * The index records the paths a version ACTUALLY published, so a consumer never
 * has to know which layout produced them — it reads `files.browser` and fetches
 * exactly those. Integrity is unaffected either way: it hashes contents, not
 * locations.
 */
function destPath(rel, group) {
  if (layout === 'flat') return rel
  return join(group === 'browser' ? 'public' : 'internal', rel)
}

const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
const { name, version } = pkg

/** Every file under `dir`, as paths relative to it. */
function walk(dir, base = dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full, base) : [relative(base, full)]
  })
}

/**
 * The delivery set. Kept as one list so the three producers cannot drift: if
 * this changes, `runtime register`'s filter and the package's `files` change
 * with it.
 */
function deliveryFiles() {
  const isolate = []
  if (existsSync(join(DIST, 'worker-runtime.js'))) isolate.push('worker-runtime.js')
  for (const f of walk(join(DIST, 'shims'))) isolate.push(join('shims', f))

  const browser = []
  for (const f of walk(join(DIST, 'app'))) {
    if (f.endsWith('.map')) continue // dev-only; the build now emits them unreferenced
    browser.push(join('app', f))
  }
  return { browser: browser.sort(), isolate: isolate.sort() }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/**
 * Content type, stated by the producer rather than derived by each consumer.
 *
 * Object metadata is invisible to every check a stocker runs — it shows in no
 * listing and survives no byte comparison, so an integrity match says nothing
 * about it. This lane has already paid for that once: `uniweb runtime register`
 * stores no `Cache-Control` on any object it uploads, and nothing noticed.
 *
 * An unknown extension THROWS rather than falling back to
 * `application/octet-stream`. A wrong content-type on a JS module is a page
 * that does not run, discovered by a visitor; a failed publish is discovered
 * here.
 */
const CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
}
function contentTypeOf(rel) {
  const ext = rel.slice(rel.lastIndexOf('.'))
  const ct = CONTENT_TYPES[ext]
  if (!ct) {
    throw new Error(
      `No content type known for '${ext}' (${rel}). Add it to CONTENT_TYPES rather ` +
        `than letting a consumer guess — a wrong type on a module is a page that does not run.`
    )
  }
  return ct
}

/** A file's published metadata: where it lands, how big, and what it is. */
function describe(rel, group) {
  return {
    path: destPath(rel, group),
    size: statSync(join(DIST, rel)).size,
    contentType: contentTypeOf(rel)
  }
}

/**
 * Content fingerprint: sha256 over the SORTED, newline-joined per-file hashes.
 *
 * Same algorithm as the foundation freshness digest, deliberately — one digest
 * concept in the framework rather than two. Sorting makes it order-independent;
 * hashing contents (not names) keeps content-hashed filenames from perturbing
 * it.
 */
function integrityOf(files) {
  const perFile = files.map((rel) => sha256(readFileSync(join(DIST, rel)))).sort()
  return `sha256-${sha256(perFile.join('\n'))}`
}

const files = deliveryFiles()
const allFiles = [...files.browser, ...files.isolate]
if (!files.browser.length || !files.isolate.length) {
  console.error(
    `Incomplete build in ${DIST} (browser: ${files.browser.length}, isolate: ${files.isolate.length}).\n` +
      `Run \`pnpm build && pnpm build:worker\` — a version publishes both halves or neither.`
  )
  process.exit(1)
}

const indexPath = join(channelDir, 'runtime', 'index.json')
const versionDir = join(channelDir, 'runtime', version)

const index = parseIndex(
  existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null,
  { name }
)

// Immutability, checked against BOTH the record and the reality.
if (index.versions[version]) {
  console.error(
    `Refusing to publish: ${version} is already in the channel index.\n` +
      `Published versions are immutable — bump the version instead.`
  )
  process.exit(1)
}
if (existsSync(versionDir)) {
  console.error(
    `Refusing to publish: ${versionDir} already exists on disk but is NOT in the index.\n` +
      `The channel's record and its contents disagree; resolve that by hand before publishing.`
  )
  process.exit(1)
}

// Fingerprinted per group, not once overall: the two halves land in DIFFERENT
// sinks, so a consumer that takes only one half can still verify what it got.
// A single digest over both would be uncheckable by either of them alone.
let integrity, next
try {
  integrity = {
    browser: integrityOf(files.browser),
    isolate: integrityOf(files.isolate)
  }
// The index carries the paths this version ACTUALLY published, so a consumer
// fetches what it reads and never has to know which layout produced them.
  next = addVersion(index, {
    version,
    published: new Date().toISOString(),
    files: {
      browser: files.browser.map((f) => describe(f, 'browser')),
      isolate: files.isolate.map((f) => describe(f, 'isolate'))
    },
    integrity
  })
} catch (err) {
  // A clean message, not a stack: every throw reachable here names something a
  // human has to fix in this repo (an unknown extension, a malformed entry).
  console.error(`Cannot publish ${version}: ${err.message}`)
  process.exit(1)
}

console.log(`${name} → channel  (layout: ${layout})`)
console.log(`  version   ${version}`)
console.log(`  browser   ${files.browser.length} file(s)  ${integrity.browser}`)
console.log(`  isolate   ${files.isolate.length} file(s)  ${integrity.isolate}   (internal — read via binding, not a URL)`)
console.log(`  latest    ${next.latest}${next.latest === version ? ' (this build)' : ''}`)

if (dryRun) {
  console.log('\n--dry-run: nothing written.')
  console.log(serializeIndex(next))
  process.exit(0)
}

mkdirSync(versionDir, { recursive: true })
for (const [group, list] of Object.entries(files)) {
  for (const rel of list) {
    const dest = join(versionDir, destPath(rel, group))
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(join(DIST, rel), dest)
  }
}
mkdirSync(dirname(indexPath), { recursive: true })
writeFileSync(indexPath, serializeIndex(next))

console.log(`\nWrote ${allFiles.length} file(s) to runtime/${version}/ and updated index.json`)
