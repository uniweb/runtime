/**
 * The theme's font links reach a page the browser renders from a bare shell.
 *
 * A built page and a prerendered page carry them in `<head>`, behind `FONT_LINKS_MARKER`.
 * A host that serves the shell alone carries neither, and until 2026-10-27 the browser
 * added the theme's CSS and never its fonts — measured on a backend-hosted site whose
 * `theme.yml` imports Google Fonts: no font loaded, every heading in Georgia.
 */
import { describe, it, expect } from 'vitest'
import { FONT_LINKS_MARKER } from '@uniweb/theming'
import { injectFontLinks } from '../src/font-links.js'

/** Enough of a document for the helper: a head whose HTML grows as it is told to. */
function fakeDocument(headHtml = '') {
  return {
    head: {
      innerHTML: headHtml,
      insertAdjacentHTML(position, html) {
        if (position !== 'beforeend') throw new Error(`unexpected position ${position}`)
        this.innerHTML += html
      },
    },
  }
}

const links = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces&display=swap">'

describe('injectFontLinks', () => {
  it('⭐ adds the theme’s links to a shell that has none, behind the marker', () => {
    const doc = fakeDocument('<meta charset="UTF-8"><title>Site</title>')
    expect(injectFontLinks({ links }, doc)).toBe(true)
    expect(doc.head.innerHTML).toContain(`${FONT_LINKS_MARKER}\n${links}`)
  })

  it('leaves a built or prerendered page alone — it carries them already', () => {
    const doc = fakeDocument(`<title>Site</title>\n    ${FONT_LINKS_MARKER}\n${links}\n`)
    const before = doc.head.innerHTML
    expect(injectFontLinks({ links }, doc)).toBe(false)
    expect(doc.head.innerHTML).toBe(before)
  })

  it('adds them once, however often boot runs', () => {
    const doc = fakeDocument()
    injectFontLinks({ links }, doc)
    injectFontLinks({ links }, doc)
    expect(doc.head.innerHTML.split(FONT_LINKS_MARKER)).toHaveLength(2)
  })

  it('does nothing for a theme that imports no fonts, or where there is no document', () => {
    const doc = fakeDocument('<title>Site</title>')
    expect(injectFontLinks({}, doc)).toBe(false)
    expect(injectFontLinks(undefined, doc)).toBe(false)
    expect(injectFontLinks({ links }, null)).toBe(false)
    expect(doc.head.innerHTML).toBe('<title>Site</title>')
  })
})
