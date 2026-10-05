/**
 * Props Preparation for Runtime Guarantees
 *
 * Prepares props for foundation components with:
 * - Param defaults from runtime schema
 * - Guaranteed content structure (no null checks needed)
 * - `content.data` holding the keys the component declares, each as it arrived
 *
 * This enables simpler component code by ensuring predictable prop shapes.
 */

/**
 * Guarantee item has flat content structure
 *
 * @param {Object} item - Raw item from parser
 * @returns {Object} Item with guaranteed flat structure
 */
function guaranteeItemStructure(item) {
  return {
    title: item.title || '',
    pretitle: item.pretitle || '',
    subtitle: item.subtitle || '',
    paragraphs: item.paragraphs || [],
    links: item.links || [],
    images: item.images || [],
    lists: item.lists || [],
    icons: item.icons || [],
    videos: item.videos || [],
    // ⛔ An entry's own insets were left out until 2026-09-29, as `tables` was: the
    // parser delivered them and this object, built key by key, did not carry them.
    insets: item.insets || [],
    media: item.media || [],
    snippets: item.snippets || [],
    buttons: item.buttons || [],
    data: item.data || {},
    cards: item.cards || [],
    documents: item.documents || [],
    forms: item.forms || [],
    quotes: item.quotes || [],
    headings: item.headings || [],
    ...(item.math && item.math.length ? { math: item.math } : {}),
    ...(item.tables && item.tables.length ? { tables: item.tables } : {}),
  }
}

/**
 * Guarantee content structure exists
 * Returns a flat content object with all standard fields guaranteed to exist
 *
 * @param {Object} parsedContent - Raw parsed content from semantic parser (flat structure)
 * @returns {Object} Content with guaranteed flat structure
 */
export function guaranteeContentStructure(parsedContent) {
  const content = parsedContent || {}

  return {
    // Flat header fields
    title: content.title || '',
    pretitle: content.pretitle || '',
    subtitle: content.subtitle || '',
    alignment: content.alignment || null,

    // Flat body fields
    paragraphs: content.paragraphs || [],
    links: content.links || [],
    images: content.images || [],
    lists: content.lists || [],
    icons: content.icons || [],
    videos: content.videos || [],
    insets: content.insets || [],
    // The section's visual media — images, videos and insets on their own line — in
    // the order written, each with its `kind`: what a `media` slot holds (2026-09-29).
    media: content.media || [],
    snippets: content.snippets || [],
    buttons: content.buttons || [],
    data: content.data || {},
    cards: content.cards || [],
    documents: content.documents || [],
    forms: content.forms || [],
    quotes: content.quotes || [],
    headings: content.headings || [],

    // Rare collections — surfaced only when present so pages that don't
    // use them don't pay the allocation cost. Foundations that need them
    // should check for presence (content.math?.length) or use
    // content.sequence for in-order rendering.
    //
    // ⛔ `tables` was not passed through until 2026-09-29: the parser delivered it and
    // this object, built key by key, left it out — so a component declaring `tables`
    // received nothing, while `math`, its twin, arrived.
    ...(content.math && content.math.length ? { math: content.math } : {}),
    ...(content.tables && content.tables.length ? { tables: content.tables } : {}),

    // Items with guaranteed structure
    items: (content.items || []).map(guaranteeItemStructure),

    // Sequence for ordered rendering
    sequence: content.sequence || [],

    // Preserve raw content if present
    raw: content.raw,
  }
}

/**
 * Apply param defaults from runtime schema
 *
 * @param {Object} params - Params from frontmatter
 * @param {Object} defaults - Default values from runtime schema
 * @returns {Object} Merged params with defaults applied
 */
export function applyDefaults(params, defaults) {
  if (!defaults || Object.keys(defaults).length === 0) {
    return params || {}
  }

  return {
    ...defaults,
    ...(params || {}),
  }
}

/**
 * ⭐ `content.data` HOLDS THE KEYS THE COMPONENT DECLARES, AND NOTHING ELSE — ruled 2026-09-14
 * [Diego]. Every key in its `meta.js` `data:` and its foundation's `main.js` `data:`
 * (`website.declaredKeys`), each filled, in order, from:
 *
 *   1. what the section holds under that key (`block.heldData`) — a tagged data block, or
 *      its own fetch's answer a static build prerendered into it;
 *   2. what the entity store delivered for it — the fetch that fills it (`fillDeclaredKeys`);
 *   3. `null` — nothing fills it, or its fetch is still out (`block.dataLoading`) or failed
 *      (`block.dataError[key]`). ⭐ Never `[]`, which is an answer with no records.
 *
 * A tagged data block under a key the component does not declare is left out, and said so
 * in dev (`warnUndeclaredBlocks`); it stays in `content.sequence`. The data object is
 * rebuilt on each render from those sources, never from the last render's.
 *
 * ⛔ Until 2026-09-14 this merged every delivered key into what the section held, so a
 * section received every fetch that reached it and every tagged block it had.
 */
