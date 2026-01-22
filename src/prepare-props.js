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
 * Guarantee content structure exists
 * Returns a content object with all standard paths guaranteed to exist
 *
 * @param {Object} parsedContent - Raw parsed content from semantic parser
 * @returns {Object} Content with guaranteed structure
 */
export function guaranteeContentStructure(parsedContent) {
  const content = parsedContent || {}

  return {
    // Main content section
    main: {
      header: {
        title: content.main?.header?.title || '',
        pretitle: content.main?.header?.pretitle || '',
        subtitle: content.main?.header?.subtitle || '',
      },
      body: {
        paragraphs: content.main?.body?.paragraphs || [],
        links: content.main?.body?.links || [],
        imgs: content.main?.body?.imgs || [],
        lists: content.main?.body?.lists || [],
        icons: content.main?.body?.icons || [],
      },
    },
    // Content items (H3 sections)
    items: content.items || [],
    // Preserve any additional fields from parser
    ...content,
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
