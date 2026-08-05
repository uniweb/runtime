import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  addVersion,
  compareVersions,
  computeLatest,
  createIndex,
  deprecateVersion,
  parseIndex,
  parseVersion,
  serializeIndex
} from '../scripts/channel-index.js'

const H = (c) => c.repeat(64) // a syntactically valid lowercase-hex sha256

const pub = (index, version, extra = {}) =>
  addVersion(index, {
    version,
    published: '2026-08-05T00:00:00Z',
    files: {
      browser: [{ path: 'app/index.html', size: 10, contentType: 'text/html', sha256: H('a') }],
      isolate: [
        { path: 'worker-runtime.js', size: 20, contentType: 'text/javascript', sha256: H('b') }
      ]
    },
    integrity: { browser: `sha256-b-${version}`, isolate: `sha256-i-${version}` },
    ...extra
  })

const fresh = () => createIndex({ name: '@uniweb/runtime' })

describe('compareVersions', () => {
  it('compares numerically, not as strings', () => {
    // The bug a string sort produces, and it stays invisible until a minor or
    // patch reaches double digits — at which point `latest` silently goes
    // backwards.
    expect(compareVersions('0.9.10', '0.9.7')).toBe(1)
    expect(['0.9.10', '0.9.7', '0.10.0'].sort(compareVersions)).toEqual([
      '0.9.7',
      '0.9.10',
      '0.10.0'
    ])
  })

  it('ranks a prerelease below its release', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1)
  })

  it('refuses a non-version rather than sorting it arbitrarily', () => {
    expect(() => compareVersions('latest', '1.0.0')).toThrow(/Not a version/)
  })
})

describe('immutability — the invariant the channel exists for', () => {
  it('refuses to republish a version', () => {
    const i = pub(fresh(), '0.9.7')
    expect(() => pub(i, '0.9.7')).toThrow(/immutable/)
  })

  it('never mutates the index it was given', () => {
    const before = pub(fresh(), '0.9.7')
    const snapshot = serializeIndex(before)
    pub(before, '0.9.8')
    deprecateVersion(before, '0.9.7', { reason: 'x' })
    expect(serializeIndex(before)).toBe(snapshot)
  })

  it('carries identity fields through a deprecation untouched', () => {
    // Annotation, not mutation: what was published stays what was published.
    const i = pub(fresh(), '0.9.5')
    const d = deprecateVersion(i, '0.9.5', { reason: 'incoherent' })
    expect(d.versions['0.9.5'].published).toBe(i.versions['0.9.5'].published)
    expect(d.versions['0.9.5'].integrity).toBe(i.versions['0.9.5'].integrity)
    expect(d.versions['0.9.5'].files).toEqual(i.versions['0.9.5'].files)
  })

  it('requires an integrity fingerprint per group — immutability has to be verifiable', () => {
    expect(() =>
      addVersion(fresh(), {
        version: '1.0.0',
        files: {
          browser: [{ path: 'app/x.js', size: 1, contentType: 'text/javascript' }],
          isolate: [{ path: 'worker-runtime.js', size: 1, contentType: 'text/javascript' }]
        },
        integrity: { browser: 'sha256-b' } // isolate missing
      })
    ).toThrow(/integrity\.isolate/)
  })
})

describe('latest is derived, never asserted', () => {
  it('is the highest released version', () => {
    let i = pub(pub(pub(fresh(), '0.9.7'), '0.9.10'), '0.9.8')
    expect(i.latest).toBe('0.9.10')
  })

  it('steps BACK when the current latest is deprecated', () => {
    // The reason it is derived. A stored pointer would go on naming a version
    // we had just called poison.
    let i = pub(pub(fresh(), '0.9.6'), '0.9.7')
    expect(i.latest).toBe('0.9.7')
    i = deprecateVersion(i, '0.9.7', { reason: 'bad build' })
    expect(i.latest).toBe('0.9.6')
  })

  it('never picks a prerelease', () => {
    // Prereleases are published so they can be pinned deliberately, not fallen
    // into by anything asking for `latest`.
    const i = pub(pub(fresh(), '0.9.7'), '1.0.0-rc.1')
    expect(i.latest).toBe('0.9.7')
  })

  it('is null when nothing is usable, rather than the highest anyway', () => {
    expect(computeLatest(fresh())).toBe(null)
    const i = deprecateVersion(pub(fresh(), '0.9.5'), '0.9.5', { reason: 'x' })
    expect(i.latest).toBe(null)
  })
})

