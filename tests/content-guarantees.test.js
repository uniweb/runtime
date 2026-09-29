/**
 * What reaches a component's `content` — `guaranteeContentStructure` builds it key by
 * key, so a key the parser delivers and this leaves out never reaches a component.
 *
 * ⛔ `tables` was left out until 2026-09-29: the parser delivered it, `math` — its
 * twin — arrived, and a component declaring `tables` got nothing. An entry's `insets`
 * was left out the same way. The seam through the real reader and parser is guarded
 * in `_contracts/content-reaches-the-component.test.js`; these pin the object here.
 */
import { describe, it, expect } from 'vitest'
import { guaranteeContentStructure } from '../src/prepare-props.js'

const image = { url: '/photo.jpg', alt: 'Photo' }
const video = { src: '/clip.mp4' }

describe('what a component receives', () => {
  it('content.media — the section’s media in the order written, each with its kind', () => {
    const media = [{ ...video, kind: 'video' }, { ...image, kind: 'image' }, { refId: 'inset_0', kind: 'inset' }]
    const c = guaranteeContentStructure({ media, images: [image], videos: [video], insets: [{ refId: 'inset_0' }] })
    expect(c.media).toEqual(media)
    // …beside the arrays it does not replace.
    expect(c.images).toEqual([image])
    expect(c.videos).toEqual([video])
  })

  it('an entry’s own media, and its own insets', () => {
    const c = guaranteeContentStructure({
      items: [{ media: [{ refId: 'inset_1', kind: 'inset' }], insets: [{ refId: 'inset_1' }] }, {}],
    })
    expect(c.items[0].media).toEqual([{ refId: 'inset_1', kind: 'inset' }])
    expect(c.items[0].insets).toEqual([{ refId: 'inset_1' }])
    expect(c.items[1].media).toEqual([])
    expect(c.items[1].insets).toEqual([])
  })

  it('content.media is always there', () => {
    expect(guaranteeContentStructure({}).media).toEqual([])
    expect(guaranteeContentStructure(null).media).toEqual([])
  })

  it('content.tables, when the section has one — as content.math', () => {
    const table = { rows: [], attrs: {} }
    const c = guaranteeContentStructure({ tables: [table], math: [{ latex: 'x^2' }] })
    expect(c.tables).toEqual([table])
    expect(c.math).toHaveLength(1)
    expect(guaranteeContentStructure({ tables: [] })).not.toHaveProperty('tables')
  })

  it('an entry’s own tables', () => {
    const c = guaranteeContentStructure({ items: [{ tables: [{ rows: [], attrs: {} }] }] })
    expect(c.items[0].tables).toHaveLength(1)
  })
})
