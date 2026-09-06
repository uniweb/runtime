/**
 * Every record a site's declared queries return — for a host building something
 * over the whole corpus rather than rendering one page.
 *
 * ## Why this is framework's and not the caller's
 *
 * A host that indexes a site has to ask the same questions the site's pages ask.
 * ⛔ **If it composes its own, the index and the page can disagree**, and the way
 * they disagree is the worst one available: the index offers a result whose page
 * then renders empty. That is the two-answers-to-one-question failure the GET
 * lane was retired for, reintroduced one lane over.
 *
 * ⇒ So the composition is not duplicated here either. This walks the site's
 * `config.queries`, hands each one to `resolveFetchConfigs` — **the same rule a
 * page render uses**, applying each saved query's own `scope` / `where` / `sort`
 * / `limit` — and asks through the same client. What differs from a page is two
 * fields and nothing else: `depth: 'brief'` (an index wants what a list shows)
 * and `exhaustive: true` (a corpus is not a page, so it follows `cursors` to the
 * end; the records contract bounds a single answer at 100).
 *
 * ## What the caller supplies
 *
 * ⭐ **The transport, and nothing else.** A host outside a browser decides how a
 * site-relative address is dispatched — through its own origin, a service
 * binding, a forwarding table that turns `/_…` into an upstream — and hands that
 * in as `fetch`. **Framework decides what to ask and how to read the answer;
 * the host decides how the bytes travel.** That split is the whole of the
 * boundary here.
 *
 * ⛔ **A site with no records service is not an error.** It has no live records,
 * so this returns empty rather than throwing: a static site's corpus comes from
 * its own compiled artifacts, which the caller already has.
 */

import { resolveFetchConfigs } from '@uniweb/core/fetch-config'
import { resolveRecordsService } from '@uniweb/core/records-service'
import { createDefaultFetcher } from './default-fetcher.js'

/**
 * Ask a site's records service for every record its declared queries return.
 *
 * @param {Object} content - the render payload (`config.services`, `config.queries`)
 * @param {Object} options
 * @param {string} options.locale - the locale to ask in; it is a route segment
 *   of the service's address, so there is no asking without one
 * @param {Function} options.fetch - the transport, `(url, init) => Response`
 * @param {AbortSignal} [options.signal]
 * @param {string[]} [options.only] - restrict to these query names
 * @returns {Promise<{records: Object, errors: Object|null, meta: Object}>}
 *   `records` is keyed by query NAME, each a flat array; `errors` is keyed the
 *   same and is null when nothing failed; `meta[name]` carries `{ depth, pages,
 *   truncated? }` — `truncated` meaning the loop hit its own bound, never that
 *   the site has more.
 */
export async function collectSiteRecords(content, { locale, fetch, signal, only = null } = {}) {
  const config = content?.config
  const services = config?.services ?? null
  const queries = config?.queries ?? null

  // No service, no queries, or no locale to ask in ⇒ nothing to collect. Each is
  // an ordinary state of a site, not a fault: the caller reads its own artifacts.
  if (!queries || typeof queries !== 'object') return empty()
  if (!resolveRecordsService(services, locale)) return empty()

  const names = Object.keys(queries).filter((n) => (only ? only.includes(n) : true))
  if (names.length === 0) return empty()

  // One synthetic source per query — `as` is the query's own name, so the answer
  // comes back under the name the caller asked by.
  const configs = resolveFetchConfigs(
    names.map((name) => ({ query: name, as: name })),
    { services, queries, locale, defaultLocale: config?.defaultLanguage ?? locale },
  )

  const fetcher = createDefaultFetcher({ fetch, basePath: config?.base ?? '' })
  const records = {}
  const errors = {}
  const meta = {}

  await Promise.all([...configs].map(async ([name, cfg]) => {
    // ⛔ Only a config the service answers. A query that resolved to a compiled
    // `path` has no live lane, and reading that file is the caller's business,
    // not ours — it is in the site's own URL space and they already serve it.
    if (!cfg.ask) return
    const result = await fetcher.resolve({ ...cfg, depth: 'brief', exhaustive: true }, { signal })
    if (result?.error) {
      errors[name] = result.error
      return
    }
    records[name] = Array.isArray(result?.data) ? result.data : []
    if (result?.meta) meta[name] = result.meta
  }))

  return { records, errors: Object.keys(errors).length ? errors : null, meta }
}

function empty() {
  return { records: {}, errors: null, meta: {} }
}
