/**
 * A PAGE'S ICONS, IN ITS PRERENDER.
 *
 * An icon is a file. On a page a host renders, nothing had fetched it by the time the page was
 * written, so the page held a blank box in its place until the browser had booted and fetched it:
 * about a second, on a fast connection (measured 2026-10-30). The render is synchronous and reads an
 * icon from `uniweb.iconCache` (`getIconSync`, kit's `<Icon>`), so what a page shows has to be there
 * before it starts, as with its data. Two halves:
 *
 * - The data step asks the host's transport for the icons the site names for the page, and keeps
 *   them on the graph (`iconRequests`). It asks twice at most: for what the page's sections name,
 *   beside their data requests, and then for what the records those requests brought name, since
 *   only their answers say.
 * - The render door notes which icons it drew (`whileReadingIcons`), and the page carries exactly
 *   those in `__ICON_CACHE__`, which `setup.js` reads before the browser's first render. The browser
 *   renders over the prerendered page, so it has to draw what the page drew, or it would blank them.
 *
 * ⭐ WHAT A SITE NAMES — the icons this is for. A site has no build and ships no code, so an icon its
 * author names is fetched: one in a section's content, its params (with its type's defaults), the data
 * it holds (a tagged data block), or the records it shows (a service's `icon`). A foundation has a
 * build, so an icon its own code draws is imported and drawn with nothing to fetch (`<Icon svg>`).
 * One a foundation names by reference instead stays as it was, the placeholder and then the browser's
 * fetch [Diego, 2026-11-03]. So does any icon that fails or arrives late, because a page without an
 * icon is a page that still works.
 *
 * ⚖️ Outside content an icon is known by its value: a string that is exactly a reference (`lu-baby`,
 * `lucide:baby`). Only a record's schema says which field holds an icon, and the runtime carries no
 * schema. A value that is a reference and draws nothing (an amenity spelled `wi-fi`) costs one request
 * within `MAX_ICON_REQUESTS`, and nothing on the page, which carries only what its render drew.
 *
 * ⛔ NOT AN ENTRY OF THE DATA STEP'S LIST. A host counts that list to decide how long to keep the
 * page: an icon in it would shorten the life of every page holding one, and a failed one could end
 * it. So nothing here is reported. A host carries nothing new and changes nothing.
 *
 * Renderer-free, as the data step's graph is (`tests/data-step-graph.test.js`), and not in the
 * browser's bundle: nothing `setup.js` or `index.jsx` imports reaches it.
 */
import { DEFAULT_ICON_BASE, ICON_FAMILY_MAP, iconUrl } from '@uniweb/core/icon-corpus'
import { getComponentMeta } from './prepare-props.js'

/** How long a page waits for each round of its icons. Past this it renders without the ones still on their way. */
export const ICON_WAIT_MS = 1000

/** The most a page asks for in one step, both rounds together, so an icon gallery cannot spend a host's budget of requests. */
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

/** An icon's name as the corpus and each family's own site spell one: lowercase words and digits. */
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A value that is exactly an icon reference, as a param or a record's field holds one, else null.
 * ⛔ Exactly, not containing one: `Call lu-phone` or an address is not an icon.
 */
function iconValue(value) {
  if (value.length > 64) return null
  const ref = parseIconReference(value)
  return ref && ICON_FAMILY_MAP[ref.library.toLowerCase()] && ICON_NAME.test(ref.name) ? ref : null
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

/** Every icon a value names, at any depth: a param, a tagged data block, a record and its rich text. */
function visitValue(value, found, seen = new WeakSet()) {
  if (typeof value === 'string') {
    const ref = iconValue(value)
    if (ref) found.push(ref)
    return
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  // A rich-text field holds an icon as content does.
  if (value.type === 'image' && value.attrs?.role === 'icon') found.push(value.attrs)
  for (const child of Array.isArray(value) ? value : Object.values(value)) visitValue(child, found, seen)
}

/**
 * Each icon once, keyed as `<Icon>` asks for one, by the library and name as written, since that is
 * what `getIconSync` looks up. The address uses the family's code and the corpus's spelling of the name.
 */
function addressed(named) {
  const icons = new Map()
  for (const { library, name } of named) {
    const family = ICON_FAMILY_MAP[String(library).toLowerCase()]
    if (family && name) icons.set(`${library}:${name}`, { family, name })
  }
  return icons
}

/**
 * The icons the site names for these blocks, each once: in their content first, then by value in
 * their params with their types' defaults, and in the data they hold.
 *
 * @param {Object[]} blocks
 * @returns {Map<string, { family: string, name: string }>}
 */
export function pageIcons(blocks) {
  const named = []
  for (const block of blocks) visit(block.rawContent?.doc ?? block.rawContent, named)
  for (const block of blocks) {
    visitValue(block.properties, named)
    visitValue(getComponentMeta(block.type)?.defaults, named)
    visitValue(block.heldData, named)
  }
  return addressed(named)
}

/**
 * The icons these values name, each once: the records a page's data requests brought.
 *
 * @param {Array<*>} values
 * @returns {Map<string, { family: string, name: string }>}
 */
export function dataIcons(values) {
  const named = []
  visitValue(values, named)
  return addressed(named)
}

/**
 * How one data step asks for its page's icons through the host's transport, into the graph's icon
 * cache: each icon once over both rounds, and no more than `MAX_ICON_REQUESTS` in all. One a warm
 * graph holds is not asked for again. A round resolves when its icons are all in, or at
 * `ICON_WAIT_MS`; one still on its way is kept when it arrives.
 *
 * @param {Object} options
 * @param {Object} options.website - the Website, whose `config.icons` says where the icons are
 * @param {Function} options.fetch - the transport
 * @param {Map<string, string>} options.cache - the graph's `iconCache`
 * @returns {(icons: Map<string, { family: string, name: string }>) => Promise<void>} one round
 */
export function iconRequests({ website, fetch, cache }) {
  const config = website.config?.icons
  const base = config?.base || DEFAULT_ICON_BASE
  const asked = new Set()

  return async function ask(icons) {
    if (config?.cdn === false) return
    const wanted = []
    for (const [key, address] of icons) {
      if (asked.size === MAX_ICON_REQUESTS) break
      if (cache.has(key) || asked.has(key)) continue
      asked.add(key)
      wanted.push([key, address])
    }
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
