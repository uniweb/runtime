/**
 * Runtime default fetcher.
 *
 * Used as the FetcherDispatcher's terminal fallback when no foundation
 * route and no foundation fallback match. Sites that declare no fetcher
 * at all — starter/docs/marketing templates hitting /data/*.json — ride
 * on this path with zero config.
 *
 * The fetcher recognizes a general-purpose vocabulary under `site.yml fetcher:`
 * so sites with a real backend don't need a foundation just to add a base URL
 * or static headers:
 *
 *   fetcher:
 *     baseUrl: https://api.example.com
 *     headers:
 *       X-Tenant: acme
 *       Accept: application/vnd.example+json
 *     envelope:
 *       collection: data.items
 *       item: data.article
 *       error: errors.0.message
 *
 * Per-fetch, the request may carry `method: 'POST'` + `body:` for backends
 * that take queries in a body (GraphQL, search endpoints). `{paramName}`
 * placeholders in body strings are substituted from `request.dynamicContext`
 * so template-page detail queries can reference route params.
 *
 * Every key is optional. When the config is empty, behavior is byte-for-byte
 * identical to a plain `fetch()` with JSON parsing.
 *
 * Not exported from @uniweb/runtime's public surface: foundations never
 * need to reach for this. If a foundation wants to compose the default
 * behavior with middleware, its choices are:
 *
 *   - Don't declare a fetcher. The runtime's default already handles
 *     plain URL + JSON responses (and the site-level vocabulary).
 *   - Declare a custom fetcher and write its own `fetch()` call. When it
 *     needs auth / retry / response normalization, compose @uniweb/fetchers
 *     primitives around its own resolve function.
 *
 * There is intentionally no "reuse the default and wrap it" path — doing
 * so would duplicate this code into every foundation bundle. Custom
 * fetchers own their transport; the default exists for sites without one.
 *
 * Intentional omissions: credentials / secrets are NOT part of the vocabulary.
 * Any value the framework puts into the served HTML is public to the browser.
 * Sites needing private credentials use a deployment-layer proxy — the site
 * fetches a same-origin URL, and a layer in front (e.g. the Uniweb platform's
 * edge worker, or any custom backend) resolves the credential and forwards
 * upstream. Framework sees a plain URL; platform owns the secret.
 *
 * `headers:` IS supported because static per-site headers (tenant routing,
 * content-type negotiation, custom Accept values) aren't credentials and
 * aren't anything sites try to hide. Sites that accidentally put a secret
 * in `headers:` have the same problem they'd have hardcoding it in the URL:
 * it's public. That's not a framework feature gap; it's how browsers work.
 */

import { substitutePlaceholders } from '@uniweb/core'

/**
 * @param {Object} [options]
 * @param {string} [options.basePath=''] - Prepended to local absolute paths
 *   for subpath deployments. Remote URLs pass through unchanged.
 * @param {Object} [options.config={}] - Site-level fetcher config from
 *   `site.yml fetcher:`. Vocabulary recognized by the default fetcher:
 *   `baseUrl`, `headers`, `envelope`. Unknown keys are ignored (foundations
 *   may use the same block for their own keys).
 *   Default behavior (empty config) matches today's plain GET + JSON.
 * @returns {{ resolve: (req: Object, ctx: Object) => Promise<{ data, error? }> }}
 */
