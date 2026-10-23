import { describe, it, expect, vi, afterEach } from 'vitest'
import { decodeData } from '../src/setup.js'

// `decodeData` reads one element; a stub of `document` is all it needs.
const withData = (textContent, type = 'application/json') => {
  globalThis.document = { getElementById: (id) => (id === '__DATA__' ? { textContent, type } : null) }
}

describe('decodeData — the payload a host serves', () => {
  const saved = globalThis.document
  afterEach(() => {
    globalThis.document = saved
    vi.restoreAllMocks()
  })

  it('reads plain JSON, `<` escaped the way JSON allows inside a script', async () => {
    withData('{"content":{"text":"\\u003c!-- note --\\u003e"}}')
    expect(await decodeData()).toEqual({ content: { text: '<!-- note -->' } })
  })

  it('says a payload that does not parse is not valid JSON, rather than leaving it to read as absent', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // `<\!--`: an escape JS strings accept and JSON does not — measured on a host, 2026-10-23.
    withData('{"content":{"text":"<\\!-- note -->"}}')
    expect(await decodeData()).toBeNull()
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0][0]).toMatch(/^\[Runtime\] __DATA__ is not valid JSON, so the site cannot start: /)
  })

  it('CONTROL — a page with no payload is quiet', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.document = { getElementById: () => null }
    expect(await decodeData()).toBeNull()
    expect(error).not.toHaveBeenCalled()
  })
})
