/**
 * The runtime distribution channel index.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A runtime is published as versioned, immutable directories on a static host:
 *
 *   runtime/index.json      ← this file's output
 *   runtime/<version>/…     ← worker-runtime.js, shims/*, app/**
 *
 * `index.json` answers the three questions a consumer has, which are one
 * question wearing three hats: **what versions exist**, **which should I use**,
 * and **which must I avoid**. A package registry splits those across registry
 * metadata and a per-version API; here they are one document, one GET, no
 * registry client and no auth.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INVARIANTS, AND WHY EACH IS ENFORCED HERE RATHER THAN PROMISED
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. **A published version is immutable.** Re-publishing a version throws. The
 *    artifacts at `<version>/` are what a consumer key-looks-up by version and
 *    may have pinned months ago; changing them under that name is the defect
 *    this whole channel exists to make impossible.
 *
 * 2. **The index is append-or-annotate.** A version can be *added*, and an
 *    existing one can be *annotated* (deprecated). Its identity fields —
 *    `published`, `files`, `integrity` — can never change. Enforced by
 *    construction: no function here rewrites them.
 *
 * 3. **`latest` is DERIVED, never asserted.** It is recomputed on every
 *    mutation, so deprecating the current latest moves it back automatically
 *    rather than leaving a pointer at a version we just called poison. A field
 *    a human sets is a field that drifts from what it describes.
 *
 * 4. **Integrity is recorded, so immutability is verifiable rather than
 *    trusted.** A CI that can overwrite an artifact could also rewrite the index
 *    to say the overwrite was fine — so the index carries a fingerprint of what
 *    was published, and a consumer can check the bytes it fetched against it.
 *    That turns "our CI promises" into "you can verify".
 *
 *    ⛔ **A digest is useless unless its construction is STATED.** A consumer
 *    that guesses gets one of two failures, and both are worse than no check: a
 *    wrong guess that never matches is dead weight that gets disabled, or one
 *    that is skipped on mismatch is a check reporting success while verifying
 *    nothing. So the two digests are specified here, exactly, in the file that
 *    defines the format — not in a message someone has to have read.
 *
 *    **Per-file — `files[group][i].sha256`.** Lowercase hex `sha256` of that
 *    file's bytes. Verifiable as each file arrives, and it names the file that
 *    is wrong. It also binds **path → content**, which the group digest below
 *    deliberately does not.
 *
 *    **Per-group — `integrity[group]`.** Pins the SET:
 *
 *        h[i]   = lowercase_hex(sha256(bytes of file i))   for each file in the group
 *        sorted = sort(h)          ← over the HEX STRINGS, not over paths
 *        joined = "\n".join(sorted)          ← LF, and NO trailing newline
 *        digest = "sha256-" + lowercase_hex(sha256(utf8(joined)))
 *
 *    Note what that does and does not say. It hashes **contents, not
 *    locations**, and sorts, so it is independent of the order `files[group]`
 *    lists them and of content-hashed filenames changing. Duplicates are NOT
 *    collapsed — two identical files contribute two entries. And because paths
 *    are absent from it, the group digest alone would accept the right bytes
 *    written to the wrong keys; that is the hole `sha256` per file closes.
 *
 *    ⚠️ **`sha256` per file is absent from versions published before it
 *    existed** (0.9.7, 0.9.8) and can never be added to them — invariant 2. Its
 *    absence is therefore a normal state, not a malformed index: verify the
 *    group digest, which every version has. This is the one field a consumer
 *    should tolerate missing; it is optional metadata, not half of a two-half
 *    contract like `files.browser`/`files.isolate`.
 *
 *    A conformance vector for both, so an implementation in another language can
 *    check itself against a known answer, is in `tests/channel-index.test.js`
 *    ("digest construction").
 *
 * 5. **Serialization is deterministic.** Stable key order and sorted versions,
 *    so re-running a publish produces byte-identical output and a diff shows
 *    only what actually changed.
 *
 * 6. **`path` is where the file IS. The prefix carries no meaning — do not
 *    parse it for one.** The publisher takes `--layout split|flat`, and the two
 *    differ ONLY in the prefix they write:
 *
 *        split (default)   public/app/**        internal/worker-runtime.js · internal/shims/*
 *        flat              app/**               worker-runtime.js · shims/*
 *
 *    Group membership — `files.browser` vs `files.isolate` — is the
 *    instruction. `public/` and `internal/` are self-description, and (see
 *    `publish-channel.mjs`) they are not enforcement either.
 *
 *    ⛔ **So a consumer must not recognise, require, or refuse a prefix.** A
 *    check that hardcodes `public/` rejects a `flat` channel whose bytes,
 *    index and digests are all correct — a hard failure that reads like data
 *    corruption but is a parsing assumption. This is not hypothetical: a
 *    consumer built its fixture around the `flat` shape, passed its own suite
 *    against a document nobody had published, and then added exactly that
 *    refusal.
 *
 *    **If you need a group-relative name, use `groupRelativePaths(files,
 *    group)`.** The group's ANCHOR (invariant 7) sits at the group root, so the
 *    directory containing it IS the layout prefix — exactly, with no heuristic.
 *    Both layouts collapse to identical names: browser to `manifest.json`,
 *    `index.html`, `assets/…`, `_importmap/…`; isolate to `worker-runtime.js`,
 *    `shims/…`. No layout to know, nothing to update if a third ever exists.
 *
 *    ⛔ **Do NOT reach for the longest common directory prefix.** It is the
 *    obvious implementation, it agrees with the anchored rule on every group
 *    that has an anchor, and it is wrong in a way its own output cannot show:
 *    a group whose files all sit below the group root has a common prefix that
 *    eats a real directory — `public/app/assets/{a,b}.js` yields `a.js`,
 *    `b.js`. A single-file group is the same failure at its most reachable,
 *    since one path carries no evidence about where the prefix ends. Anchoring
 *    has exactly one answer where the heuristic has a plausible one.
 *
 *    ⚠️ **The index deliberately does NOT record which layout produced it.** A
 *    `layout` field is a field consumers would branch on, which reintroduces
 *    precisely the coupling this invariant removes. The paths are the answer.
 *
 * 7. **Every group carries a root-level anchor, and a version without one is
 *    refused.**
 *
 *        browser  →  manifest.json        isolate  →  worker-runtime.js
 *
 *    Each is the group's principal artifact — the browser half is unusable
 *    without the manifest naming its entry, preloads and import map; the
 *    isolate half is unusable without the SSR bundle, `shims/*` being its
 *    peers. So a group missing its anchor is not a smaller delivery set, it is
 *    a **broken one**, and the same reasoning as the empty-group refusal
 *    applies: it is an unstated boundary rather than "fewer files".
 *
 *    This is enforced rather than assumed because the publisher could not
 *    previously state it: `worker-runtime.js` was collected only `if
 *    (existsSync(...))`, so a package built without its SSR step published a
 *    shims-only isolate half with no complaint — the exact group that has no
 *    second way to notice, since a consumer cross-checking the browser anchor
 *    has nothing equivalent to check here.
 *
 *    ⭐ The anchor does double duty: it makes the group verifiably complete,
 *    AND it is what bounds invariant 6's prefix rule, since a file at the group
 *    root means the common directory prefix cannot reach past it. **A consumer
 *    may rely on both.**
 *
 * Pure functions over plain data — no I/O, no dependencies. The publishing
 * script owns the filesystem; this owns the rules.
 */

