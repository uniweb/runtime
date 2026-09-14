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
 * page render uses**, applying each saved query's own `scope` and `where` — and
 * asks through the same client.
 *
 * ## ⭐ Each query is asked AS SAVED — its `limit` included
 *
 * A query defines its SET: the records its `scope` and `where` select, in its
 * `sort`, up to its `limit` (ruled 2026-09-14 [Diego]). A parametric page has a URL
 * for each record of its route query's set and no other, so the set is exactly the
 * population a site's pages reach — a field note older than a query's 100 most recent
 * has no page to index. Asked with no `narrow`, the service answers the set whole in
 * one answer, so a walk has nothing to page; it still follows a cursor if one ever
 * comes back, bounded by `maxPages`.
 *
 * ⛔ **Until 2026-09-14 this dropped the query's `limit`**, on the rule it replaced — a
 * `limit` was the list page's presentation and every record matching `scope` + `where`
 * had a page — which was right under that rule. ⚠️ And that rule's own history: the
 * first version, in 0.17.0, passed `limit` through while claiming the corpus was the
 * population detail pages reach, and the consumer found it (2026-09-06).
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
 * @param {boolean} [options.whole=false] - what to ask for. `false` is the brief a
 *   list shows; **`true` — whole records — is what an index wants**: a brief index
 *   cannot match body text the record's own detail page displays, and a reader who
 *   finds a word on the page and not in search meets the inconsistency two
 *   rankings would produce. The cost is the caller's, and bounded by each query's
 *   own `limit`. An external query is never collected — it has no records service
 *   to ask.
 * @param {number} [options.maxPages] - the caller's own bound on a walk that pages. A
 *   question with no `narrow` is answered whole with no cursor, so today's walk is one
 *   request per query; the bound holds should a service page anyway.
 * @returns {Promise<{records: Object, errors: Object|null, meta: Object}>}
 *   `records` is keyed by query NAME, each a flat array; `errors` is keyed the
 *   same and is null when nothing failed; `meta[name]` carries
 *   `{ depth, pages, partial?, bound? }`.
 *
 *   ⭐ **`partial` means NOT THE WHOLE POPULATION**, and a key can be in BOTH
 *   `records` and `errors`: a walk that failed or was aborted with pages already
 *   in hand keeps them, marked. ⛔ Losing them would be indistinguishable from
 *   "this query has no records", and on an abort every in-flight key fails at
 *   once — so discarding would lose the corpus, not a key.
 */
export async function collectSiteRecords(
  content,
  { locale, fetch, signal, only = null, whole = false, maxPages } = {},
) {
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
    // The query as saved — the set its pages reach, its `limit` included; see the header.
    const asked = { ...cfg, whole, exhaustive: true }
    if (typeof maxPages === 'number' && maxPages > 0) asked.maxPages = maxPages

    const result = await fetcher.resolve(asked, { signal })
    if (result?.error) errors[name] = result.error
    // ⭐ Data and an error are not exclusive: a partial walk reports both, and
    // the caller decides whether partial is usable. Only a walk that collected
    // nothing leaves the key out of `records` entirely.
    if (Array.isArray(result?.data)) records[name] = result.data
    else if (!result?.error) records[name] = []
    if (result?.meta) meta[name] = result.meta
  }))

  return { records, errors: Object.keys(errors).length ? errors : null, meta }
}

function empty() {
  return { records: {}, errors: null, meta: {} }
}
