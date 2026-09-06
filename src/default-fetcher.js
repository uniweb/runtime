/**
 * Runtime default fetcher.
 *
 * Used as the FetcherDispatcher's terminal fallback when no foundation
 * transport claims the request. Sites that declare no transport at all —
 * starter/docs/marketing templates hitting /data/*.json — ride on this path
 * with zero config, and so does a site a host serves live.
 *
 * ⭐ It speaks exactly TWO lanes, and takes NO site-level vocabulary for a
 * backend of the author's own:
 *
 *   - a compiled file — `path:` under the site's base (`/data/<query>.json`,
 *     a per-record file), or a plain JSON `url:` the author wrote;
 *   - the host's RECORDS SERVICE — `ask:`, one POST per tick carrying every
 *     question the page asked, answered per key (the records contract, as this
 *     client reads it).
 *
 * `where:` / `sort:` / `limit:` are evaluated HERE, locally, over what the
 * first lane returns — with `@uniweb/core`'s one evaluator, the same the build
 * uses to materialize a file — and at the source when asked. Nothing decides
 * that per site: the LANE decides.
 *
 * ⛔ RETIRED 2026-09-04 [Diego]: `fetcher.baseUrl`, `headers`, `envelope`,
 * `supports`, `request.style` / `request.rename` and the `json-body`
 * request-style registry. *"3rd party endpoints must be supported at the
 * foundation level… making the runtime+core lean."* A backend with its own
 * base, headers, wire or query language is a TRANSPORT — a named
 * `{ resolve, cacheKey? }` the foundation (or an extension) registers and
 * the site selects per schema in `fetcher.transports`. The build warns once
 * and drops a retired key from the payload, so an author's backend does not
 * silently stop being reached.
 *
 * Per-fetch, the request may still carry `method: 'POST'` + `body:` for a
 * backend that takes a query in a body (GraphQL, a search endpoint);
 * `{paramName}` placeholders in body strings are substituted from
 * `request.dynamicContext`, so a template page's detail query can reference
 * its route param. `transform:` and the object form of `detail:` (its own
 * `envelope`) stay per fetch too — they describe ONE response, not a backend.
 *
 * Exported from a subpath — `@uniweb/runtime/default-fetcher` — for
 * runtime-level callers (the editor's preview iframe, custom runtime
 * harnesses). **Foundations should not import this.** A foundation that
 * wants plain URL + JSON behavior simply omits its own transport; the
 * runtime installs this one automatically.
 *
 * Intentional omission: credentials / secrets. Any value the framework puts
 * into the served HTML is public to the browser. Sites needing private
 * credentials use a deployment-layer proxy — the site fetches a same-origin
 * URL, and a layer in front resolves the credential and forwards upstream.
 */

import {
  substitutePlaceholders,
  matchWhere,
  sortRecords,
  sortToWire,
  deriveCacheKey,
  resolveServiceUrl,
} from '@uniweb/core'

/**
 * @param {Object} [options]
 * @param {string} [options.basePath=''] - Prepended to local absolute paths
 *   for subpath deployments. Remote URLs pass through unchanged.
 * @param {boolean} [options.dev=false] - Dev-mode diagnostics: a bad `sort:`
 *   throws instead of delivering the records unsorted.
 * @param {Function|null} [options.fetch=null] - The transport. A host executing
 *   fetches outside a browser (an SSR isolate) decides how a site-relative
 *   address is dispatched — through its own origin or a service binding — and
 *   hands that in. Defaults to the global `fetch`, resolved at call time so a
 *   test stub installed later is honoured.
 * @returns {{ cacheKey: (req: Object) => string, resolve: (req: Object, ctx: Object) => Promise<{ data, error?, meta? }> }}
 */
