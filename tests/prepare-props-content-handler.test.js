/**
 * `handlers.content` is called `(data, block)` and returns the section's raw content transformed —
 * a ProseMirror document — or null for no change. ⛔ Until 2026-10-05 any truthy result was
 * re-parsed, so the natural no-op `(x) => x` returned the DATA, which `parseContent` took as
 * content already parsed: the section lost its title and items, and `content.data.data`
 * pointed back at `content.data`. Only a document is re-parsed now; anything else is ignored,
 * and said once per handler.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { prepareProps } from '../src/prepare-props.js'
import { Block, declaredKeys } from '@uniweb/core'

const heading = (text) => ({
  type: 'doc',
  content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text }] }],
})

function makeBlock() {
  const block = Object.create(Block.prototype)
  Object.assign(block, {
    type: 'Team',
    website: { declaredKeys: (meta) => declaredKeys(meta?.data), entityStore: { linkOwnRecords: () => {} } },
    heldData: {},
    rawContent: heading('Our team'),
    parsedContent: { title: 'Our team', paragraphs: [], items: [], sequence: [], data: {} },
    properties: {},
  })
  return block
}

const META = { data: { team: '@/member' } }
const DATA = { team: [{ name: 'Ada' }] }

function render(handler) {
  globalThis.uniweb = { foundationConfig: { handlers: { content: handler } } }
  try {
    return prepareProps(makeBlock(), META, DATA).content
  } finally {
    delete globalThis.uniweb
  }
}

afterEach(() => vi.restoreAllMocks())

describe('handlers.content — only a document is re-parsed', () => {
  it('⛔ `(x) => x` — returning the data it was given — leaves the section as it was', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const content = render((data) => data)
    expect(content.title).toBe('Our team')
    expect(Object.keys(content.data)).toEqual(['team'])
    expect(() => JSON.stringify(content.data)).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/returned the data it was given, not a ProseMirror document/)
  })

  it('ignores any other result that is not a document — a reshaped object, an array, a string', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const result of [{ title: 'Replaced' }, [heading('x')], 'text']) {
      const content = render(() => result)
      expect(content.title).toBe('Our team')
    }
  })

  it('says it once per handler, not once per section', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handler = (data) => data
    render(handler)
    render(handler)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('CONTROL — a document is re-parsed, bare or wrapped as `{ doc }`, and keeps the data', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bare = render(() => heading('Our people'))
    expect(bare.title).toBe('Our people')
    expect(bare.data).toEqual({ team: [{ name: 'Ada' }] })
    expect(render(() => ({ doc: heading('Wrapped') })).title).toBe('Wrapped')
    expect(warn).not.toHaveBeenCalled()
  })

  it('CONTROL — null and the raw content itself are no change, and silent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(render(() => null).title).toBe('Our team')
    expect(render((data, block) => block.rawContent).title).toBe('Our team')
    expect(warn).not.toHaveBeenCalled()
  })
})
