/**
 * WHAT A PAGE'S SECTIONS SHOWED FROM RECORDS — for the page's Markdown, never for its render.
 *
 * ⭐ A page's Markdown (`renderPageMarkdown`, `@uniweb/projections`) carries, after each section, the
 * records that section shows. Which records those are only the render knows: the keys its component
 * declares, each filled by the one rule (`@uniweb/core/page-data`), as briefs or whole, one record or
 * the set, with this page's record or without it. A rule over the site's content alone would get each
 * of those wrong, and a host's prefetch retired that rule for the same reasons (`load-page-data.js`).
 * So they are read back from the store the render has just read, by the reading it filled each section
 * by, after the HTML: in L2, with no twin to keep (L3 does not change), and nowhere in the browser's
 * bundle, since only `page-renderer.js` asks and only the SSR entry exports it.
 *
 * A section's records:
 *
 *   - **The keys its component declares** in its own `data:`. Not its foundation's (`main.js` `data:`),
 *     which reach every section, since a foundation's handlers run for every section, and which of
 *     them draws one is the foundation's business.
 *   - **As delivered**, before any foundation handler (`receivedData`, `./prepare-props.js`): the
 *     site's records, never a foundation's derivation of them.
 *   - **Named by the site's word:** the fetch's `as`, which is its query's name unless the site gives
 *     another. A component's key is the foundation's word, and a fetch can fill a key of another name
 *     that has its schema (`fillDeclaredKeys`). A held answer is under its fetch's `as` already. Two
 *     keys of one section filled under one `as` with different records: the second goes by its key.
 *   - **Left out:** a key the section holds as a tagged block in its own content (` ```yaml:tag `, or
 *     a concept block), which the page's Markdown already shows as it was written; a record page's
 *     own record (a key whose fetch uses this page's record, `current: only`), which its Markdown
 *     writes once, as the page's, from `record` (`pageRecordOf`); and a key with no value, `null` —
 *     nothing fills it, or its fetch failed, never ran or is still out.
 *   - **Whose:** each body section and its child sections, under its own id, and the insets in a
 *     section, under the id of the section they sit in, since a page's Markdown has no place of their
 *     own for them. Not the layout's areas, whose own content the page's Markdown doesn't carry either.
 *
 * @module
 */
import { sectionDomId } from '@uniweb/core/section-id'
import { declaredKeys } from '@uniweb/core/data-keys'
import { blockFillsOf, blockRouteQuery, fillIsPageRecord, heldPageRecord } from '@uniweb/core/page-data'
import { getComponentMeta, receivedData } from './prepare-props.js'

/**
 * The records each of a page's sections showed, and a record page's own record, read after the
 * page's render: what its Markdown carries (`renderPageMarkdown(page, { record, sections })`).
 *
 * @param {Object} page - the Page just rendered, its Website the one `globalThis.uniweb` names
 * @returns {{ sections: Array<{ id: string, data: Object }>, record: Object|null|undefined }}
 *   `sections` in page order, one entry per section, child section or inset that showed any, `id`
 *   the section's DOM id (`sectionDomId`) and `data` its records by name. `record` a record page's
 *   own (`pageRecordOf`): null when its route names none, undefined off a record page
 */
export function sectionRecords(page) {
  const sections = []
  // The page's own record as its sections received it, which `sections` leaves out.
  const shown = []
  for (const block of page?.getBodyBlocks?.() ?? []) visit(block, sectionDomId(block), sections, shown)
  return { sections, record: pageRecordOf(page, shown) }
}

function visit(block, id, sections, shown) {
  if (!block) return
  const data = recordsOf(block, shown)
  if (data) sections.push({ id, data })
  for (const inset of block.insets || []) visit(inset, id, sections, shown)
  for (const child of block.childBlocks || []) visit(child, sectionDomId(child), sections, shown)
}

/**
 * ⭐ A RECORD PAGE'S OWN RECORD, AS ITS RENDER READ IT — the most of it the page held, so its
 * Markdown carries what its sections drew: whole when a section received it whole, or when the
 * record index holds it whole; else as a section received it; else the answer the page's own
 * question got (`heldPageRecord`, `@uniweb/core/page-data`), which names the page and says whether
 * it exists.
 *
 * @param {Object} page
 * @param {Array<{ value: *, whole: boolean }>} shown
 * @returns {Object|null|undefined}
 */
function pageRecordOf(page, shown) {
  if (!page?.dynamicContext) return undefined
  const one = (value) => (Array.isArray(value) ? (value[0] ?? null) : value)
  const whole = shown.find((s) => s.whole && one(s.value))
  if (whole) return one(whole.value)
  const website = page.website
  const fetcher = website?.fetcher
  const own = heldPageRecord(page, {
    website,
    peek: (request) => fetcher?.peek?.(request, { website, page, block: null }),
    peekRecord: (id) => fetcher?.peekRecord?.(id),
  })
  const seen = shown.map((s) => one(s.value)).find(Boolean) ?? null
  const id = (own ?? seen)?.$uuid
  const held = typeof id === 'string' && id ? fetcher?.peekRecord?.(id) : null
  if (held?.whole === true && held.record) return held.record
  return seen ?? own
}

/** One block's records by name, or null when it showed none. */
function recordsOf(block, shown) {
  // A type the foundation doesn't have renders as an error box, and its render asks for no data.
  if (!globalThis.uniweb?.getComponent?.(block.type)) return null
  const meta = getComponentMeta(block.type)
  const own = declaredKeys(meta?.data)
  if (own.length === 0) return null

  // The resolve the render just made, from the same store: `renderBlock` (`ssr-renderer.js`).
  const resolved = block.website?.entityStore?.resolve(block, meta)
  const { data } = receivedData(block, meta, resolved?.status === 'ready' ? resolved.data : null)

  const held = block.heldData || {}
  let fills = null
  let route = null
  let tagged = null
  const out = {}
  for (const [key] of own) {
    const value = data[key]
    if (value === undefined || value === null) continue
    let name
    if (held[key] !== undefined) {
      tagged ??= taggedKeys(block)
      if (tagged.has(key)) continue
      // An answer a static build prerendered into the section, under its fetch's `as`.
      name = key
    } else {
      if (!fills) {
        route = blockRouteQuery(block)
        fills = blockFillsOf(block, meta, route)
      }
      const fill = fills.get(key)
      const cfg = fill?.cfg
      if (!cfg?.as) continue
      if (fillIsPageRecord(block, cfg, route)) {
        shown.push({ value, whole: fill.whole === true })
        continue
      }
      name = cfg.as
    }
    if (Object.hasOwn(out, name) && !sameValue(out[name], value)) name = key
    if (Object.hasOwn(out, name) && !sameValue(out[name], value)) continue
    out[name] = value
  }
  return Object.keys(out).length ? out : null
}

/**
 * The keys a section's own content holds as tagged blocks: its content parsed alone, without the
 * answers a build put beside it (`Block`'s constructor merges the two). `parseContent` is pure, and
 * this runs only for a section holding a declared key.
 */
function taggedKeys(block) {
  const parsed = typeof block.parseContent === 'function' && block.rawContent ? block.parseContent(block.rawContent) : null
  return new Set(Object.keys(parsed?.data || {}))
}

function sameValue(a, b) {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}
