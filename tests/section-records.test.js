/**
 * ⭐ WHAT A PAGE'S SECTIONS SHOWED FROM RECORDS — `render(…, { sectionData: true }).sections`, which a
 * page's Markdown carries after each section (`renderPageMarkdown`, `@uniweb/projections`).
 *
 * Run against a real Website, foundation and render, the way a host and the static build run them:
 * the page's data step (`loadPageData`), then its render with the entries it carries. What a section
 * showed is only the render's to know, so each case here is one a rule over the content alone gets
 * wrong: a key filled under another name, one record of a set, a tagged block, a failed fetch, a
 * layout area's records, and records the page carries that no section of it shows.
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { initPrerender } from '../src/ssr-renderer.js'
import { loadPageData } from '../src/load-page-data.js'
import { createPageRenderer } from '../src/page-renderer.js'

const h = React.createElement

const TIERS = [
  { $name: 'basic', title: 'Basic', price: 148 },
  { $name: 'pro', title: 'Pro', price: 298 },
]
const MEMBERS = [{ $name: 'ada', name: 'Ada' }]
const ARTICLES = [
  { $name: 'a', title: 'A post', body: 'Full' },
  { $name: 'b', title: 'B post', body: 'More' },
]

const list = (key) => ({ content }) => h('ul', null, (content.data[key] || []).map((r) => h('li', { key: r.$name }, r.title ?? r.name)))

const foundation = {
  default: {
    meta: {
      Plans: { data: { tiers: '@/tier' } },
      TierChip: { data: { tiers: '@/tier' } },
      Compare: { data: { comparison: null, tiers: '@/tier' } },
      // declares its key under another name: the section's fetch of `members` fills it by its schema
      Team: { data: { team: '@/member' } },
      Featured: { data: { tier: { schema: '@/tier', single: true } } },
      Broken: { data: { missing: null } },
      Nav: { data: { menu: null } },
      Plain: {},
      ArticleBody: { data: { article: { schema: '@/article', single: true } } },
      Related: { data: { related: '@/article' } },
      // shows the page's record whole
      WholeBody: { data: { article: { schema: '@/article', single: true, whole: true } } },
      Ghost: { data: { tiers: '@/tier' } }, // declared, and not in the foundation's code
    },
  },
  Plans: list('tiers'),
  TierChip: () => h('span', null, 'chip'),
  Compare: () => h('table', null),
  Team: list('team'),
  Featured: ({ content }) => h('p', null, content.data.tier?.title ?? 'none'),
  Broken: () => h('p', null, 'broken'),
  Nav: list('menu'),
  Plain: () => h('p', null, 'plain'),
  ArticleBody: ({ content }) => h('article', null, content.data.article?.title ?? 'none'),
  Related: list('related'),
  WholeBody: ({ content }) => h('article', null, content.data.article?.text ?? 'none'),
}

const doc = (...nodes) => ({ type: 'doc', content: nodes })
const heading = (text) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
const dataBlock = (tag, data) => ({ type: 'dataBlock', attrs: { tag, language: 'yaml', data } })
const inset = (component) => ({ type: 'paragraph', content: [{ type: 'inset_ref', attrs: { component } }] })
const section = (type, stableId, over = {}) => ({ type, stableId, content: doc(heading(stableId)), params: {}, ...over })

function site({ pages = [] } = {}) {
  return {
    config: {
      name: 'T',
      defaultLanguage: 'en',
      queries: {
        tiers: { schema: '@/tier', path: '/data/tiers.json' },
        members: { schema: '@/member', path: '/data/members.json' },
        articles: { schema: '@/article', path: '/data/articles.json' },
      },
    },
    theme: {},
    layouts: {
      default: {
        header: { route: '/layout/header', sections: [section('Nav', 'nav', { fetch: { path: '/data/menu.json', as: 'menu' } })] },
      },
    },
    pages: [
      { route: '/', isIndex: true, title: 'Home', sections: [section('Plain', 'home')] },
      {
        route: '/pricing',
        title: 'Pricing',
        fetch: { query: 'tiers', as: 'tiers' },
        sections: [
          section('Plans', 'plans', { content: doc(heading('Plans'), inset('TierChip')) }),
          section('Compare', 'compare', { content: doc(dataBlock('comparison', { rows: [{ label: 'From {price}' }] })) }),
          section('Team', 'team', { fetch: { query: 'members', as: 'members' } }),
          section('Featured', 'featured'),
          section('Broken', 'broken', { fetch: { path: '/data/missing.json', as: 'missing' } }),
          section('Plain', 'about', { subsections: [section('Plans', 'nested')] }),
          section('Ghost', 'ghost'),
        ],
      },
      { route: '/blog', title: 'Blog', fetch: { query: 'articles', as: 'articles' }, sections: [section('Plain', 'blog')] },
      {
        route: '/blog/:slug',
        parent: '/blog',
        isDynamic: true,
        paramName: 'slug',
        title: 'Post',
        sections: [
          section('ArticleBody', 'post'),
          section('Related', 'related', { fetch: { query: 'articles', as: 'related', current: 'exclude' } }),
        ],
      },
      { route: '/library', title: 'Library', fetch: { query: 'articles', as: 'articles', path: '/data/articles.json' }, sections: [section('Plain', 'library')] },
      { route: '/library/:slug', parent: '/library', isDynamic: true, paramName: 'slug', title: 'Read', sections: [section('WholeBody', 'read')] },
      { route: '/people', title: 'People', fetch: { query: 'members', as: 'members', path: '/data/members.json' }, sections: [section('Plain', 'people')] },
      // no section of it shows its record
      { route: '/people/:slug', parent: '/people', isDynamic: true, paramName: 'slug', title: 'Person', sections: [section('Plain', 'person')] },
      ...pages,
    ],
  }
}

const SHELL = '<!doctype html><html><head></head><body><div id="root"></div></body></html>'

/** The transport a host hands in: answers by path, and 404 for anything it doesn't hold. */
function transport() {
  const files = {
    '/data/tiers.json': TIERS,
    '/data/members.json': MEMBERS,
    '/data/articles.json': ARTICLES,
    '/data/menu.json': [{ $name: 'home', title: 'Home' }],
    // a record's own compiled file holds it whole
    '/data/articles/a.json': { ...ARTICLES[0], text: 'The whole article.' },
  }
  return vi.fn(async (url) => {
    const body = Object.entries(files).find(([path]) => String(url).includes(path))?.[1] ?? null
    return {
      ok: body !== null,
      status: body === null ? 404 : 200,
      headers: { get: () => 'application/json' },
      json: async () => body,
      text: async () => JSON.stringify(body),
    }
  })
}