function assembleData(block, meta, entityData) {
  const declared = block.website?.declaredKeys ? block.website.declaredKeys(meta) : []
  const held = block.heldData || {}
  const data = {}
  for (const [key] of declared) {
    if (held[key] !== undefined) data[key] = held[key]
    else if (entityData && entityData[key] !== undefined) data[key] = entityData[key]
    else data[key] = null
  }
  warnUndeclaredBlocks(block, declared)
  block.parsedContent.data = data
}

/**
 * Say once, in dev, that a tagged block — a data block or a concept block — did not reach its
 * section's component: its key is not declared. The block is still in `content.sequence`, where a component that
 * renders the sequence finds it.
 */
const warnedBlocks = new Set()
function warnUndeclaredBlocks(block, declared) {
  if (!block.website?.entityStore?.dev) return
  const keys = new Set(declared.map(([key]) => key))
  for (const item of block.parsedContent?.sequence || []) {
    // A data block (```yaml:tag) and a concept block (```md:tag) both land under their tag, so
    // both need the key declared. ⛔ Until 2026-09-29 only a data block was reported, and an
    // undeclared concept block left content.data without a word.
    const kind = item?.type === 'dataBlock' ? 'data block' : item?.type === 'concept_block' ? 'concept block' : null
    if (!kind || typeof item.tag !== 'string' || keys.has(item.tag)) continue
    const memo = `${block.type}::${item.tag}`
    if (warnedBlocks.has(memo)) continue
    warnedBlocks.add(memo)
    console.warn(
      `[uniweb] ${block.type}: the \`${item.tag}\` ${kind} is not in content.data — ${block.type} does not ` +
        `declare \`${item.tag}\` in its meta.js \`data:\`. It stays in content.sequence.`
    )
  }
}

/**
 * Run the foundation-level data handler on a block, if one is
 * registered. Runs after entity data merge and before the content
 * handler — the handler sees the fully assembled data and can filter,
 * reshape, or augment it before Loom (or any content transform) runs.
 *
 * The handler receives `(data, block)` where data is
 * `block.parsedContent.data`. It returns a new data object, or
 * null/undefined for no change. The returned data replaces
 * `block.parsedContent.data` for all downstream processing — both
 * the content handler and the component see the transformed data.
 *
 * Skipped when the block is still waiting on async data
 * (`block.dataLoading`), or when no handler is registered.
 * Errors are logged and the original data is preserved.
 */
function runDataHandler(block) {
  if (block.dataLoading) return
  const handler = globalThis.uniweb?.foundationConfig?.handlers?.data
  if (typeof handler !== 'function') return

  try {
    const result = handler(block.parsedContent.data, block)
    if (result != null && result !== block.parsedContent.data) {
      block.parsedContent.data = result
    }
  } catch (err) {
    console.error('Foundation data handler failed:', err)
  }
}

/**
 * Run the foundation-level content handler on a block, if one is
 * registered. Runs at prop-preparation time — after the data handler
 * has had a chance to filter/reshape the data — so the handler sees
 * the fully assembled (and possibly filtered) data. Replaces
 * `block.parsedContent` in place with the re-parsed, instantiated
 * form. The handler receives `(data, block)` and reads raw
 * ProseMirror from `block.rawContent`.
 *
 * Skipped when the block is still waiting on async data
 * (`block.dataLoading`), when no handler is registered, when the
 * block has no raw content, when the handler returns a no-change
 * signal (undefined, null, or the same reference as rawContent), when
 * it returns anything but a ProseMirror document, or when the handler
 * throws. Errors are logged via `console.error`.
 *
 * ⛔ ONLY A DOCUMENT IS RE-PARSED (2026-10-05). The handler is given the section's
 * DATA, so the natural no-op — `(x) => x` — returns the data map. That is not
 * `rawContent`, so it passed the no-change check; `parseContent` takes a plain
 * object as content already parsed; and the section's content became its data
 * map — title, paragraphs and items gone — with `data.data` pointing back at
 * itself, so a `JSON.stringify(content.data)` threw far from the handler (and
 * failed a static build's prerender of the page). Any result that is not a
 * document is now ignored, and said once per handler.
 */
function runContentHandler(block) {
  if (block.dataLoading) return
  const handler = globalThis.uniweb?.foundationConfig?.handlers?.content
  if (typeof handler !== 'function') return
  if (!block.rawContent || Object.keys(block.rawContent).length === 0) return

  try {
    const transformed = handler(block.parsedContent.data, block)
    if (!transformed || transformed === block.rawContent) return
    if (!isDocument(transformed)) {
      warnNotADocument(handler, transformed, block.parsedContent.data)
      return
    }
    const reparsed = block.parseContent(transformed)
    reparsed.data = block.parsedContent.data
    block.parsedContent = reparsed
    block.items = reparsed.items || []
  } catch (err) {
    console.error('Foundation content handler failed:', err)
  }
}

