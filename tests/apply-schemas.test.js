import { describe, it, expect } from 'vitest'
import { applySchemas } from '../src/prepare-props.js'

// applySchemas applies data-schema field defaults to content.data. Schemas use
// the data-schema format: object → `fields`, array of objects →
// `items: { type: object, fields }`, inline picklist → `enum`. The rich-form
// (FormBlock) path is covered separately in apply-schemas-rich.test.js.
describe('applySchemas — data schemas', () => {
  it('returns an empty object for null/undefined data', () => {
    expect(applySchemas(null, {})).toEqual({})
    expect(applySchemas(undefined, {})).toEqual({})
  })

  it('returns data as-is when no schemas are provided', () => {
    const data = { 'nav-links': [{ label: 'Home' }] }
    expect(applySchemas(data, null)).toEqual(data)
    expect(applySchemas(data, undefined)).toEqual(data)
  })

  it('leaves a tag untouched when there is no matching schema', () => {
    const data = {
      'nav-links': [{ label: 'Home', href: '/' }],
      'other-data': { foo: 'bar' },
    }
    const schemas = { 'social-links': { platform: 'string' } }
    expect(applySchemas(data, schemas)).toEqual(data)
  })

  it('applies defaults to each item in an array value', () => {
    const data = {
      'nav-links': [
        { label: 'Home', href: '/' },
        { label: 'About', href: '/about' },
      ],
    }
    const schemas = {
      'nav-links': {
        type: { type: 'string', enum: ['plain', 'button'], default: 'plain' },
        target: { type: 'string', default: '_self' },
      },
    }
    expect(applySchemas(data, schemas)['nav-links']).toEqual([
      { label: 'Home', href: '/', type: 'plain', target: '_self' },
      { label: 'About', href: '/about', type: 'plain', target: '_self' },
    ])
  })

  it('does not override existing values', () => {
    const data = {
      'nav-links': [{ label: 'Docs', href: '/docs', type: 'button', target: '_blank' }],
    }
    const schemas = {
      'nav-links': {
        type: { type: 'string', default: 'plain' },
        target: { type: 'string', default: '_self' },
      },
    }
    expect(applySchemas(data, schemas)['nav-links']).toEqual([
      { label: 'Docs', href: '/docs', type: 'button', target: '_blank' },
    ])
  })

  it('preserves fields not described by the schema', () => {
    const data = {
      'nav-links': [{ label: 'Home', href: '/', customAttr: 'foo', anotherField: 123 }],
    }
    const schemas = { 'nav-links': { type: { type: 'string', default: 'plain' } } }
    expect(applySchemas(data, schemas)['nav-links']).toEqual([
      { label: 'Home', href: '/', customAttr: 'foo', anotherField: 123, type: 'plain' },
    ])
  })

  it('applies a schema to a single (non-array) object value', () => {
    const data = { settings: { theme: 'dark' } }
    const schemas = {
      settings: {
        showLogo: { type: 'bool', default: true },
        maxItems: { type: 'int', default: 10 },
      },
    }
    expect(applySchemas(data, schemas).settings).toEqual({
      theme: 'dark',
      showLogo: true,
      maxItems: 10,
    })
  })

  it('treats false and 0 as valid default values', () => {
    const data = { settings: {} }
    const schemas = {
      settings: {
        enabled: { type: 'bool', default: false },
        count: { type: 'int', default: 0 },
      },
    }
    expect(applySchemas(data, schemas).settings).toEqual({ enabled: false, count: 0 })
  })

  it('ignores bare-string field definitions (no default to apply)', () => {
    const data = { 'nav-links': [{ label: 'Home' }] }
    const schemas = {
      'nav-links': {
        href: 'string', // shorthand, no default
        type: { type: 'string', default: 'plain' },
      },
    }
    expect(applySchemas(data, schemas)['nav-links']).toEqual([{ label: 'Home', type: 'plain' }])
  })

  it('applies multiple schemas independently', () => {
    const data = {
      'nav-links': [{ label: 'Home', href: '/' }],
      social: { platform: 'twitter' },
    }
    const schemas = {
      'nav-links': { type: { type: 'string', default: 'plain' } },
      social: { showIcon: { type: 'bool', default: true } },
    }
    const result = applySchemas(data, schemas)
    expect(result['nav-links']).toEqual([{ label: 'Home', href: '/', type: 'plain' }])
    expect(result.social).toEqual({ platform: 'twitter', showIcon: true })
  })

  describe('enum validation', () => {
    it('resets a value not in the enum to the default', () => {
      const data = { nav: [{ label: 'X', type: 'bogus' }] }
      const schemas = { nav: { type: { type: 'string', enum: ['plain', 'button'], default: 'plain' } } }
      expect(applySchemas(data, schemas).nav).toEqual([{ label: 'X', type: 'plain' }])
    })

    it('keeps a value that is in the enum', () => {
      const data = { nav: [{ label: 'X', type: 'button' }] }
      const schemas = { nav: { type: { type: 'string', enum: ['plain', 'button'], default: 'plain' } } }
      expect(applySchemas(data, schemas).nav).toEqual([{ label: 'X', type: 'button' }])
    })
  })

  describe('nested fields', () => {
    it('applies defaults inside a nested object (fields)', () => {
      const data = { card: { title: 'My Card', meta: { author: 'John' } } }
      const schemas = {
        card: {
          meta: {
            type: 'object',
            fields: {
              author: 'string',
              date: { type: 'string', default: 'today' },
            },
          },
        },
      }
      expect(applySchemas(data, schemas).card).toEqual({
        title: 'My Card',
        meta: { author: 'John', date: 'today' },
      })
    })

    it('applies defaults to each element of an array of objects (items.fields)', () => {
      const data = {
        social: {
          links: [
            { platform: 'twitter', url: 'https://twitter.com/foo' },
            { platform: 'github', url: 'https://github.com/foo' },
          ],
        },
      }
      const schemas = {
        social: {
          links: {
            type: 'array',
            items: {
              type: 'object',
              fields: { icon: { type: 'string', default: 'default-icon' } },
            },
          },
        },
      }
      expect(applySchemas(data, schemas).social.links).toEqual([
        { platform: 'twitter', url: 'https://twitter.com/foo', icon: 'default-icon' },
        { platform: 'github', url: 'https://github.com/foo', icon: 'default-icon' },
      ])
    })

    it('leaves an array of scalar items untouched', () => {
      const data = { card: { tags: ['a', 'b'] } }
      const schemas = { card: { tags: { type: 'array', items: 'string' } } }
      expect(applySchemas(data, schemas).card).toEqual({ tags: ['a', 'b'] })
    })
  })
})
