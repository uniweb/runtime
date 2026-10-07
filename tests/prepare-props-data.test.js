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

  it('dev: says so for a concept block (```md:tag) under an undeclared key too', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sequence = [
      { type: 'concept_block', tag: 'faq', children: [] },
      { type: 'concept_block', tag: 'steps', children: [] },
    ]
    const block = makeBlock({ held: { faq: { items: [], sequence: [] } }, sequence, dev: true, type: 'Help' })
    prepareProps(block, { data: { steps: {} } }, null)
    const said = warn.mock.calls.map(([m]) => m).filter((m) => m.includes('concept block'))
    expect(said).toHaveLength(1)
    expect(said[0]).toMatch(/Help: the `faq` concept block is not in content\.data/)
  })

  it('CONTROL — silent outside dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const block = makeBlock({ held: { notes: {} }, sequence: [{ type: 'dataBlock', tag: 'notes', data: {} }], type: 'Quiet' })
    prepareProps(block, { data: {} }, null)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('⛔ no field defaults — ruled 2026-10-05', () => {
  // A foundation built before then still carries `schemas` in its meta — each declared key's
  // field defaults and `enum` — and the runtime filled a missing field from its `default` and
  // replaced a value its `enum` rejected. A record now reaches the component as it is.
  const STALE_META = {
    data: { posts: '@std/article' },
    schemas: {
      posts: {
        status: { type: 'string', default: 'published', enum: ['draft', 'published'] },
        featured: { type: 'bool', default: false },
        seo: { type: 'object', fields: { noindex: { type: 'bool', default: false } } },
      },
    },
  }

  it('a field the record lacks stays absent, nested ones included', () => {
    const { content } = prepareProps(makeBlock(), STALE_META, { posts: [{ title: 'A', seo: {} }] })
    expect(content.data.posts).toEqual([{ title: 'A', seo: {} }])
  })

  it('a value outside the enum reaches the component as written', () => {
    const { content } = prepareProps(makeBlock(), STALE_META, { posts: [{ title: 'A', status: 'scheduled' }] })
    expect(content.data.posts[0].status).toBe('scheduled')
  })

  it('a tagged block the section holds arrives as the author wrote it', () => {
    const block = makeBlock({ held: { api: { path: '/users' } } })
    const meta = { data: { api: null }, schemas: { api: { method: { type: 'string', default: 'GET' } } } }
    expect(prepareProps(block, meta).content.data.api).toEqual({ path: '/users' })
  })
})

// ⭐ A key declared `single: true` holds ONE record — the first of what filled it, or `null` (ruled
// 2026-10-07 [Diego]).
describe('prepareProps — a key declared single holds one record', () => {
  const meta = { data: { post: { schema: '@/post', single: true }, posts: '@/post' } }

  it('the first record of the list that filled it; a list key beside it is unchanged', () => {
    const { content } = prepareProps(makeBlock(), meta, { post: [{ slug: 'a' }, { slug: 'b' }], posts: [{ slug: 'a' }] })
    expect(content.data).toEqual({ post: { slug: 'a' }, posts: [{ slug: 'a' }] })
  })

  it('`null` for no record — an empty answer, and nothing delivered alike', () => {
    expect(prepareProps(makeBlock(), meta, { post: [], posts: [] }).content.data).toEqual({ post: null, posts: [] })
    expect(prepareProps(makeBlock(), meta, null).content.data).toEqual({ post: null, posts: null })
  })

  it('a value that is not a list is the record already — a data block holding it', () => {
    const block = makeBlock({ held: { post: { title: 'Held' } } })
    expect(prepareProps(block, meta, null).content.data.post).toEqual({ title: 'Held' })
  })

  it('a list the section holds — a static build\'s prerendered answer — gives its first, linked', () => {
    const block = makeBlock({ held: { post: [{ slug: 'a' }, { slug: 'b' }] } })
    block.website.entityStore.linkOwnRecords = (b) => {
      b.parsedContent.data = { ...b.parsedContent.data, post: b.parsedContent.data.post.map((r) => ({ ...r, $route: `/p/${r.slug}` })) }
    }
    expect(prepareProps(block, meta, null).content.data.post).toEqual({ slug: 'a', $route: '/p/a' })
  })

  it('the data handler sees the one record', () => {
    const seen = []
    globalThis.uniweb = { foundationConfig: { handlers: { data: (data) => { seen.push(data.post) } } } }
    try {
      prepareProps(makeBlock(), meta, { post: [{ slug: 'a' }] })
    } finally {
      delete globalThis.uniweb
    }
    expect(seen).toEqual([{ slug: 'a' }])
  })
})