/** A ProseMirror document — bare, or wrapped as `{ doc }`, the two forms `rawContent` takes. */
function isDocument(value) {
  return value?.type === 'doc' || value?.doc?.type === 'doc'
}

/**
 * Say, once per handler, that a content handler returned something that is not a
 * document — naming the likely mistake when it returned the very data it was given.
 */
const warnedContentHandlers = new WeakSet()
function warnNotADocument(handler, value, data) {
  if (warnedContentHandlers.has(handler)) return
  warnedContentHandlers.add(handler)
  const what =
    value === data
      ? 'the data it was given'
      : Array.isArray(value)
        ? 'an array'
        : `${typeof value === 'object' ? 'an object' : typeof value}`
  console.warn(
    `[uniweb] handlers.content returned ${what}, not a ProseMirror document — ignored, and the ` +
      `section keeps its content. The handler is called (data, block) and returns the section's ` +
      `raw content transformed (block.rawContent, as Loom's does), or null for no change.`
  )
}

/**
 * Run the foundation-level props handler on the final { content, params }
 * before they reach the component. Runs after content parsing, param
 * defaults and content guarantees — the handler sees the exact shape the
 * component would receive and can modify it.
 *
 * The handler receives `(content, params, block)` and returns a new
 * `{ content, params }` object, or null/undefined for no change.
 *
 * Use cases: post-parse content reshaping, computed fields derived
 * from both content and params, param-driven content reorganization.
 * Errors are logged and the original props are preserved.
 */
function runPropsHandler(content, params, block) {
  const handler = globalThis.uniweb?.foundationConfig?.handlers?.props
  if (typeof handler !== 'function') return null

  try {
    const result = handler(content, params, block)
    if (result && typeof result === 'object') return result
  } catch (err) {
    console.error('Foundation props handler failed:', err)
  }
  return null
}

/**
 * Prepare props for a component with runtime guarantees.
 *
 * Does the full content-assembly pipeline in one place so both
 * renderers (`BlockRenderer.jsx` CSR and `ssr-renderer.js` SSG) share
 * the same code path:
 *
 *   1. Assemble `block.parsedContent.data` from the keys the component
 *      declares: what the section holds, else what EntityStore delivered,
 *      else `null` (`assembleData`).
 *   2. Run the foundation data handler (if registered) to filter or
 *      reshape the assembled data.
 *   3. Run the foundation content handler (if registered) on the
 *      block. This may replace `block.parsedContent` with a re-parsed,
 *      instantiated version.
 *   4. Apply param defaults from meta.
 *   5. Build the guaranteed content structure.
 *   6. Run the foundation props handler (if registered) for
 *      post-processing of the final { content, params }.
 *
 * Steps 1–3 mutate the block (vanilla JS layer). Steps 4–6 are
 * pure derivations of the block's now-assembled state.
 *
 * ⛔ No field defaults for `content.data` — ruled 2026-10-05 [Diego]. A step between 5 and 6
 * filled each missing field from its schema's `default`, and replaced a value its `enum`
 * rejected, from the `schemas` a foundation built before then still carries in its meta —
 * read no more. A record reaches the component as it is: an absent field is its own fact,
 * and what it renders as is the component's choice.
 *
 * @param {Object} block - The block instance
 * @param {Object} meta - Runtime metadata for the component (from meta[componentName])
 * @param {Object|null} [entityData] - Entity data resolved by EntityStore (null if none)
 * @returns {Object} Prepared props: { content, params }
 */
export function prepareProps(block, meta, entityData = null) {
  assembleData(block, meta, entityData)
  // ⭐ A list the section held before the store answered — its own fetch, prerendered
  // into its content by a static build — gets its records' `$route` by the store's rule,
  // which the store did not deliver it by (2026-09-14).
  block.website?.entityStore?.linkOwnRecords?.(block)
  runDataHandler(block)
  runContentHandler(block)

  // Apply param defaults
  const defaults = meta?.defaults || {}
  const params = applyDefaults(block.properties, defaults)

  // Guarantee content structure
  const content = guaranteeContentStructure(block.parsedContent)

  // Post-process hook
  const adjusted = runPropsHandler(content, params, block)
  if (adjusted) {
    return {
      content: adjusted.content || content,
      params: adjusted.params || params,
    }
  }

  return { content, params }
}

/**
 * Get runtime metadata for a component from the global uniweb instance
 *
 * @param {string} componentName
 * @returns {Object|null}
 */
export function getComponentMeta(componentName) {
  return globalThis.uniweb?.getComponentMeta?.(componentName) || null
}

/**
 * Get default param values for a component
 *
 * @param {string} componentName
 * @returns {Object}
 */
export function getComponentDefaults(componentName) {
  return globalThis.uniweb?.getComponentDefaults?.(componentName) || {}
}
