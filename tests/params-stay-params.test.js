/**
 * ⭐ A SECTION'S FRONTMATTER REACHES ITS COMPONENT AS `params`, AND ITS BODY AS `content` — and
 * neither is copied into the other, in the browser or in the prerender.
 *
 * ⛔ Until 2026-11-11 both renderers spread every frontmatter param over `content` as well. A param
 * named like a content field replaced the field: `items: 2` in the frontmatter turned the section's
 * items into the number 2, and the component's `.map` threw (or, with a guard, drew nothing), while
 * `uniweb inspect` showed the items and the param apart. A `title:` in the frontmatter replaced the
 * body's heading the same way.
 */
import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { initPrerender, renderLayout } from '../src/ssr-renderer.js'
import { initUniweb } from '../src/setup.js'
import Layout from '../src/components/Layout.jsx'

const h = React.createElement

// What the component was given, as text: the body's title and items, and the params of those names.
const Shows = ({ content, params }) => {
  const items = Array.isArray(content.items) ? content.items.map((item) => item.title).join(',') : `not a list: ${content.items}`
  return h('p', null, `title=${content.title}|items=${items}|params.title=${params.title}|params.items=${params.items}`)
}

const foundation = { default: { meta: { Shows: {} } }, Shows }

const text = (value) => [{ type: 'text', text: value }]
const heading = (level, value) => ({ type: 'heading', attrs: { level }, content: text(value) })
const paragraph = (value) => ({ type: 'paragraph', content: text(value) })

// `# From the body`, then two items: `###` straight after the title starts one.
const body = {
  type: 'doc',
  content: [heading(1, 'From the body'), heading(3, 'One'), paragraph('First.'), heading(3, 'Two'), paragraph('Second.')],
}

const site = {
  config: { name: 'T', defaultLanguage: 'en' },
  theme: {},
  layouts: {},
  pages: [
    {
      route: '/',
      isIndex: true,
      title: 'Home',
      sections: [{ type: 'Shows', content: body, params: { items: 2, title: 'From the frontmatter' } }],
    },
  ],
}

const RECEIVED = 'title=From the body|items=One,Two|params.title=From the frontmatter|params.items=2'

describe('a param named like a content field leaves the field as the body gave it', () => {
  it('in the prerender', () => {
    const website = initPrerender(structuredClone(site), foundation, []).activeWebsite
    website.setActivePage('/')
    expect(renderToString(renderLayout(website.getPage('/'), website))).toContain(RECEIVED)
  })

  it('in the browser', () => {
    const website = initUniweb({ content: { ...structuredClone(site), fetchedData: [] }, foundation }).activeWebsite
    website.setActivePage('/')
    expect(renderToString(h(Layout, { page: website.getPage('/'), website }))).toContain(RECEIVED)
  })
})
