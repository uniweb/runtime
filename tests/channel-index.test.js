import { describe, it, expect } from 'vitest'
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

const pub = (index, version, extra = {}) =>
  addVersion(index, {
    version,
    published: '2026-08-05T00:00:00Z',
    files: ['a.js', 'b.js'],
    integrity: `sha256-${version}`,
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
    expect(d.versions['0.9.5'].files).toBe(i.versions['0.9.5'].files)
  })

  it('requires an integrity fingerprint — immutability has to be verifiable', () => {
    expect(() =>
      addVersion(fresh(), { version: '1.0.0', files: ['a.js'], integrity: null })
    ).toThrow(/integrity/)
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
    expect(doc.versions['0.9.7'].integrity).toBeTruthy() // and verify
  })
})
