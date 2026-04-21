import { describe, it, expect } from 'vitest'
import { applySchemas } from '../src/prepare-props.js'

describe('applySchemas — rich form schemas', () => {
  it('applies field defaults for a non-composite rich schema', () => {
    const schemas = {
      'side-content': {
        fields: [
          { id: 'for', type: 'select', default: 'scholar' },
          { id: 'department', type: 'text' },
        ],
      },
    }
    const data = { 'side-content': { department: 'CS' } }
    expect(applySchemas(data, schemas)).toEqual({
      'side-content': { department: 'CS', for: 'scholar' },
    })
  })

  it('applies defaults per row in a composite schema', () => {
    const schemas = {
      stats: {
        isComposite: true,
        childSchema: {
          fields: [
            { id: 'number', type: 'text' },
            { id: 'text', type: 'text', default: 'label' },
          ],
        },
      },
    }
    const data = { stats: [{ number: '42' }, { number: '100', text: 'custom' }] }
    expect(applySchemas(data, schemas)).toEqual({
      stats: [
        { number: '42', text: 'label' },
        { number: '100', text: 'custom' },
      ],
    })
  })

  it('recurses into nested type:form fields', () => {
    const schemas = {
      side: {
        fields: [
          {
            id: 'items',
            type: 'form',
            childSchema: {
              fields: [
                { id: 'title', type: 'text' },
                { id: 'date', type: 'text', default: '2026-01-01' },
              ],
            },
          },
        ],
      },
    }
    const data = { side: { items: [{ title: 'A' }, { title: 'B', date: '2025-12-31' }] } }
    expect(applySchemas(data, schemas)).toEqual({
      side: {
        items: [
          { title: 'A', date: '2026-01-01' },
          { title: 'B', date: '2025-12-31' },
        ],
      },
    })
  })

  it('recurses into type:nestedObject with inline fields', () => {
    const schemas = {
      hero: {
        fields: [
          {
            id: 'link',
            type: 'nestedObject',
            fields: [
              { id: 'label', type: 'text', default: 'Read more' },
              { id: 'href', type: 'text' },
            ],
          },
        ],
      },
    }
    const data = { hero: { link: { href: '/x' } } }
    expect(applySchemas(data, schemas)).toEqual({
      hero: { link: { href: '/x', label: 'Read more' } },
    })
  })

  it('honors childCollection: unwraps the array, applies defaults, re-wraps', () => {
    const schemas = {
      group: {
        isComposite: true,
        childCollection: 'items',
        childSchema: {
          fields: [{ id: 'label', type: 'text', default: 'Untitled' }],
        },
      },
    }
    const data = { group: { items: [{ label: 'A' }, {}] } }
    expect(applySchemas(data, schemas)).toEqual({
      group: { items: [{ label: 'A' }, { label: 'Untitled' }] },
    })
  })

  it('leaves unknown tags untouched', () => {
    const schemas = { stats: { fields: [{ id: 'n', type: 'text' }] } }
    const data = { stats: { n: '1' }, other: [{ foo: 'bar' }] }
    expect(applySchemas(data, schemas).other).toEqual([{ foo: 'bar' }])
  })

  it('passes simple schema through the existing keyed-object path', () => {
    const schemas = {
      'nav-links': { type: { type: 'select', default: 'plain' }, label: 'string' },
    }
    const data = { 'nav-links': [{ label: 'Home' }] }
    expect(applySchemas(data, schemas)).toEqual({
      'nav-links': [{ label: 'Home', type: 'plain' }],
    })
  })

  it('leaves condition-hidden fields in place at runtime — conditions are an editor concern', () => {
    // Components that care about condition-based visibility can branch on
    // the controller field themselves. The runtime stays out of it so it
    // doesn't erase data authors may want back after toggling.
    const schemas = {
      side: {
        fields: [
          { id: 'for', type: 'select' },
          { id: 'department', type: 'text', condition: { for: 'scholar' } },
        ],
      },
    }
    const data = { side: { for: 'news', department: 'CS-stale' } }
    expect(applySchemas(data, schemas)).toEqual({
      side: { for: 'news', department: 'CS-stale' },
    })
  })
})