export const INDEX_SCHEMA_VERSION = 1

/**
 * The index's own statement of how its digests are built — invariant 4, in the
 * document rather than only in this file.
 *
 * ⭐ **Why it is worth a field: `index.json` is served at a URL.** A consumer can
 * hold the whole document and never see this repo, and two independent
 * implementers proved that is not hypothetical — both derived the shape
 * correctly, both failed to derive the digest, and both refused to guess rather
 * than shipping a check that verifies nothing. One of them tried eight
 * constructions. A line in the document they already have costs nothing.
 *
 * ⚠️ **Additive, and `schema` must NOT be bumped to carry it.** An unknown key
 * is ignored by a conforming reader; `schema: 2` is a statement that the reader
 * no longer understands the document, and a correct consumer *refuses* rather
 * than best-effort-parsing fields it may not know. Shipped together, the refusal
 * wins and the key is never read. Both consumers confirmed the key is inert at
 * every level (top, per-version, per-file) with tests, on that condition.
 *
 * Prose, not a parseable grammar: it is a pointer for a human implementing the
 * check, and the executable statement is `tests/channel-index.test.js`'s
 * conformance vector.
 */
export const INTEGRITY_ALGORITHM =
  'per-file: sha256 of the file bytes, lowercase hex. ' +
  'per-group: sha256-<lowercase hex of sha256(utf8(  ' +
  'the per-file hex digests, SORTED as strings, joined with LF, no trailing newline  ' +
  '))>. Hashes contents only — never paths, sizes or names; duplicates are not collapsed.'

