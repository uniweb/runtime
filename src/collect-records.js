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
 * ## ⛔ `limit` IS DROPPED, and it is the one place a corpus must diverge
 *
 * A saved query's `limit` is the LIST PAGE's presentation: `limit: 20` means the
 * page shows twenty. **Its detail pages still exist for every record matching
 * `scope` + `where`** — so a corpus that honoured `limit` would index twenty and
 * miss every page beyond them, which is worse than indexing nothing because the
 * gap is invisible.
 *
 * ⚠️ **This shipped wrong in 0.17.0 and was found by the consumer, not by us**
 * (2026-09-06): the config was passed through unchanged, `limit` crossed as the
 * question's own, and the corpus was capped. The claim that this surface met
 * "the population its detail pages can reach" was made *"read charitably"* — a
 * phrase doing work that one `sed` would have done better.
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
 * @param {'brief'|'full'} [options.depth='brief'] - what to ask for. `brief` is
 *   what a list shows; **`full` is what an index wants** — a brief index cannot
 *   match body text the record's own detail page displays, and a reader who
 *   finds a word on the page and not in search meets the inconsistency two
 *   rankings would produce. The cost is the caller's and is bounded by `maxPages`.
 * @param {number} [options.maxPages] - the caller's own bound on the walk. The
 *   default is a bound, not a target; a caller that knows its per-request budget
 *   passes its own.
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
    // `limit` is the list page's, never the corpus's — see the header.
    const { limit, ...population } = cfg
    const asked = { ...population, whole, exhaustive: true }
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