export function createDefaultFetcher({ basePath = '', dev = false, fetch: fetchImpl = null } = {}) {
  const doFetch = (input, init) => (fetchImpl || globalThis.fetch)(input, init)
  const pathPrefix = basePath && basePath !== '/' ? basePath.replace(/\/$/, '') : ''


  // ⭐ THE RECORDS SERVICE — a batch of the misses, one POST, merged per key.
  //
  // The entity store dispatches every config a page needs in one synchronous
  // loop before awaiting any of them, so a question enqueued here and flushed
  // on the next microtask carries every miss of that page in one body. The
  // batch response is never cached as one: each request gets its own answer,
  // keyed by its own question.
  const askQueues = new Map()
  const askRecords = (request, ctx) => {
    // ⛔ A question needs the query's Model ref. A payload that offers the
    // service and carries no `config.queries` entry for the query cannot ask;
    // that is a producer defect and it is said here, per key, with no request.
    if (typeof request.schema !== 'string' || !request.schema) {
      return Promise.resolve({
        data: null,
        error: `the payload offers the records service but carries no Model ref for query ` +
          `"${request.query ?? request.as}" (config.queries) — it cannot be asked`,
      })
    }
    return new Promise((resolve) => {
      const url = resolveServiceUrl(request.ask, pathPrefix)
      let queue = askQueues.get(url)
      if (!queue) {
        queue = []
        askQueues.set(url, queue)
        queueMicrotask(() => {
          askQueues.delete(url)
          flushAsked(url, queue, doFetch)
        })
      }
      queue.push({ request, ctx, resolve })
    })
  }

  return {
    /**
     * The cache identity is the request's ADDRESS — or, when asked of the
     * records service, the QUESTION (`deriveCacheKey` hashes every operator of an address-less
     * request). Operators evaluated here run over a shared cached value and
     * must NOT split the cache: two pages declaring different `where:` clauses
     * against the same path share one entry — the file is fetched once and
     * each page filters its own copy.
     */
    cacheKey(request) {
      return deriveCacheKey(request)
    },

    async resolve(request, ctx = {}) {
      if (!request) return { data: null }
      if (request.ask) return askRecords(request, ctx)
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
      if (path) {
        // Local file under public/ — basePath applies for subpath deploys.
        target = pathPrefix && path.startsWith('/') && !path.startsWith('//')
          ? pathPrefix + path
          : path
      } else if (url) {
        // A URL the author wrote, sent exactly as written.
        target = url
      } else {
        return { data: [], error: 'No path, url or ask specified' }
      }

      const init = { signal: ctx.signal, method }

      if (method === 'POST') {
        // Substitute {paramName} placeholders in body strings using the
        // dynamic-route context. The helper expects a flat key→value map;
        // build it from dynamicContext's { paramName, paramValue } shape.
        // Strict-brace matcher: GraphQL selection sets pass through unchanged.
        const dc = request.dynamicContext
        const body = (rawBody !== undefined && rawBody !== null && dc && dc.paramName)
          ? substitutePlaceholders(rawBody, { [dc.paramName]: dc.paramValue }, { encode: false })
          : rawBody
        if (body !== undefined && body !== null) {
          init.headers = { 'Content-Type': 'application/json' }
          init.body = typeof body === 'string' ? body : JSON.stringify(body)
        }
      }

      try {
        const response = await doFetch(target, init)

        // A per-request envelope (set by the object form of `detail:`) describes
        // this one response.
        const envelope = (request.envelope && typeof request.envelope === 'object')
          ? request.envelope
          : {}

        if (!response.ok) {
          // If `envelope.error` names a path, try to extract a human message
          // from the parsed body; fall back to status text if the path is
          // missing or the body isn't JSON.
          let extracted
          if (envelope.error) {
            try {
              const text = await response.text()
              const body = safeParseJSON(text)
              if (body !== undefined) {
                const candidate = getNestedValue(body, envelope.error)
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

        // Unwrap the response. Per-fetch `transform:` wins; otherwise the
        // envelope's `item` path on a single-record request, `list` on a list.
        const isDetailRequest = !!request.dynamicContext
        const effectiveTransform =
          transform
          || (isDetailRequest ? envelope.item : envelope.list)
        if (effectiveTransform && data !== null && data !== undefined) {
          data = getNestedValue(data, effectiveTransform)
        }

        // Evaluate the query locally. Only applies to array data
        // (filtering/sorting/limiting a single record doesn't make sense).
        // For non-arrays, operators are ignored — the source returned what
        // it returned.
        data = applyOperators(data, request, { dev })

        // ⭐ Say what depth was delivered, so the record index can file it — what
        // the config asked for, echoed: a list at brief depth when the query has
        // a per-record source, a record in full. (The service reports `depths` per
        // key and overrides this with what it actually served.)
        const depth = request.depth === 'brief' || request.depth === 'full' ? request.depth : undefined
        return depth ? { data: data ?? [], meta: { depth } } : { data: data ?? [] }
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
 * One question of a batch, in the records service's own vocabulary
 * (the records contract, §2): `schema` required, `scope` a bare path, `sort`
 * one key spelled `date` / `-date`, `depth` brief or full. The where-object
 * crosses as authored except for the two spellings the language settled
 * differently from the evaluator's: `nin` is `not_in` there, and a top-level
 * `path: { under }` — the file lane's way of naming a folder branch — is
 * `scope`. Anything the service does not accept (`like`, a dotted path) is
 * sent as written and refused there by name: loud, never approximated.
 */
function toQuestion(request) {
  const q = { schema: request.schema }
  let where = request.where && typeof request.where === 'object' ? request.where : null
  let scope = typeof request.scope === 'string' && request.scope ? request.scope : null
  if (where && !scope && where.path && typeof where.path === 'object' && typeof where.path.under === 'string' && where.path.under) {
    const { path, ...rest } = where
    scope = path.under
    where = Object.keys(rest).length ? rest : null
  }
  if (scope) q.scope = scope
  if (where) q.where = renameOperators(where)
  const sort = sortToWire(request.sort)
  if (sort) q.sort = sort
  if (typeof request.limit === 'number' && request.limit > 0) q.limit = request.limit
  if (request.depth === 'brief' || request.depth === 'full') q.depth = request.depth
  // ⭐ `cursor` is the ONLY field here that is not the author's: it is opaque and
  // it comes from a previous answer's `cursors` (the records contract §2). ⛔ And
  // `exhaustive` deliberately does NOT cross — it is a client instruction about
  // how many times to ask, not part of the question being asked.
  if (typeof request.cursor === 'string' && request.cursor) q.cursor = request.cursor
  return q
}

const OPERATOR_ALIAS = { nin: 'not_in' }
function renameOperators(where) {
  if (Array.isArray(where)) return where.map(renameOperators)
  if (!where || typeof where !== 'object') return where
  const out = {}
  for (const [key, value] of Object.entries(where)) {
    out[OPERATOR_ALIAS[key] ?? key] = value && typeof value === 'object' ? renameOperators(value) : value
  }
  return out
}

/**
 * Send one batch to the records service and hand each question its own answer.
 *
 * The response is `{ data, depths?, errors?, cursors?, limits? }` (contract §5):
 * `data` answers exactly the keys sent, `[]` when nothing matched; a key that
 * ERRORED is absent from `data` and present in `errors`; `depths` says what was
 * actually served, which the record index files rather than what was asked for.
 * A key missing from both is a protocol violation and is reported as an error,
 * never as silence.
 *
 * ⭐ `cursors` AND `limits` ARE READ — 2026-09-06 [Diego], reversing the ruling
 * that had them "received and IGNORED, because framework has no paging concept."
 * ⛔ **That ruling described our client and was silently wrong about our USERS:**
 * the service bounds every answer at 100 (the records contract §4.2/§5), and a
 * `cursors` entry is how it says there is more. Discarding both meant a hosted
 * list of 500 rendered 100 — no error, no warning, no way for an author to tell
 * a bound from the end of the data. **The silent class, on a visitor's page.**
 *
 * Two behaviours, deliberately not one:
 *
 *   - **a page render REPORTS** — `meta.truncated` and `meta.bound` ride the
 *     answer, and nothing pages automatically. Auto-paging here would put
 *     unbounded round trips in front of paint for a section that may only show
 *     ten rows.
 *   - **an exhaustive caller PAGES** — `request.exhaustive` follows `cursors`
 *     until the service stops issuing them. `collectSiteRecords` is the caller
 *     that wants it (a corpus is not a page), and `maxPages` bounds the loop so
 *     a service that always answers with a cursor cannot spin.
 */

/** Pages an exhaustive request will follow before giving up and reporting truncation. */
const MAX_PAGES = 50
async function flushAsked(url, queue, doFetch) {
  // One shared page loop: the batch is sent, and any entry that asked to be
  // exhaustive and came back with a cursor is re-sent alone until it is done.
  const pending = new Map()
  const body = {}
  const keys = []
  for (const entry of queue) {
    const base = entry.request.as || 'q'
    let key = base
    for (let n = 2; key in body; n += 1) key = `${base}#${n}`
    keys.push(key)
    body[key] = toQuestion(entry.request)
  }
  let parsed
  try {
    const response = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      // A protocol violation is refused for the WHOLE request with a problem body
      // whose `detail` names the key and the fault (an unknown operator, an empty
      // binding key, a non-BCP-47 locale segment…). Surface that sentence on every
      // key of the batch rather than the bare status: the author reads
      // `block.dataError` and the status alone says nothing they can act on.
      let detail = null
      try {
        const problem = safeParseJSON(await response.text())
        if (problem && typeof problem.detail === 'string' && problem.detail) detail = problem.detail
      } catch { /* an unreadable body falls back to the status line */ }
      const error = detail
        ? `HTTP ${response.status}: ${detail}`
        : `HTTP ${response.status}: ${response.statusText}`
      for (const entry of queue) entry.resolve({ data: null, error })
      return
    }
    parsed = await response.json()
  } catch (error) {
    const message = error?.name === 'AbortError' ? 'aborted' : (error?.message || String(error))
    for (const entry of queue) entry.resolve({ data: null, error: message })
    return
  }
  const data = parsed && typeof parsed.data === 'object' && parsed.data ? parsed.data : {}
  const errors = parsed && typeof parsed.errors === 'object' && parsed.errors ? parsed.errors : {}
  const depths = parsed && typeof parsed.depths === 'object' && parsed.depths ? parsed.depths : {}
  // Both absent when empty, never `{}` (the records contract §5).
  const cursors = parsed && typeof parsed.cursors === 'object' && parsed.cursors ? parsed.cursors : {}
  const limits = parsed && typeof parsed.limits === 'object' && parsed.limits ? parsed.limits : {}
  queue.forEach((entry, i) => {
    const key = keys[i]
    if (key in errors) {
      // A per-key error is `{ code, detail }` — `schema_not_found`,
      // `field_not_in_brief`, `scope_not_found`… The sentence is `detail`; `code`
      // rides beside it for a reader that wants to branch on it.
      const e = errors[key]
      const detail = typeof e === 'string' ? e : (e?.detail || e?.message || JSON.stringify(e))
      const out = { data: null, error: detail }
      if (e && typeof e === 'object' && typeof e.code === 'string') out.code = e.code
      entry.resolve(out)
      return
    }
    if (!(key in data)) {
      entry.resolve({ data: null, error: `the records service answered without the key "${key}"` })
      return
    }
    const depth = depths[key] === 'brief' || depths[key] === 'full'
      ? depths[key]
      : (entry.request.depth === 'brief' || entry.request.depth === 'full' ? entry.request.depth : undefined)

    const cursor = typeof cursors[key] === 'string' && cursors[key] ? cursors[key] : null
    const bound = typeof limits[key] === 'number' ? limits[key] : undefined
    const rows = Array.isArray(data[key]) ? data[key] : data[key]

    // An exhaustive caller collects the page and asks for the next one.
    if (cursor && entry.request.exhaustive && Array.isArray(rows)) {
      const acc = entry.collected ? entry.collected.concat(rows) : rows.slice()
      const page = (entry.page || 1) + 1
      if (page <= MAX_PAGES) {
        pending.set(entry, { cursor, collected: acc, page, depth, bound })
        return
      }
      // The loop's own bound, not the service's: report rather than spin.
      entry.resolve({ data: acc, meta: withMeta({ depth, bound, truncated: true, pages: MAX_PAGES }) })
      return
    }

    const collected = entry.collected ? entry.collected.concat(Array.isArray(rows) ? rows : []) : rows
    const meta = withMeta({
      depth,
      bound,
      // ⭐ A cursor IS the truncation signal, and it is the only one for a query
      // that declared no `limit`: `limits` is reported only when an author's own
      // limit was clamped (the records contract §5).
      truncated: cursor ? true : undefined,
      pages: entry.page && entry.page > 1 ? entry.page : undefined,
    })
    entry.resolve(meta ? { data: collected, meta } : { data: collected })
  })

  if (pending.size === 0) return
  // Re-ask each unfinished key on its own — the cursor is per key, so a batch
  // would have to correlate several independent positions through one body.
  await Promise.all([...pending].map(([entry, state]) => {
    const next = {
      ...entry,
      request: { ...entry.request, cursor: state.cursor },
      collected: state.collected,
      page: state.page,
    }
    return flushAsked(url, [next], doFetch)
  }))
}

/** Build a `meta` from the fields that are actually present, or `undefined`. */
function withMeta(fields) {
  const out = {}
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) out[k] = v
  return Object.keys(out).length ? out : undefined
}

/**
 * Evaluate the query over what the source returned — the ONE evaluator,
 * `@uniweb/core`'s, so the browser orders and filters exactly as the build
 * did when it materialized `/data/<name>.json`.
 */
function applyOperators(data, request, { dev = false } = {}) {
  if (!Array.isArray(data)) return data
  let result = data
  if (request.where) result = matchWhere(request.where, result)
  if (request.sort) result = applySort(result, request.sort, dev)
  if (typeof request.limit === 'number' && request.limit > 0) result = result.slice(0, request.limit)
  return result
}

/**
 * ⛔ This was a second sort implementation until 2026-09-04, and it honoured
 * a comma-separated MULTI-KEY sort the language does not have (single-key by
 * ruling). A bad `sort:` is an authoring error: dev throws so it is seen; in
 * production the records are delivered in source order and the reason is
 * logged once — a wrong order is not worth a broken page for a visitor.
 */
const warnedBadSorts = new Set()
function applySort(items, sortExpr, dev) {
  try {
    return sortRecords(items, sortExpr)
  } catch (err) {
    if (dev) throw err
    const key = String(sortExpr)
    if (!warnedBadSorts.has(key)) {
      warnedBadSorts.add(key)
      console.error(`[default-fetcher] ${err.message} Records delivered unsorted.`)
    }
    return items
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