/**
 * The two halves of a runtime, and they go to different places.
 *
 *   browser — `app/**`. Fetched by a visitor's browser over a URL. **Public.**
 *   isolate — `worker-runtime.js` + `shims/*`. Read by the SSR isolate through
 *             a storage binding, **never over a URL**. Internal.
 *
 * ⛔ **This grouping is a boundary declaration, not a convenience.** It held
 * until now only because every consumer independently knew that `app/` means
 * browser — three consumers, three derivations, no statement anywhere. The
 * derivation was already being got wrong: the isolate half (1.3 MB of SSR
 * bundle and shims) was measured world-readable on a public asset domain, where
 * nothing outside the SSR isolate ever requests it.
 *
 * Declaring membership once, at the producer, is the cheapest place to say it —
 * every consumer reads this one document, and none of them has to know what
 * `app/` means.
 */
export const DELIVERY_GROUPS = ['browser', 'isolate']

/**
 * Each group's principal artifact, at the group root — invariant 7.
 *
 * A group without its anchor is broken rather than small, and the anchor is
 * also what stops invariant 6's prefix rule from over-stripping. Enforced in
 * `addVersion`, so it binds any publisher rather than only the one in this
 * repo.
 */
export const GROUP_ANCHORS = {
  browser: 'manifest.json',
  isolate: 'worker-runtime.js'
}

/**
 * Parse a semver-ish version into comparable parts.
 * Returns null for anything that is not `MAJOR.MINOR.PATCH[-prerelease]`.
 */
export function parseVersion(v) {
  if (typeof v !== 'string') return null
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v.trim())
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null
  }
}

/**
 * Compare two versions. `-1` / `0` / `1`, semver precedence.
 *
 * Numeric comparison per component — `0.9.10` is above `0.9.7`, which a string
 * sort gets backwards, and a channel that picked `latest` by string sort would
 * do so silently the first time a minor reached double digits.
 *
 * A prerelease sorts BELOW its release (`1.0.0-rc.1` < `1.0.0`).
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) throw new Error(`Not a version: ${!pa ? a : b}`)

  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1
  }
  if (pa.prerelease === pb.prerelease) return 0
  // A release outranks any prerelease of the same version.
  if (pa.prerelease === null) return 1
  if (pb.prerelease === null) return -1

  // Both prereleases: dot-separated identifiers, numeric before alphanumeric.
  const ia = pa.prerelease.split('.')
  const ib = pb.prerelease.split('.')
  for (let i = 0; i < Math.max(ia.length, ib.length); i++) {
    const x = ia[i]
    const y = ib[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1
    } else if (nx !== ny) {
      return nx ? -1 : 1 // numeric identifiers rank below alphanumeric
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/**
 * Group-relative names for one group's files — invariants 6 and 7, as code.
 *
 * **The group's ANCHOR defines the prefix: the anchor sits at the group root,
 * so the directory containing it is exactly the layout prefix.** Strip that
 * from every path and the result is identical whether the version was published
 * `split` or `flat`. Exported so the rule is normative rather than advisory — a
 * consumer needing stable names gets a correct implementation instead of a
 * prefix to guess at.
 *
 * ⭐ **This deliberately does NOT use the longest common directory prefix**,
 * which is the obvious implementation and is wrong in a way that cannot be seen
 * in its output. A group whose files all sit below the group root has a common
 * prefix that eats a real directory:
 *
 *     ['public/app/assets/a.js', 'public/app/assets/b.js']  →  ['a.js', 'b.js']
 *
 * Nothing about those names looks wrong, and a single-file group is the same
 * failure at its most reachable — one path carries no evidence about where the
 * prefix ends. Anchoring removes the guess: with the anchor there is exactly one
 * answer, and without it there is none, so this **throws** rather than
 * returning a plausible one. (Both implementations of this rule refuse here —
 * agreed with the channel's other consumer, whose refusal was right and whose
 * question prompted the fix.)
 *
 * Takes `files[group]` (records) or a plain array of path strings.
 *
 * @param {Array<string|{path:string}>} files
 * @param {'browser'|'isolate'} group
 * @returns {string[]} names, in the input's order
 */
