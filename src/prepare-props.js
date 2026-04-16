/**
 * Props Preparation for Runtime Guarantees
 *
 * Prepares props for foundation components with:
 * - Param defaults from runtime schema
 * - Guaranteed content structure (no null checks needed)
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
    snippets: item.snippets || [],
    buttons: item.buttons || [],
    data: item.data || {},
    cards: item.cards || [],
    documents: item.documents || [],
    forms: item.forms || [],
    quotes: item.quotes || [],
    headings: item.headings || [],
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
    snippets: content.snippets || [],
    buttons: content.buttons || [],
    data: content.data || {},
    cards: content.cards || [],
    documents: content.documents || [],
    forms: content.forms || [],
    quotes: content.quotes || [],
    headings: content.headings || [],

    // Items with guaranteed structure
    items: (content.items || []).map(guaranteeItemStructure),

    // Sequence for ordered rendering
    sequence: content.sequence || [],

    // Preserve raw content if present
    raw: content.raw,
  }
}

/**
 * Apply a schema to a single object
 * Only processes fields defined in the schema, preserves unknown fields
 *
 * @param {Object} obj - The object to process
 * @param {Object} schema - Schema definition (fieldName -> fieldDef)
 * @returns {Object} Object with schema defaults applied
 */
function applySchemaToObject(obj, schema) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj
  }

  const result = { ...obj }

  for (const [field, fieldDef] of Object.entries(schema)) {
    // Get the default value - handle both shorthand and full form
    const defaultValue = typeof fieldDef === 'object' ? fieldDef.default : undefined

    // Apply default if field is missing and default exists
    if (result[field] === undefined && defaultValue !== undefined) {
      result[field] = defaultValue
    }

    // For select fields with options, apply default if value is not among valid options
    if (typeof fieldDef === 'object' && fieldDef.options && Array.isArray(fieldDef.options)) {
      if (result[field] !== undefined && !fieldDef.options.includes(result[field])) {
        // Value exists but is not valid - apply default if available
        if (defaultValue !== undefined) {
          result[field] = defaultValue
        }
      }
    }

    // Handle nested object schema
    if (typeof fieldDef === 'object' && fieldDef.type === 'object' && fieldDef.schema && result[field]) {
      result[field] = applySchemaToObject(result[field], fieldDef.schema)
    }

    // Handle array with inline schema
    if (typeof fieldDef === 'object' && fieldDef.type === 'array' && fieldDef.of && result[field]) {
      if (typeof fieldDef.of === 'object') {
        result[field] = result[field].map(item => applySchemaToObject(item, fieldDef.of))
      }
    }
  }

  return result
}

/**
 * Apply a schema to a value (object or array of objects)
 *
 * @param {Object|Array} value - The value to process
 * @param {Object} schema - Schema definition
 * @returns {Object|Array} Value with schema defaults applied
 */
function applySchemaToValue(value, schema) {
  if (Array.isArray(value)) {
    return value.map(item => applySchemaToObject(item, schema))
  }
  return applySchemaToObject(value, schema)
}

/**
 * Apply schemas to content.data
 * Only processes tags that have a matching schema, leaves others untouched
 *
 * @param {Object} data - The data object from content
 * @param {Object} schemas - Schema definitions from runtime meta
 * @returns {Object} Data with schemas applied
 */
export function applySchemas(data, schemas) {
  if (!schemas || !data || typeof data !== 'object') {
    return data || {}
  }

  const result = { ...data }

  for (const [tag, rawValue] of Object.entries(data)) {
    const schema = schemas[tag]
    if (!schema) continue  // No schema for this tag - leave as-is

    result[tag] = applySchemaToValue(rawValue, schema)
  }

  return result
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
 * Merge entity data onto a block's parsedContent.data.
 *
 * Section-level data already on the block (from prerender fetches via
 * blockData.parsedContent.data in the Block constructor) takes priority;
 * entity data only fills missing keys. Mutates `block.parsedContent.data`
 * in place so the vanilla JS layer holds the assembled data and
 * subsequent reads see the same shape.
 */
function mergeEntityData(block, entityData) {
  if (!entityData) return
  const current = block.parsedContent.data || {}
  let changed = false
  const merged = { ...current }
  for (const key of Object.keys(entityData)) {
    if (merged[key] === undefined) {
      merged[key] = entityData[key]
      changed = true
    }
  }
  if (changed) {
    block.parsedContent.data = merged
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
 * signal (undefined, null, or the same reference as rawContent), or
 * when the handler throws. Errors are logged via `console.error`.
 */
function runContentHandler(block) {
  if (block.dataLoading) return
  const handler = globalThis.uniweb?.foundationConfig?.handlers?.content
  if (typeof handler !== 'function') return
  if (!block.rawContent || Object.keys(block.rawContent).length === 0) return

  try {
    const transformed = handler(block.parsedContent.data, block)
    if (!transformed || transformed === block.rawContent) return
    const reparsed = block.parseContent(transformed)
    reparsed.data = block.parsedContent.data
    block.parsedContent = reparsed
    block.items = reparsed.items || []
  } catch (err) {
    console.error('Foundation content handler failed:', err)
  }
}

/**
 * Run the foundation-level props handler on the final { content, params }
 * before they reach the component. Runs after content parsing, param
 * defaults, content guarantees, and schema application — the handler
 * sees the exact shape the component would receive and can modify it.
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
 *   1. Merge entity data (resolved by EntityStore) onto
 *      `block.parsedContent.data`.
 *   2. Run the foundation data handler (if registered) to filter or
 *      reshape the assembled data.
 *   3. Run the foundation content handler (if registered) on the
 *      block. This may replace `block.parsedContent` with a re-parsed,
 *      instantiated version.
 *   4. Apply param defaults from meta.
 *   5. Build the guaranteed content structure.
 *   6. Apply schemas to content.data.
 *   7. Run the foundation props handler (if registered) for
 *      post-processing of the final { content, params }.
 *
 * Steps 1–3 mutate the block (vanilla JS layer). Steps 4–7 are
 * pure derivations of the block's now-assembled state.
 *
 * @param {Object} block - The block instance
 * @param {Object} meta - Runtime metadata for the component (from meta[componentName])
 * @param {Object|null} [entityData] - Entity data resolved by EntityStore (null if none)
 * @returns {Object} Prepared props: { content, params }
 */
export function prepareProps(block, meta, entityData = null) {
  mergeEntityData(block, entityData)
  runDataHandler(block)
  runContentHandler(block)

  // Apply param defaults
  const defaults = meta?.defaults || {}
  const params = applyDefaults(block.properties, defaults)

  // Guarantee content structure
  let content = guaranteeContentStructure(block.parsedContent)

  // Apply schemas to content.data
  const schemas = meta?.schemas || null
  if (schemas && content.data) {
    content.data = applySchemas(content.data, schemas)
  }

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