/** The page's data step, then its render with the entries it carries, as a host runs them. */
async function rendered(route, { content = site(), extra = [], sectionData = true } = {}) {
  const website = initPrerender(content, foundation, []).activeWebsite
  const entries = await loadPageData({ website, route, fetch: transport(), icons: false })
  const fetchedData = [...entries.filter((e) => e.outcome === 'fetched'), ...extra]
  const renderer = createPageRenderer({ website, shell: SHELL })
  return { result: renderer.render(route, { fetchedData, sectionData }), website, entries }
}

const byId = (sections) => sections.map(({ id, data }) => [id, Object.keys(data)])

describe('render(…, { sectionData }) — what each section showed', () => {
  it('⭐ each body section, its child sections and its insets, in page order, by the fetch\'s name', async () => {
    const { result } = await rendered('/pricing')
    expect(result.outcome).toBe('rendered')
    expect(byId(result.sections)).toEqual([
      ['section-plans', ['tiers']],
      // the inset in it, under the id of the section it sits in
      ['section-plans', ['tiers']],
      // its tagged block is left out: the page's Markdown shows it as written
      ['section-compare', ['tiers']],
      // the component calls it `team`; the site's fetch is `members`, and that is its name here
      ['section-team', ['members']],
      ['section-featured', ['tiers']],
      ['section-nested', ['tiers']],
    ])
    const plans = result.sections[0].data.tiers
    expect(plans.map((r) => r.price)).toEqual([148, 298])
  })

  it('a key declared `single` gives the one record it received', async () => {
    const { result } = await rendered('/pricing')
    const featured = result.sections.find((s) => s.id === 'section-featured')
    expect(featured.data.tiers).toEqual(TIERS[0])
  })

  it('a key whose fetch failed is absent, never `[]` or `null`', async () => {
    const { result, entries } = await rendered('/pricing')
    // CONTROL: the fetch was asked and failed.
    expect(entries.some((e) => e.config?.as === 'missing' && e.outcome === 'failed')).toBe(true)
    expect(result.sections.some((s) => s.id === 'section-broken')).toBe(false)
  })

  it('a layout area\'s records are absent, though the page drew them', async () => {
    const { result, entries } = await rendered('/pricing')
    // CONTROL: the header's section fetched them, and the page's HTML shows them.
    expect(entries.some((e) => e.config?.as === 'menu' && e.outcome === 'fetched')).toBe(true)
    expect(result.html).toContain('<li>Home</li>')
    expect(result.sections.some((s) => 'menu' in s.data)).toBe(false)
  })

  it('CONTROL — records the page carries that no section of it shows are absent', async () => {
    const articles = { config: { path: '/data/articles.json', as: 'articles' }, outcome: 'fetched', data: ARTICLES }
    const { result } = await rendered('/pricing', { extra: [articles] })
    expect(result.sections.some((s) => 'articles' in s.data)).toBe(false)
  })

  it('a type the foundation has no code for showed nothing, whatever its meta declares', async () => {
    const { result } = await rendered('/pricing')
    expect(result.sections.some((s) => s.id === 'section-ghost')).toBe(false)
  })

  it('a record page\'s own record is left out — its Markdown writes it once, as the page\'s — and its other records are not', async () => {
    const { result } = await rendered('/blog/a')
    // CONTROL: the section drew the page's record.
    expect(result.html).toContain('<article>A post</article>')
    // The others, linked to their page as every record a section receives is (`$route`).
    expect(result.sections).toEqual([{ id: 'section-related', data: { related: [{ ...ARTICLES[1], $route: '/blog/b' }] } }])
    // …and the render hands its own record over beside them, as its section received it.
    expect(result.record).toEqual({ ...ARTICLES[0], $route: '/blog/a' })
  })

  it('⭐ a record page\'s own record comes whole when the page received it whole', async () => {
    const { result } = await rendered('/library/a')
    expect(result.html).toContain('<article>The whole article.</article>')
    expect(result.record?.text).toBe('The whole article.')
    expect(result.sections).toEqual([])
  })

  it('a record page no section of which shows its record still has it: the answer its own question got', async () => {
    const { result } = await rendered('/people/ada')
    expect(result.sections).toEqual([])
    expect(result.record).toEqual(MEMBERS[0])
  })

  it('a page that is not a record page has no `record`', async () => {
    const { result } = await rendered('/pricing')
    expect('record' in result).toBe(false)
  })

  it('⭐ an answer a static build prerendered into the section is its records, under its fetch\'s name; a tagged block is not', async () => {
    // A static build bakes a section's own fetch into its content (`parsedContent.data`, by `as`).
    const baked = section('Compare', 'baked', {
      content: doc(dataBlock('comparison', { rows: [] })),
      fetch: { query: 'tiers', as: 'tiers' },
      parsedContent: { data: { tiers: TIERS, comparison: { rows: ['baked, and the tagged block wins'] } } },
    })
    const content = site({ pages: [{ route: '/static', title: 'Static', sections: [baked] }] })
    const { result } = await rendered('/static', { content })
    expect(result.sections).toEqual([{ id: 'section-baked', data: { tiers: TIERS } }])
  })

  it('without the option the result is as before: no `sections`, and no resolve beyond the render\'s', async () => {
    const count = async (sectionData) => {
      const website = initPrerender(site(), foundation, []).activeWebsite
      const entries = await loadPageData({ website, route: '/pricing', fetch: transport(), icons: false })
      // On the prototype: a store instance is sealed.
      const resolve = vi.spyOn(Object.getPrototypeOf(website.entityStore), 'resolve')
      const result = createPageRenderer({ website, shell: SHELL }).render('/pricing', { fetchedData: entries.filter((e) => e.outcome === 'fetched'), sectionData })
      const calls = resolve.mock.calls.length
      resolve.mockRestore()
      return { result, calls }
    }
    const plain = await count(false)
    const asked = await count(true)
    expect('sections' in plain.result).toBe(false)
    expect(asked.result.html).toBe(plain.result.html)
    expect(asked.calls).toBeGreaterThan(plain.calls)
  })

  it('a page that failed to render carries no `sections`', async () => {
    const broken = { ...foundation, Plain: () => { throw new Error('boom') } }
    const website = initPrerender(site(), broken, []).activeWebsite
    const result = createPageRenderer({ website, shell: SHELL }).render('/', { fetchedData: [], sectionData: true })
    expect(result.outcome).toBe('failed')
    expect('sections' in result).toBe(false)
  })
})