export function groupRelativePaths(files, group) {
  const anchor = GROUP_ANCHORS[group]
  if (!anchor) {
    throw new Error(
      `groupRelativePaths: unknown group '${group}'. Expected one of: ${DELIVERY_GROUPS.join(', ')}.`
    )
  }
  const paths = files.map((f) => (typeof f === 'string' ? f : f.path))
  if (!paths.length) return []

  // The anchor nearest the root wins, so a same-named file deeper in the tree
  // cannot be mistaken for it.
  const candidates = paths
    .filter((p) => p === anchor || p.endsWith(`/${anchor}`))
    .sort((a, b) => a.length - b.length)
  if (!candidates.length) {
    throw new Error(
      `groupRelativePaths: the '${group}' group has no '${anchor}' at its root, so its ` +
        `layout prefix cannot be determined. Refusing to guess — a plausible-looking wrong ` +
        `answer here becomes keys nothing ever looks up. Got: ${paths.join(', ')}`
    )
  }
  const prefix = candidates[0].slice(0, candidates[0].length - anchor.length)

  const stray = paths.find((p) => !p.startsWith(prefix))
  if (stray) {
    throw new Error(
      `groupRelativePaths: '${stray}' is outside the '${group}' group's root '${prefix}'. ` +
        `Every file in a group shares one prefix; this one does not.`
    )
  }
  return paths.map((p) => p.slice(prefix.length))
}

/** An empty channel index. */
export function createIndex({ name }) {
  if (!name) throw new Error('createIndex: `name` is required')
  return {
    schema: INDEX_SCHEMA_VERSION,
    name,
    integrityAlgorithm: INTEGRITY_ALGORITHM,
    latest: null,
    versions: {}
  }
}

/**
 * Validate and normalize an index read from disk.
 *
 * Refuses an unknown schema version rather than guessing: a newer publisher may
 * have written fields this one would silently drop on the next write, and a
 * silent drop is how an index stops describing the channel.
 */
export function parseIndex(json, { name } = {}) {
  if (json == null) return createIndex({ name })
  const obj = typeof json === 'string' ? JSON.parse(json) : json
  if (obj.schema !== INDEX_SCHEMA_VERSION) {
    throw new Error(
      `Channel index schema ${obj.schema} is not ${INDEX_SCHEMA_VERSION}. ` +
        `Refusing to rewrite an index this publisher does not understand.`
    )
  }
  if (name && obj.name && obj.name !== name) {
    throw new Error(`Channel index is for '${obj.name}', not '${name}'.`)
  }
  return {
    schema: INDEX_SCHEMA_VERSION,
    name: obj.name || name,
    // Restated on every write rather than carried through: it describes THIS
    // publisher's construction, and a stale string would be worse than none.
    // Safe to add to an existing index — it is not a per-version identity
    // field, so invariant 2 is untouched.
    integrityAlgorithm: INTEGRITY_ALGORITHM,
    latest: obj.latest ?? null,
    versions: { ...(obj.versions || {}) }
  }
}

/**
 * The version a consumer should use: the highest **released, non-deprecated**
 * version. Prereleases never become `latest` — they are published so they can
 * be pinned deliberately, not fallen into.
 *
 * Returns null when the channel has nothing usable, which is a real state (a
 * fresh channel, or every version deprecated) and must not be confused with the
 * highest version.
 */
export function computeLatest(index) {
  const usable = Object.entries(index.versions)
    .filter(([, meta]) => !meta.deprecated)
    .map(([v]) => v)
    .filter((v) => parseVersion(v)?.prerelease === null)
  if (!usable.length) return null
  return usable.sort(compareVersions).at(-1)
}

/**
 * Add a newly published version. Returns a NEW index; never mutates.
 *
 * Throws if the version is already present — that is invariant 1, and it is the
 * single most important line in this file. A publisher that overwrites a
 * version breaks every consumer that pinned it, silently, at a time of its own
 * choosing.
 */
