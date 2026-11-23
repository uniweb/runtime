/**
 * A page opened at a section is scrolled there before its web fonts may have loaded. Text in a fallback
 * font wraps differently, so a stuck header can change height once the fonts arrive, and the section
 * lands off its place: it is scrolled to once more, unless the visitor has scrolled since.
 */
import { describe, it, expect, vi } from 'vitest'
import { realignAfterFonts } from '../src/hooks/useLinkInterceptor.js'

function setup(status = 'loading') {
  let loaded
  const doc = { fonts: { status, ready: new Promise((done) => { loaded = done }) } }
  const listeners = {}
  const win = {
    addEventListener: (name, fn) => { listeners[name] = fn },
    removeEventListener: (name) => { delete listeners[name] },
  }
  const element = { isConnected: true, scrollIntoView: vi.fn() }
  return { doc, win, element, listeners, load: () => { loaded(); return doc.fonts.ready } }
}

describe('realignAfterFonts', () => {
  it('scrolls to the section again once the fonts have loaded', async () => {
    const { doc, win, element, load } = setup()
    realignAfterFonts(element, doc, win)
    expect(element.scrollIntoView).not.toHaveBeenCalled()
    await load()
    await Promise.resolve()
    expect(element.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto' })
  })

  it('leaves the visitor where they scrolled to', async () => {
    const { doc, win, element, listeners, load } = setup()
    realignAfterFonts(element, doc, win)
    listeners.wheel()
    await load()
    await Promise.resolve()
    expect(element.scrollIntoView).not.toHaveBeenCalled()
  })

  it('CONTROL — with the fonts already loaded, does nothing', async () => {
    const { doc, win, element, listeners } = setup('loaded')
    realignAfterFonts(element, doc, win)
    expect(Object.keys(listeners)).toHaveLength(0)
    await Promise.resolve()
    expect(element.scrollIntoView).not.toHaveBeenCalled()
  })
})
