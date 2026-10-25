/**
 * THE HOST'S TRANSPORT, REQUIRED — on every entry a host calls to have the runtime fetch on its
 * behalf: `loadPageData`, `prefetchAndHydrate` and `collectSiteRecords`.
 *
 * ⛔ The failure this prevents is not "no transport". `createDefaultFetcher` resolves its transport
 * as `fetchImpl || globalThis.fetch`, so a missing one becomes the ambient network — in an isolate,
 * the isolate's own, outside the host's timeout and byte budget and outside its resolution of
 * site-relative addresses. With an absolute address the request does not even fail: it leaves from
 * the wrong place and comes back `fetched`. A wiring mistake wearing a success.
 *
 * Reachable, not hypothetical: a host measured against a real isolate loader (2026-09-03) that a
 * function passed through an entrypoint's `fetch(Request)` with a JSON body arrives `undefined`,
 * and survives only as an RPC method argument.
 *
 * ⛔ Until 2026-10-25 only `prefetchAndHydrate` refused one, while the entries a host's isolate
 * calls — the data step and the corpus entry — fell back to the ambient network silently.
 *
 * The default stays where it is right: in the browser, which has one network, and in a harness
 * that builds a default fetcher itself. A caller of these entries that wants the ambient fetch
 * passes `fetch: globalThis.fetch`, which is one word and says so.
 *
 * Zero-dependency leaf, so the data step's graph stays renderer-free (`tests/data-step-graph.test.js`).
 *
 * @param {*} fetch - what the caller passed as `fetch`
 * @param {string} entry - the entry's name, for the message
 * @returns {Function} the transport
 */
export function requireTransport(fetch, entry) {
  if (typeof fetch === 'function') return fetch
  throw new Error(
    `${entry}: \`fetch\` must be a function. A transport does not survive a ` +
    'JSON-serialized isolate boundary — pass it as an RPC method argument. ' +
    'To use the ambient fetch deliberately, pass `fetch: globalThis.fetch`.'
  )
}