export function addVersion(index, { version, published, files, integrity }) {
  if (!parseVersion(version)) throw new Error(`Not a version: ${version}`)
  if (index.versions[version]) {
    throw new Error(
      `Version ${version} is already published and versions are immutable. ` +
        `Bump the version rather than republishing.`
    )
  }
  // Both halves are checked BEFORE any single file is, so the more fundamental
  // error wins. Validating group-by-group would report a missing `sha256` on
  // the first browser file to someone whose actual mistake was omitting the
  // isolate half entirely — a per-file complaint pointing away from a
  // structural error.
  for (const group of DELIVERY_GROUPS) {
    if (!Array.isArray(files?.[group]) || !files[group].length) {
      throw new Error(
        `addVersion(${version}): 'files.${group}' must be a non-empty array. ` +
          `Every version declares both halves — a missing one is not "no files", ` +
          `it is an unstated boundary.`
      )
    }
    if (!integrity?.[group]) {
      throw new Error(`addVersion(${version}): 'integrity.${group}' is required.`)
    }
  }
  for (const group of DELIVERY_GROUPS) {
    for (const f of files[group]) {
      // Every entry states its own metadata. A consumer re-serving these objects
      // has to set content-type somewhere, and DERIVING it from a file extension
      // is the shape that already bit this lane: `runtime register` stores no
      // Cache-Control on any of its objects, and object metadata shows in no
      // listing and survives no byte-level check — an integrity match says
      // nothing about it. Stated once by the producer, it cannot be derived
      // differently by two stockers.
      if (!f?.path || typeof f.size !== 'number' || !f.contentType) {
        throw new Error(
          `addVersion(${version}): every file in '${group}' needs { path, size, contentType }. ` +
            `Got: ${JSON.stringify(f)}`
        )
      }
      // Required on new versions, and deliberately not back-fillable onto old
      // ones (invariant 2). A consumer that can verify each file as it arrives
      // fails on the file rather than on the group of 15 — and it is the only
      // thing binding a path to its content, since the group digest hashes
      // contents alone.
      if (!/^[0-9a-f]{64}$/.test(f.sha256 || '')) {
        throw new Error(
          `addVersion(${version}): '${f.path}' needs a lowercase-hex sha256 of its bytes. ` +
            `Got: ${JSON.stringify(f.sha256)}`
        )
      }
    }
  }
  // Invariant 7, last: a malformed entry is a more basic problem than a missing
  // anchor, and reporting "no manifest.json" to someone whose real mistake is a
  // dropped `size` points them away from it. Checked on group-RELATIVE names so
  // it holds under any layout — the anchor is a position within the group, not
  // a literal path.
  for (const group of DELIVERY_GROUPS) {
    // One implementation of the rule: if a consumer could not derive this
    // group's names, the version must not publish. The helper's refusal IS the
    // invariant, so there is no second copy here to drift from it.
    try {
      groupRelativePaths(files[group], group)
    } catch (err) {
      throw new Error(
        `addVersion(${version}): ${err.message} ` +
          `That artifact is the group's principal one — a group without it is broken, not ` +
          `merely smaller.`
      )
    }
  }
  const next = {
    ...index,
    versions: {
      ...index.versions,
      [version]: {
        published: published || new Date().toISOString(),
        files: {
          browser: sortFiles(files.browser),
          isolate: sortFiles(files.isolate)
        },
        integrity: { browser: integrity.browser, isolate: integrity.isolate }
      }
    }
  }
  next.latest = computeLatest(next)
  return next
}

/**
 * Mark a version deprecated. Annotation, not mutation: identity fields are
 * carried through untouched.
 *
 * `latest` is recomputed, so deprecating the current latest steps it back to
 * the highest remaining usable version rather than leaving consumers pointed at
 * something we just declared poison.
 */
export function deprecateVersion(index, version, { reason, supersededBy } = {}) {
  const existing = index.versions[version]
  if (!existing) throw new Error(`Cannot deprecate unpublished version ${version}.`)
  if (!reason) throw new Error(`deprecateVersion(${version}): a 'reason' is required.`)
  if (supersededBy && !index.versions[supersededBy]) {
    throw new Error(`supersededBy ${supersededBy} is not a published version.`)
  }
  const next = {
    ...index,
    versions: {
      ...index.versions,
      [version]: {
        ...existing,
        deprecated: { reason, ...(supersededBy ? { supersededBy } : {}) }
      }
    }
  }
  next.latest = computeLatest(next)
  return next
}

/**
 * Deterministic JSON. Versions sorted by precedence (oldest first) and keys in
 * a fixed order, so a re-publish that changes nothing produces an identical
 * file and a diff shows only real change.
 */
/**
 * Files sorted by path, normalized to exactly the declared fields.
 *
 * `sha256` is carried only when present: `addVersion` requires it, but this
 * must not synthesize an `undefined` key onto an entry that predates it, or a
 * re-serialized old version would gain a field — which invariant 2 forbids.
 */
function sortFiles(list) {
  return [...list]
    .map(({ path, size, contentType, sha256 }) => ({
      path,
      size,
      contentType,
      ...(sha256 ? { sha256 } : {})
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

export function serializeIndex(index) {
  const versions = {}
  for (const v of Object.keys(index.versions).sort(compareVersions)) {
    const m = index.versions[v]
    versions[v] = {
      published: m.published,
      files: { browser: m.files.browser, isolate: m.files.isolate },
      integrity: { browser: m.integrity.browser, isolate: m.integrity.isolate },
      ...(m.deprecated ? { deprecated: m.deprecated } : {})
    }
  }
  return `${JSON.stringify(
    {
      schema: index.schema,
      name: index.name,
      integrityAlgorithm: index.integrityAlgorithm || INTEGRITY_ALGORITHM,
      latest: index.latest,
      versions
    },
    null,
    2
  )}\n`
}