describe('deprecation', () => {
  it('requires a reason — "deprecated" with no why is not actionable', () => {
    const i = pub(fresh(), '0.9.5')
    expect(() => deprecateVersion(i, '0.9.5', {})).toThrow(/reason/)
  })

  it('records a superseded_by pointer, and refuses a dangling one', () => {
    let i = pub(pub(fresh(), '0.9.5'), '0.9.6')
    i = deprecateVersion(i, '0.9.5', { reason: 'incoherent', supersededBy: '0.9.6' })
    expect(i.versions['0.9.5'].deprecated).toEqual({
      reason: 'incoherent',
      supersededBy: '0.9.6'
    })
    expect(() =>
      deprecateVersion(i, '0.9.6', { reason: 'x', supersededBy: '9.9.9' })
    ).toThrow(/not a published version/)
  })

  it('cannot deprecate something never published', () => {
    expect(() => deprecateVersion(fresh(), '0.9.5', { reason: 'x' })).toThrow(
      /unpublished/
    )
  })
})

describe('parseIndex', () => {
  it('refuses an index from a newer publisher rather than rewriting it', () => {
    // Silently dropping fields a newer writer added is how an index stops
    // describing its channel.
    expect(() => parseIndex({ schema: 99, versions: {} })).toThrow(/schema 99/)
  })

  it('refuses an index belonging to a different channel', () => {
    expect(() =>
      parseIndex({ schema: 1, name: '@uniweb/other', versions: {} }, { name: '@uniweb/runtime' })
    ).toThrow(/is for '@uniweb\/other'/)
  })

  it('round-trips through serialize', () => {
    const i = deprecateVersion(pub(pub(fresh(), '0.9.5'), '0.9.7'), '0.9.5', {
      reason: 'incoherent'
    })
    expect(serializeIndex(parseIndex(serializeIndex(i)))).toBe(serializeIndex(i))
  })
})

describe('serialization is deterministic', () => {
  it('orders versions by precedence regardless of insertion order', () => {
    const a = pub(pub(pub(fresh(), '0.10.0'), '0.9.7'), '0.9.10')
    const b = pub(pub(pub(fresh(), '0.9.10'), '0.10.0'), '0.9.7')
    expect(serializeIndex(a)).toBe(serializeIndex(b))
    expect(Object.keys(JSON.parse(serializeIndex(a)).versions)).toEqual([
      '0.9.7',
      '0.9.10',
      '0.10.0'
    ])
  })

  it('emits the same bytes for the same state — a no-op publish shows no diff', () => {
    const i = pub(fresh(), '0.9.7')
    expect(serializeIndex(i)).toBe(serializeIndex(parseIndex(serializeIndex(i))))
  })
})

describe('the shape a consumer reads', () => {
  it('answers all three questions from one document', () => {
    let i = pub(pub(fresh(), '0.9.5'), '0.9.7')
    i = deprecateVersion(i, '0.9.5', {
      reason: 'incoherent — dist carried another version’s bytes',
      supersededBy: '0.9.7'
    })
    const doc = JSON.parse(serializeIndex(i))

    expect(doc.latest).toBe('0.9.7') //   which should I use
    expect(Object.keys(doc.versions)).toEqual(['0.9.5', '0.9.7']) // what exists
    expect(doc.versions['0.9.5'].deprecated.reason).toMatch(/incoherent/) // avoid
    expect(doc.versions['0.9.7'].integrity.browser).toBeTruthy() // and verify
    expect(doc.versions['0.9.7'].integrity.isolate).toBeTruthy()
  })
})

/**
 * The two halves go to different sinks, and until this was declared the split
 * was known only by convention — every consumer re-deriving "`app/` means
 * browser". The derivation was already being got wrong: the isolate half was
 * measured world-readable on a public asset domain, when nothing outside the
 * SSR isolate ever requests it.
 */
