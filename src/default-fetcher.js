/**
 * Runtime default fetcher.
 *
 * Plain URL GET + JSON parse. Used as the FetcherDispatcher's terminal
 * fallback when no foundation route and no foundation fallback match.
 * Sites that declare no fetcher at all — starter/docs/marketing-style
 * templates hitting /data/*.json — ride on this path.
 *
 * Not exported from @uniweb/runtime's public surface: foundations never
 * need to reach for this. If a foundation wants to compose the default
 * behavior with middleware, its choices are:
 *
 *   - Don't declare a fetcher. The runtime's default already handles
 *     plain URL + JSON responses.
 *   - Declare a custom fetcher and write its own `fetch()` call. When it
 *     needs auth / retry / envelope parsing, compose @uniweb/fetchers
 *     primitives (withAuth, etc.) around its own resolve function.
 *
 * There is intentionally no "reuse the default and wrap it" path — doing
 * so would duplicate this code into every foundation bundle. Custom
 * fetchers own their transport; the default exists for sites without one.
 */

/**
 * @param {Object} [options]
 * @param {string} [options.basePath=''] - Prepended to local absolute paths
 *   for subpath deployments. Remote URLs pass through unchanged.
 * @returns {{ resolve: (req: Object, ctx: Object) => Promise<{ data, error? }> }}
 */
export function createDefaultFetcher({ basePath = '' } = {}) {
  const prefix = basePath && basePath !== '/' ? basePath.replace(/\/$/, '') : ''

  return {
    async resolve(request, ctx = {}) {
      if (!request) return { data: null }
      const { path, url, transform } = request

      let target = path || url
      if (!target) return { data: [], error: 'No path or url specified' }

      if (prefix && target.startsWith('/') && !target.startsWith('//')) {
        target = prefix + target
      }

      try {
        const response = await fetch(target, { signal: ctx.signal })
        if (!response.ok) {
          return {
            data: [],
            error: `HTTP ${response.status}: ${response.statusText}`,
          }
        }

        const contentType = response.headers.get('content-type') || ''
        let data
        if (contentType.includes('application/json')) {
          data = await response.json()
        } else {
          const text = await response.text()
          try {
            data = JSON.parse(text)
          } catch {
            data = text
          }
        }

        if (transform && data !== null && data !== undefined) {
          data = getNestedValue(data, transform)
        }

        return { data: data ?? [] }
      } catch (error) {
        if (error?.name === 'AbortError') {
          return { data: [], error: 'aborted' }
        }
        return { data: [], error: error?.message || String(error) }
      }
    },
  }
}

/**
 * Walk a dotted path into an object. Missing segments short-circuit to
 * `undefined` so callers can distinguish "present and empty" from "not there."
 */
function getNestedValue(obj, path) {
  if (!obj || !path) return obj
  let current = obj
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return undefined
    current = current[part]
  }
  return current
}
