/**
 * A PAGE'S ICONS, IN ITS PRERENDER.
 *
 * An icon is a file. On a page a host renders, nothing had fetched it by the time the page was
 * written, so the page held a blank box in its place until the browser had booted and fetched it:
 * about a second, on a fast connection (measured 2026-10-30). The render is synchronous and reads an
 * icon from `uniweb.iconCache` (`getIconSync`, kit's `<Icon>`), so what a page shows has to be there
 * before it starts, as with its data. Two halves:
 *
 * - The data step asks the host's transport for the icons the page's content names, and keeps them
 *   on the graph (`loadPageIcons`).
 * - The render door notes which icons it drew (`whileReadingIcons`), and the page carries exactly
 *   those in `__ICON_CACHE__`, which `setup.js` reads before the browser's first render. The browser
 *   renders over the prerendered page, so it has to draw what the page drew, or it would blank them.
 *
 * ⛔ NOT AN ENTRY OF THE DATA STEP'S LIST. A host counts that list to decide how long to keep the
 * page: an icon in it would shorten the life of every page holding one, and a failed one could end
 * it. So nothing here is reported. A host carries nothing new and changes nothing.
 *
 * ⚖️ What the walk cannot find: an icon a foundation's own code names, or one in a fetched record.
 * Those stay as they were, the placeholder and then the browser's fetch. So does any icon that fails
 * or arrives late, because a page without an icon is a page that still works.
 *
 * Renderer-free, as the data step's graph is (`tests/data-step-graph.test.js`), and not in the
 * browser's bundle: nothing `setup.js` or `index.jsx` imports reaches it.
 */
import { DEFAULT_ICON_BASE, ICON_FAMILY_MAP, iconUrl } from '@uniweb/core/icon-corpus'

/** How long a page waits for its icons. Past this it renders without the ones still on their way. */
export const ICON_WAIT_MS = 1000

/** The most a page asks for in one step, so an icon gallery cannot spend a host's budget of requests. */
export const MAX_ICON_REQUESTS = 40

/** A reference a link carries as its `icon`: `lu-play` or `lu:play`, as kit's `<Icon>` reads one. */
function parseIconReference(ref) {
  if (typeof ref !== 'string') return null
  const colon = ref.indexOf(':')
  if (colon > 0) return { library: ref.slice(0, colon), name: ref.slice(colon + 1) }
  const dash = ref.indexOf('-')
  if (dash < 2 || dash > 3) return null
  const library = ref.slice(0, dash)
  return ICON_FAMILY_MAP[library] ? { library, name: ref.slice(dash + 1) } : null
}

function visit(node, found) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'image' && node.attrs?.role === 'icon') found.push(node.attrs)
  for (const mark of node.marks || []) {
    const ref = parseIconReference(mark?.attrs?.icon)
    if (ref) found.push(ref)
  }
  if (Array.isArray(node.content)) for (const child of node.content) visit(child, found)
}

/**
 * The icons the content of these blocks names, each once.
 *
 * Keyed as `<Icon>` asks for one, by the library and name as written, since that is what
 * `getIconSync` looks up. The address uses the family's code and the corpus's spelling of the name.
 *
 * @param {Object[]} blocks
 * @returns {Map<string, { family: string, name: string }>}
 */
export function pageIcons(blocks) {
  const named = []
  for (const block of blocks) visit(block.rawContent?.doc ?? block.rawContent, named)
  const icons = new Map()
  for (const { library, name } of named) {
    const family = ICON_FAMILY_MAP[String(library).toLowerCase()]
    if (family && name) icons.set(`${library}:${name}`, { family, name })
  }
  return icons
}

/**
 * Fetch the icons these blocks name through the host's transport, into the graph's icon cache. One a
 * warm graph holds is not asked for again. Resolves when they are all in, or at `ICON_WAIT_MS`.
 *
 * @param {Object} options
 * @param {Object[]} options.blocks - the page's blocks (`blocksOf`)
 * @param {Object} options.website - the Website, whose `config.icons` says where the icons are
 * @param {Function} options.fetch - the transport
 * @param {Map<string, string>} options.cache - the graph's `iconCache`
 * @returns {Promise<void>}
 */
export async function loadPageIcons({ blocks, website, fetch, cache }) {
  const config = website.config?.icons
  if (config?.cdn === false) return
  const base = config?.base || DEFAULT_ICON_BASE
  const wanted = [...pageIcons(blocks)].filter(([key]) => !cache.has(key)).slice(0, MAX_ICON_REQUESTS)
  if (wanted.length === 0) return

  const all = Promise.all(wanted.map(async ([key, { family, name }]) => {
    try {
      const response = await fetch(iconUrl(family, name, base), { method: 'GET' })
      if (!response.ok) return
      const svg = await response.text()
      if (/<svg[\s>]/i.test(svg)) cache.set(key, svg)
    } catch {
      // The transport may refuse an address. The icon stays on the browser's path.
    }
  }))
  let timer
  const waited = new Promise((resolve) => { timer = setTimeout(resolve, ICON_WAIT_MS) })
  await Promise.race([all, waited])
  clearTimeout(timer)
}

/**
 * Run a render and collect the icons it drew, so the page can carry exactly those. On a graph reused
 * across pages that can include one this page's walk did not find, which is why this reads the
 * render rather than the walk: whatever the HTML shows, the browser's first render can show too.
 *
 * The render is synchronous, so no other request can read through this while it runs.
 *
 * @param {Object|undefined} uniweb - what `globalThis.uniweb` names for this render
 * @param {Map<string, string>} read - filled with each icon drawn
 * @param {Function} draw - the render
 * @returns {*} what `draw` returned
 */
export function whileReadingIcons(uniweb, read, draw) {
  const cache = uniweb?.iconCache
  if (!cache) return draw()
  const { get } = cache
  cache.get = (key) => {
    const svg = get.call(cache, key)
    if (svg) read.set(key, svg)
    return svg
  }
  try {
    return draw()
  } finally {
    delete cache.get
  }
}
