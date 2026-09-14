/**
 * `content.data` holds the keys a component declares, and nothing else (ruled 2026-09-14):
 * what the section holds under a key, else what the entity store delivered for it, else
 * `null`. ⛔ Until then every delivered key was merged in, and every tagged block kept.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { prepareProps } from '../src/prepare-props.js'
import { declaredKeys } from '@uniweb/core'

function makeBlock({ held = {}, sequence = [], foundationData = null, dev = false, type = 'Card' } = {}) {
  const website = {
    declaredKeys: (meta) => declaredKeys(meta?.data, foundationData),
    entityStore: { dev, linkOwnRecords: () => {} },
  }
  return { type, website, heldData: held, parsedContent: { data: { ...held }, sequence }, properties: {}, rawContent: {} }
}

afterEach(() => vi.restoreAllMocks())

describe('prepareProps — content.data from the declared keys', () => {
  it('each declared key: what the section holds, else what was delivered, else null', () => {
    const block = makeBlock({ held: { nav: [{ label: 'Home' }] } })
    const meta = { data: { nav: null, posts: '@/post', related: '@/post' } }
    const { content } = prepareProps(block, meta, { posts: [{ slug: 'a' }], other: [1] })
    expect(content.data).toEqual({ nav: [{ label: 'Home' }], posts: [{ slug: 'a' }], related: null })
  })

  it('⛔ an undeclared key reaches nothing — a delivered one, or a tagged block the section holds', () => {
    const block = makeBlock({ held: { quiz: { q: 1 } } })
    const { content } = prepareProps(block, { data: { posts: null } }, { posts: [], teams: [{ name: 'A' }] })
    expect(content.data).toEqual({ posts: [] })
  })

  it('a component with no `data:` receives its foundation\'s keys only', () => {
    const block = makeBlock({ foundationData: { profile: '@/profile' } })
    expect(prepareProps(block, null, { profile: [{ name: 'Ada' }] }).content.data).toEqual({ profile: [{ name: 'Ada' }] })
    expect(prepareProps(makeBlock(), null, { profile: [{ name: 'Ada' }] }).content.data).toEqual({})
  })

  it('`[]` is an answer and stays one; nothing delivered is `null`', () => {
    const block = makeBlock()
    expect(prepareProps(block, { data: { posts: null, teams: null } }, { posts: [] }).content.data).toEqual({ posts: [], teams: null })
  })

  it('a render rebuilds the data from its sources, never from the last render\'s', () => {
    const block = makeBlock()
    const meta = { data: { posts: null } }
    expect(prepareProps(block, meta, { posts: [{ slug: 'a' }] }).content.data.posts).toEqual([{ slug: 'a' }])
    expect(prepareProps(block, meta, null).content.data.posts).toBeNull()
  })

  it('the foundation\'s data handler sees the declared keys', () => {
    const seen = []
    globalThis.uniweb = { foundationConfig: { handlers: { data: (data) => { seen.push(Object.keys(data)) } } } }
    try {
      prepareProps(makeBlock({ foundationData: { profile: null } }), { data: { posts: null } }, { posts: [], extra: [] })
    } finally {
      delete globalThis.uniweb
    }
    expect(seen).toEqual([['posts', 'profile']])
  })

  it('dev: says once that a tagged block under an undeclared key did not reach the component', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sequence = [{ type: 'dataBlock', tag: 'quizzes', data: {} }, { type: 'dataBlock', tag: 'posts', data: [] }]
    const block = makeBlock({ held: { quizzes: {}, posts: [] }, sequence, dev: true, type: 'Lesson' })
    prepareProps(block, { data: { posts: null } }, null)
    prepareProps(block, { data: { posts: null } }, null)
    const said = warn.mock.calls.map(([m]) => m).filter((m) => m.includes('data block'))
    expect(said).toHaveLength(1)
    expect(said[0]).toMatch(/Lesson: the `quizzes` data block is not in content\.data/)
  })

  it('CONTROL — silent outside dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const block = makeBlock({ held: { notes: {} }, sequence: [{ type: 'dataBlock', tag: 'notes', data: {} }], type: 'Quiet' })
    prepareProps(block, { data: {} }, null)
    expect(warn).not.toHaveBeenCalled()
  })
})
