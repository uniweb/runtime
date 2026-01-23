/**
 * Client-side Data Fetcher
 *
 * Executes fetch operations in the browser for runtime data loading.
 * Used when prerender: false is set on fetch configurations.
 *
 * @module @uniweb/runtime/data-fetcher-client
 */

/**
 * Get a nested value from an object using dot notation
 *
 * @param {object} obj - Source object
 * @param {string} path - Dot-separated path (e.g., 'data.items')
 * @returns {any} The nested value or undefined
 */
function getNestedValue(obj, path) {
  if (!obj || !path) return obj

  const parts = path.split('.')
  let current = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    current = current[part]
  }

  return current
}

/**
 * Execute a fetch operation in the browser
 *
 * @param {object} config - Normalized fetch config
 * @param {string} config.path - Local path (relative to site root)
 * @param {string} config.url - Remote URL
 * @param {string} config.schema - Schema key for data
 * @param {string} config.transform - Optional path to extract from response
 * @returns {Promise<{ data: any, error?: string }>} Fetched data or error
 *
 * @example
 * const result = await executeFetchClient({
 *   path: '/data/team.json',
 *   schema: 'team'
 * })
 * // result.data contains the parsed JSON array
 */
export async function executeFetchClient(config) {
  if (!config) return { data: null }

  const { path, url, transform } = config

  try {
    // Determine the fetch URL
    // For local paths, they're relative to the site root (served from public/)
    // For remote URLs, use as-is
    const fetchUrl = path || url

    if (!fetchUrl) {
      return { data: [], error: 'No path or url specified' }
    }

    const response = await fetch(fetchUrl)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    // Parse response based on content type
    const contentType = response.headers.get('content-type') || ''
    let data

    if (contentType.includes('application/json')) {
      data = await response.json()
    } else {
      // Try JSON first
      const text = await response.text()
      try {
        data = JSON.parse(text)
      } catch {
        // Return text as-is if not JSON
        console.warn('[data-fetcher] Response is not JSON, returning as text')
        data = text
      }
    }

    // Apply transform if specified (extract nested path)
    if (transform && data) {
      data = getNestedValue(data, transform)
    }

    return { data: data ?? [] }
  } catch (error) {
    console.warn(`[data-fetcher] Client fetch failed: ${error.message}`)
    return { data: [], error: error.message }
  }
}

/**
 * Merge fetched data into existing content.data
 *
 * @param {object} currentData - Current content.data object
 * @param {any} fetchedData - Data from fetch
 * @param {string} schema - Schema key to store under
 * @param {boolean} [merge=false] - If true, merge with existing; if false, replace
 * @returns {object} Updated data object
 */
export function mergeIntoData(currentData, fetchedData, schema, merge = false) {
  if (fetchedData === null || fetchedData === undefined || !schema) {
    return currentData
  }

  const result = { ...(currentData || {}) }

  if (merge && result[schema] !== undefined) {
    // Merge mode: combine with existing data
    const existing = result[schema]

    if (Array.isArray(existing) && Array.isArray(fetchedData)) {
      // Arrays: concatenate
      result[schema] = [...existing, ...fetchedData]
    } else if (
      typeof existing === 'object' &&
      existing !== null &&
      typeof fetchedData === 'object' &&
      fetchedData !== null &&
      !Array.isArray(existing) &&
      !Array.isArray(fetchedData)
    ) {
      // Objects: shallow merge
      result[schema] = { ...existing, ...fetchedData }
    } else {
      // Different types: fetched data wins
      result[schema] = fetchedData
    }
  } else {
    // Replace mode (default): fetched data overwrites
    result[schema] = fetchedData
  }

  return result
}

export default executeFetchClient