describe('the browser/isolate boundary is declared, not derived', () => {
  it('records both halves separately', () => {
    const i = pub(fresh(), '0.9.7')
    const v = JSON.parse(serializeIndex(i)).versions['0.9.7']
    expect(v.files.browser.map((f) => f.path)).toEqual(['app/index.html'])
    expect(v.files.isolate.map((f) => f.path)).toEqual(['worker-runtime.js'])
  })

  it('fingerprints each half separately, so one-half consumers can verify', () => {
    // A single digest over both would be uncheckable by a sink that takes only
    // the browser half — which is exactly what the blob store does.
    const v = JSON.parse(serializeIndex(pub(fresh(), '0.9.7'))).versions['0.9.7']
    expect(v.integrity.browser).not.toBe(v.integrity.isolate)
  })

  it('refuses a version that declares only one half', () => {
    // Not "no isolate files" — an unstated boundary. A version publishes both
    // halves or neither.
    expect(() =>
      addVersion(fresh(), {
        version: '1.0.0',
        files: {
          browser: [{ path: 'app/x.js', size: 1, contentType: 'text/javascript' }],
          isolate: []
        },
        integrity: { browser: 'sha256-b', isolate: 'sha256-i' }
      })
    ).toThrow(/files\.isolate/)
  })
})

/**
 * Every file states its own metadata, because the consumer that re-serves these
 * objects has to set a content type somewhere — and DERIVING it from a file
 * extension is the shape this lane has already paid for: `uniweb runtime
 * register` stores no `Cache-Control` on any object it uploads, and nothing
 * noticed, because object metadata shows in no listing and survives no
 * byte-level check. An integrity match says nothing about it.
 */
describe('file entries carry their own metadata', () => {
  it('requires path, size and contentType on every entry', () => {
    expect(() =>
      addVersion(fresh(), {
        version: '1.0.0',
        files: {
          browser: [{ path: 'app/x.js' }], // no size, no contentType
          isolate: [{ path: 'worker-runtime.js', size: 1, contentType: 'text/javascript' }]
        },
        integrity: { browser: 'sha256-b', isolate: 'sha256-i' }
      })
    ).toThrow(/needs \{ path, size, contentType \}/)
  })

  it('normalizes to exactly the declared fields, sorted by path', () => {
    const i = addVersion(fresh(), {
      version: '1.0.0',
      files: {
        browser: [
          {
            path: 'app/z.js',
            size: 2,
            contentType: 'text/javascript',
            sha256: H('c'),
            extra: 'dropped'
          },
          { path: 'app/a.js', size: 1, contentType: 'text/javascript', sha256: H('d') }
        ],
        isolate: [
          { path: 'worker-runtime.js', size: 3, contentType: 'text/javascript', sha256: H('e') }
        ]
      },
      integrity: { browser: 'sha256-b', isolate: 'sha256-i' }
    })
    const browser = JSON.parse(serializeIndex(i)).versions['1.0.0'].files.browser
    expect(browser.map((f) => f.path)).toEqual(['app/a.js', 'app/z.js'])
    expect(Object.keys(browser[0])).toEqual(['path', 'size', 'contentType', 'sha256'])
  })

  it('requires a lowercase-hex sha256 on every entry', () => {
    const bad = (sha256) => () =>
      addVersion(fresh(), {
        version: '1.0.0',
        files: {
          browser: [{ path: 'app/x.js', size: 1, contentType: 'text/javascript', sha256 }],
          isolate: [
            { path: 'worker-runtime.js', size: 1, contentType: 'text/javascript', sha256: H('a') }
          ]
        },
        integrity: { browser: 'sha256-b', isolate: 'sha256-i' }
      })

    expect(bad(undefined)).toThrow(/needs a lowercase-hex sha256/)
    expect(bad('sha256-' + H('a'))).toThrow(/needs a lowercase-hex sha256/) // bare hex, not prefixed
    expect(bad(H('A'))).toThrow(/needs a lowercase-hex sha256/) // uppercase
    expect(bad('abc')).toThrow(/needs a lowercase-hex sha256/) // truncated
  })

  /**
   * Invariant 2 in the one place it is easy to break by being helpful: a
   * version published before `sha256` existed must not GAIN the field when the
   * index is read and written again. `sha256` is absent from 0.9.7 and 0.9.8 in
   * the live channel and must stay absent.
   */
  it('never back-fills sha256 onto a version published without it', () => {
    const legacy = {
      schema: 1,
      name: '@uniweb/runtime',
      latest: '0.9.8',
      versions: {
        '0.9.8': {
          published: '2026-08-05T14:49:31Z',
          files: {
            browser: [{ path: 'public/app/manifest.json', size: 640, contentType: 'application/json' }],
            isolate: [{ path: 'internal/worker-runtime.js', size: 1319141, contentType: 'text/javascript' }]
          },
          integrity: { browser: 'sha256-b17c6c7c', isolate: 'sha256-01d028f7' }
        }
      }
    }
    const round = JSON.parse(serializeIndex(pub(parseIndex(legacy), '0.9.9')))
    const old = round.versions['0.9.8'].files.browser[0]
    expect(Object.keys(old)).toEqual(['path', 'size', 'contentType'])
    expect('sha256' in old).toBe(false)
    expect(round.versions['0.9.8'].integrity.browser).toBe('sha256-b17c6c7c')
    // …while the newly added version does carry it.
    expect(round.versions['0.9.9'].files.browser[0].sha256).toBe(H('a'))
  })
})

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFORMANCE VECTOR — the group digest construction
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The consumers of this index are a Rust service and a Cloudflare Worker;
 * neither can import the code above. A prose spec they must re-implement from is
 * where a hash construction goes wrong silently, so this pins it to a fixed
 * input with a known answer that any language can check itself against.
 *
 *   three files with ASCII contents "a", "b", "c"
 *
 *     a → ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb
 *     b → 3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d
 *     c → 2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6
 *
 *   sorted BY DIGEST → c, b, a   ← note: the REVERSE of path order
 *   joined with "\n", no trailing newline, hashed as UTF-8 text
 *
 *     sha256-5e54b010de6b14acfa6d459634775982e59708a0b727bdc247e64f971cfe506f
 *
 * ⭐ The vector is chosen so the digest order reverses the path order. An
 * implementation that sorts by path — the most natural wrong guess, since the
 * index lists files by path — produces a different answer and fails here rather
 * than in production.
 */