export function createDefaultFetcher({ basePath = '', config = {} } = {}) {
  const pathPrefix = basePath && basePath !== '/' ? basePath.replace(/\/$/, '') : ''

  const baseUrl = typeof config?.baseUrl === 'string'
    ? config.baseUrl.replace(/\/$/, '')
    : ''

  // Static headers merged into every remote request. Local `/data/*.json`
  // requests are never decorated — they're just file reads under public/.
  const staticHeaders = buildStaticHeaders(config?.headers)

  // `envelope:` extends today's `transform:` to cover detail responses and
  // errors. Three dot-paths, all optional:
  //   - envelope.collection — applied on collection responses. Per-fetch
  //     `transform:` on the request wins (per-fetch overrides site-level).
  //   - envelope.item       — applied when request.dynamicContext is set
  //     (the request is for a template-page item).
  //   - envelope.error      — extract error text from non-2xx response body.
  const envelope = (config?.envelope && typeof config.envelope === 'object')
    ? config.envelope
    : {}

  return {
    async resolve(request, ctx = {}) {
      if (!request) return { data: null }
      const { path, url, transform, body: rawBody } = request

      // Normalize method. Only GET and POST are supported by the default
      // fetcher — mutations (PUT/PATCH/DELETE) are a different feature
      // (optimistic updates, action semantics) and don't belong here.
      let method = (request.method || 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'POST') {
        console.warn(`[default-fetcher] method "${request.method}" is not supported — falling back to GET.`)
        method = 'GET'
      }

      let target
      let isRemote
      if (path) {
        // Local file under public/ — basePath applies for subpath deploys.
        target = pathPrefix && path.startsWith('/') && !path.startsWith('//')
          ? pathPrefix + path
          : path
        isRemote = false
      } else if (url) {
        // Remote URL — baseUrl applies when url is relative (no scheme,
        // not protocol-relative). Absolute or protocol-relative pass through.
        target = isAbsoluteUrl(url) ? url : joinUrl(baseUrl, url)
        isRemote = true
      } else {
        return { data: [], error: 'No path or url specified' }
      }

      const init = { signal: ctx.signal, method }
      const headers = {}

      // Static site-level headers go on remote requests only — we don't
      // decorate local file reads with tenant/content-type headers.
      if (isRemote && staticHeaders) Object.assign(headers, staticHeaders)

      if (method === 'POST' && rawBody !== undefined && rawBody !== null) {
        // Substitute {paramName} placeholders in body strings using the
        // dynamic-route context. The helper expects a flat key→value map;
        // build it from dynamicContext's { paramName, paramValue } shape.
        // Strict-brace matcher: GraphQL selection sets pass through unchanged.
        const dc = request.dynamicContext
        const resolvedBody = dc && dc.paramName
          ? substitutePlaceholders(rawBody, { [dc.paramName]: dc.paramValue }, { encode: false })
          : rawBody

        // Default Content-Type to JSON unless the site's static headers
        // already set one (for application/graphql or form-urlencoded).
        if (!hasHeader(headers, 'Content-Type')) {
          headers['Content-Type'] = 'application/json'
        }
        init.body = typeof resolvedBody === 'string'
          ? resolvedBody
          : JSON.stringify(resolvedBody)
      }

      if (Object.keys(headers).length) init.headers = headers

      try {
        const response = await fetch(target, init)

        // Per-request envelope (set by object-form `detail:`) wins over
        // site-level envelope. This lets a detail query declare its own
        // item/collection/error paths independently of the collection.
        const requestEnvelope = (request.envelope && typeof request.envelope === 'object')
          ? request.envelope
          : null
        const effectiveEnvelope = requestEnvelope ?? envelope

        if (!response.ok) {
          // If `envelope.error` is configured, try to extract a human message
          // from the parsed body; fall back to status text if the path is
          // missing or the body isn't JSON.
          let extracted
          if (effectiveEnvelope.error) {
            try {
              const text = await response.text()
              const body = safeParseJSON(text)
              if (body !== undefined) {
                const candidate = getNestedValue(body, effectiveEnvelope.error)
                if (typeof candidate === 'string' && candidate.length) {
                  extracted = candidate
                }
              }
            } catch {
              // Body not readable — fall through to status-text fallback.
            }
          }
          return {
            data: [],
            error: extracted ?? `HTTP ${response.status}: ${response.statusText}`,
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

        // Unwrap response envelope. Priority order, highest wins:
        //   1. Per-fetch `transform:` (existing, documented knob).
        //   2. Per-request `envelope.item` (detail) or `envelope.collection`.
        //   3. Site-level `envelope.item` (detail) or `envelope.collection`.
        const isDetailRequest = !!request.dynamicContext
        const effectiveTransform =
          transform
          || (isDetailRequest ? effectiveEnvelope.item : effectiveEnvelope.collection)
        if (effectiveTransform && data !== null && data !== undefined) {
          data = getNestedValue(data, effectiveTransform)
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
 * Build the static headers object from `site.yml fetcher.headers:`. Returns
 * null when none are configured so the caller can skip adding an empty
 * `headers` init option.
 */
function buildStaticHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return null
  const out = {}
  for (const [k, v] of Object.entries(headers)) {
    if (v === null || v === undefined) continue
    out[k] = String(v)
  }
  return Object.keys(out).length ? out : null
}

/**
 * Case-insensitive header-key check. Lets a site write `Content-Type` or
 * `content-type` and still override the POST default correctly.
 */
function hasHeader(headers, name) {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((k) => k.toLowerCase() === lower)
}

/**
 * Is this URL absolute (has a scheme) or protocol-relative? Those two pass
 * through the default fetcher unchanged. Everything else is considered
 * relative and resolves against `config.baseUrl` (if set).
 */
function isAbsoluteUrl(url) {
  if (typeof url !== 'string') return false
  if (url.startsWith('//')) return true        // protocol-relative
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url)  // scheme://…
}

/**
 * Join `baseUrl` with a relative `url`, avoiding double slashes. If `baseUrl`
 * is empty, the url is returned unchanged — even if relative — so sites that
 * don't set `baseUrl` behave exactly like they did before this capability
 * was added.
 */
function joinUrl(baseUrl, url) {
  if (!baseUrl) return url
  if (url.startsWith('/')) return baseUrl + url
  return baseUrl + '/' + url
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

/**
 * JSON.parse that returns `undefined` on failure instead of throwing.
 * Used when we want to probe a response body for an error path but don't
 * want a non-JSON body to surface as a parser exception.
 */
function safeParseJSON(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
