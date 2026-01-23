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
    imgs: item.imgs || [],
    lists: item.lists || [],
    icons: item.icons || [],
    videos: item.videos || [],
    buttons: item.buttons || [],
    properties: item.properties || {},
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
    subtitle2: content.subtitle2 || '',
    alignment: content.alignment || null,

    // Flat body fields
    paragraphs: content.paragraphs || [],
    links: content.links || [],
    imgs: content.imgs || [],
    lists: content.lists || [],
    icons: content.icons || [],
    videos: content.videos || [],
    buttons: content.buttons || [],
    properties: content.properties || {},
    propertyBlocks: content.propertyBlocks || [],
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
 * Prepare props for a component with runtime guarantees
 *
 * @param {Object} block - The block instance
 * @param {Object} meta - Runtime metadata for the component (from meta[componentName])
 * @returns {Object} Prepared props: { content, params }
 */
export function prepareProps(block, meta) {
  // Apply param defaults
  const defaults = meta?.defaults || {}
  const params = applyDefaults(block.properties, defaults)

  // Guarantee content structure
  const content = guaranteeContentStructure(block.parsedContent)

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
