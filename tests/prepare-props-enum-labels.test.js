/**
 * An enum written `{ value, label }` — as a foundation built before its build lowered it to values
 * still carries — keeps a value it lists and falls back from one it does not.
 */
import { describe, it, expect } from 'vitest'
import { applySchemas } from '../src/prepare-props.js'

const SCHEMAS = {
  posts: { status: { type: 'string', default: 'draft', enum: [{ value: 'draft', label: 'Draft' }, { value: 'live', label: 'Live' }] } },
}

describe('an enum of `{ value, label }` entries at render', () => {
  it('⭐ keeps a value it lists', () => {
    expect(applySchemas({ posts: [{ status: 'live' }] }, SCHEMAS).posts[0].status).toBe('live')
  })

  it('CONTROL — falls back from a value it does not list', () => {
    expect(applySchemas({ posts: [{ status: 'gone' }] }, SCHEMAS).posts[0].status).toBe('draft')
  })
})