describe('digest construction', () => {
  const sha = (s) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex')

  const A = 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'
  const B = '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d'
  const C = '2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6'
  const EXPECTED = 'sha256-5e54b010de6b14acfa6d459634775982e59708a0b727bdc247e64f971cfe506f'

  // The published algorithm, restated independently of the publisher script so
  // the two must agree.
  const groupDigest = (contents) =>
    `sha256-${sha(contents.map((c) => sha(c)).sort().join('\n'))}`

  it('per-file digests are a plain sha256 of the bytes, lowercase hex', () => {
    expect(sha('a')).toBe(A)
    expect(sha('b')).toBe(B)
    expect(sha('c')).toBe(C)
  })

  it('sorts by DIGEST, not by path — and the vector proves the difference', () => {
    expect([A, B, C].sort()).toEqual([C, B, A])
    expect(groupDigest(['a', 'b', 'c'])).toBe(EXPECTED)
  })

  it('is independent of the order the files are listed in', () => {
    expect(groupDigest(['c', 'a', 'b'])).toBe(EXPECTED)
    expect(groupDigest(['b', 'c', 'a'])).toBe(EXPECTED)
  })

  it('does not collapse duplicates — two identical files contribute two entries', () => {
    expect(groupDigest(['a', 'a'])).not.toBe(groupDigest(['a']))
  })

  it('joins with LF and no trailing newline', () => {
    // The two most likely near-misses, both of which produce a plausible digest.
    const trailing = `sha256-${sha([A, B, C].sort().join('\n') + '\n')}`
    const crlf = `sha256-${sha([A, B, C].sort().join('\r\n'))}`
    expect(trailing).not.toBe(EXPECTED)
    expect(crlf).not.toBe(EXPECTED)
  })

  /**
   * What the group digest deliberately does NOT cover, stated as a test so it
   * is not mistaken for an oversight: it hashes contents alone, so the right
   * bytes written to the wrong keys pass. Per-file `sha256` is what binds a
   * path to its content.
   */
  it('does not bind paths — which is why per-file sha256 exists', () => {
    expect(groupDigest(['a', 'b'])).toBe(groupDigest(['b', 'a']))
  })
})
