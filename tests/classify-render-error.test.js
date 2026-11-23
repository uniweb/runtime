/**
 * What a failed render is called (`classifyRenderError`). The `type` is what callers branch on;
 * the `message` is what a developer reads in a build's report.
 *
 * ⛔ Until 2026-11-23 a hook error read "contains components with React hooks (renders
 * client-side)", as if hooks couldn't prerender. They can: the error means React was loaded
 * twice, or a hook was called outside a component.
 */
import { describe, it, expect } from 'vitest'
import { classifyRenderError } from '../src/ssr-renderer.js'

describe('classifyRenderError', () => {
  it('a hook error keeps its type, and names the likely cause rather than the hooks', () => {
    const r = classifyRenderError(new Error('Invalid hook call. Hooks can only be called inside of the body of a function component.'))
    expect(r.type).toBe('hooks')
    expect(r.message).toMatch(/two copies of React/)
    expect(r.message).toMatch(/Hooks prerender/)
    expect(r.message).not.toMatch(/contains components with React hooks/)
  })

  it('a component that resolved to null keeps its type', () => {
    expect(classifyRenderError(new Error('Element type is invalid: expected a string but got: null')).type).toBe('null-component')
  })

  it('anything else is unknown, with its own message', () => {
    expect(classifyRenderError(new Error('boom'))).toEqual({ type: 'unknown', message: 'boom' })
  })
})
