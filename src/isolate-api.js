/**
 * The isolate API — what `@uniweb/runtime/ssr` promises a host that renders in an
 * isolate, and the runtime version below which that promise does not hold.
 *
 * ⭐ THE ONE PLACE THE NUMBER IS STATED. A host loads the SITE'S pinned runtime as a
 * dynamically-loaded artifact — never an import — so it cannot link-check what it
 * calls; it feature-detects, and an export that is missing looks exactly like an old
 * runtime. The backend evaluates a site's runtime at publish and holds this floor as
 * a constant of its own [Diego, 2026-09-04: "We will set a runtime version floor that
 * guarantees they are there"], composing it as `max(absoluteFloor, foundationFloors)`.
 * That constant is copied from here, and `tests/isolate-api.test.js` is what keeps
 * this file honest: every export of `src/ssr.js` must appear below with the version
 * it first shipped in, and every name below must still be exported — by the source
 * and by the built `dist/ssr.js` when it is present. Forgetting to stamp a new export
 * fails HERE, in the repo where the change happens; a rename fails here too.
 *
 * ⛔ A floor is a promise about a VERSION, not a rename guard. A site on a newer
 * runtime with a renamed export is still a missing symbol; the test above is what
 * makes that fail before it ships, and the announcement to the consumer is still
 * ours to send, because a consumer that bundles this package by workspace link
 * gets the change at commit time, with no version to pin against.
 *
 * ⛔ Not `runtime-pin.json`. That file is emitted per FOUNDATION build and records an
 * observed fact ("built against"), never a guarantee; an isolate-API floor is a
 * guarantee and is not a property of any foundation. Different kind of claim,
 * different home.
 *
 * "since" is the first PUBLISHED version (git tag) whose `@uniweb/runtime/ssr`
 * exported the name — measured with `git log --reverse -S<name> -- src/ssr.js` and
 * `git tag --contains`, 2026-09-04.
 *
 * ## ⭐ `UNRELEASED` — and why the mechanism needed it
 *
 * ⛔ **This file had no way to stamp an export that has not shipped, and the gap
 * was invisible because it was written retrospectively** (2026-09-04, at 0.14.2,
 * stamping names that had all already published). The first genuinely new export
 * hit it immediately: the test demands every export be stamped, a stamp must be
 * `<=` package.json's version, and the version an export will ship in **does not
 * exist until the publish that creates it** — versions are derived from commits
 * at publish time and never hand-edited.
 *
 * ⚠️ **The tempting fix is the dangerous one.** Stamping the current version
 * (`0.16.0`) would satisfy every check and be **false**: backend reads
 * `minUsable` from the channel index and refuses to serve a site below it,
 * so a floor of 0.16.0 would promise an export that 0.16.0 does not contain —
 * and a host at the floor is entitled to skip feature detection. That is a
 * guarantee broken in the one direction the floor exists to prevent.
 *
 * ⇒ **`UNRELEASED` says the true thing: this export exists in the tree and in no
 * published version.** It is stamped like any other name, so nothing rides out
 * unnoticed, and it is EXCLUDED from the floor — which therefore never promises
 * more than a published artifact delivers. **The floor rises one step after the
 * publish, not one step before it**, and the sequence is:
 *
 *   1. land the export stamped `UNRELEASED` — the floor does not move;
 *   2. publish (Diego; agents never publish);
 *   3. replace `UNRELEASED` with the version that publish produced — the floor
 *      moves here, and the runtime channel's `minUsable` follows at the
 *      next channel publish;
 *   4. tell backend, which holds the number and must ratchet it.
 *
 * ⚖️ **Step 3 is a real obligation, not bookkeeping**: an export left
 * `UNRELEASED` after it ships keeps the floor below its own API forever, so a
 * host feature-detects something it could have relied on. The guard is the
 * test's own message.
 */

/** An export present in the tree and in no published version. Excluded from the floor. */
export const UNRELEASED = 'UNRELEASED'

/** Every export of `@uniweb/runtime/ssr`, with the version it first shipped in. */
export const ISOLATE_API = Object.freeze({
  // props preparation
  prepareProps: '0.2.15',
  applySchemas: '0.2.15',
  applyDefaults: '0.2.15',
  guaranteeContentStructure: '0.2.15',
  getComponentMeta: '0.2.15',
  getComponentDefaults: '0.2.15',
  // rendering
  getWrapperProps: '0.6.14',
  renderBackground: '0.6.14',
  renderBlock: '0.6.14',
  renderBlocks: '0.6.14',
  renderLayout: '0.6.14',
  renderPage: '0.2.15',
  classifyRenderError: '0.6.14',
  injectPageContent: '0.6.14',
  escapeHtml: '0.6.14',
  generate404Html: '0.6.16',
  // initialization
  initPrerender: '0.6.14',
  initPrerenderForLocale: '0.8.9',
  sliceContentForLocale: '0.8.9',
  hydrateDataStore: '0.8.9',
  prefetchIcons: '0.6.14',
  renderAppearanceBootScript: '0.8.30',
  // page resolution
  resolvePage: '0.9.5',
  // server-side prefetch — the runtime executing a page's fetches for a host
  findPageForRoute: '0.14.1',
  resolvePageFetchConfigs: '0.14.1',
  executeFetchConfigs: '0.14.1',
  prefetchPageData: '0.14.1',
  // the composed render entry
  createPageRenderer: '0.14.2',
  prefetchAndHydrate: '0.14.2',
  // the whole corpus, for a host that indexes rather than renders
  collectSiteRecords: '0.17.0',
})

/**
 */
/**
 * ⭐ A RUNTIME BELOW THIS CANNOT TALK TO THE CURRENT RECORDS SERVICE, whatever it
 * exports — so it is a floor for a reason the API map cannot express.
 *
 * `0.18.0` is the first runtime that sends `whole`. Every earlier one sends
 * `depth` on **every** records question, briefs included; `depth` is now an
 * unknown field at the door, and an unknown field is a **protocol violation —
 * a whole-request `400`**. ⇒ On a site pinned below this, **every** live-records
 * fetch fails: the corpus walk a host makes AND the fetches a page render
 * issues. Loud, per key, with a sentence — but total.
 *
 * ⛔ **Why this belongs in the same number rather than beside it.** The floor's
 * job AT ITS CONSUMER is *"never publish a site below this"* — the publisher
 * reads it and refuses a lower version. That behaviour does not care WHY a
 * version is unusable, and a second number to read and compose would be one more
 * thing to miss, failing silently when missed.
 *
 * ⚠️ **This paragraph used to defend the OLD name, and the defence was hollow.**
 * It read: *"the name is now slightly narrow, and that is a deliberate trade —
 * renaming a published key is a cross-lane change for a word."* ⭐ **The whole
 * argument rested on that cost, and the human simply removed it** *(2026-09-06:
 * "It's easy to change it. I can tell backend.")* — so the name was fixed rather
 * than excused, and the key is `minUsable` on the wire.
 *
 * ⇒ *Kept because the shape recurs: an argument whose only support is a cost
 * someone else is willing to pay is not an argument, it is an estimate — and it
 * should be stated as one, so the person holding the cost can overrule it.*
 *
 * ⭐ **RELAXED 2026-09-12 [Diego] — and the paragraph above predicted exactly this
 * shape.** It read: *"Raise this when a runtime change makes an older one unable to
 * speak to a shipped peer. Not for a feature, not for a fix — for an
 * incompatibility."* The ruling:
 *
 * > *"I don't mind raising the floor at this point so we don't need to be checking
 * > all the time what a version supports … we can safely raise the floor while we
 * > are not yet at 1.0.1+. The 0.x line is for active development … And new
 * > runtimes don't break sites. They usually just do a better job."*
 *
 * ⇒ **While in 0.x, raising this is CHEAP and needs no incompatibility.** Its job
 * shifts from *"below this it cannot work"* to *"below this we no longer reason
 * about"* — which is precisely what lets a consumer stop feature-detecting.
 *
 * ⛔ **Two things the ruling does NOT relax, both mechanical:**
 *   1. **Never name a version that does not exist yet.** The floor is stamped AFTER
 *      the publish that creates the version, never in anticipation — the whole
 *      reason `UNRELEASED` exists a few lines up.
 *   2. **A raise is a CROSS-LANE event.** Backend reads this from the channel index
 *      and refuses to serve a site below it, so the number moves for them when the
 *      CHANNEL republishes — not when this constant changes.
 *
 * ⚖️ Revisit at 1.0: once sites are pinned in the field, *"it does not break
 * sites"* stops being free, and this paragraph is the thing to re-argue.
 */
/*
 * ⭐ **0.25.0, raised 2026-09-14 [Diego: "you can raise minUsable now to latest"]** — and
 * it is also an incompatibility floor again: 0.25.0 is the first runtime that asks the
 * records service with `narrow` — the query as saved at the top, the fetch's `where`,
 * `sort`, `limit`, `match` and `cursor` inside `narrow`. Every earlier one sends a
 * top-level `match` or `cursor`, which the service refuses with a whole-request `400`
 * since it took `narrow`. It also carries declared-key delivery and `$route`, so a host
 * at the floor may rely on both.
 */
export const WIRE_FLOOR = '0.25.0'

/**
 * ⭐ **THE MINIMUM RUNTIME VERSION A SITE MAY BE PUBLISHED AT.** At or above it,
 * every name in `ISOLATE_API` is exported AND the runtime can speak to the
 * current records service; below it, a runtime **does not work** — not "is
 * unsupported".
 *
 * ⛔ **The earlier name was wrong twice over, and was replaced 2026-09-06**: the
 * API map is only one of its inputs, and "floor" said nothing about what falls
 * below it. **[Diego, 2026-09-06]** was not convinced by it and said changing it
 * was easy — which removed the only cost the argument for keeping it rested on.
 * ⭐ **`usable` is a claim of FACT** — below it a runtime does not work, rather
 * than merely being unsupported.
 *
 * ⚠️ **The drift that name was chosen to resist was RELAXED 2026-09-12** — see
 * `WIRE_FLOOR` above: while pre-1.0 the floor may be raised simply so nobody has
 * to check what a version supports, so a raise no longer implies a break at the
 * new number. **On the wire it is `minUsable`, and that is the only spelling.**
 */
export const MIN_USABLE_RUNTIME = [WIRE_FLOOR, ...Object.values(ISOLATE_API)]
  .filter((v) => v !== UNRELEASED)
  .reduce((max, v) => (compareVersions(v, max) > 0 ? v : max), '0.0.0')

/** The exports that exist here and in no published version — empty is the steady state. */
export const UNRELEASED_EXPORTS = Object.freeze(
  Object.entries(ISOLATE_API).filter(([, v]) => v === UNRELEASED).map(([name]) => name),
)

/** Compare two `x.y.z` versions numerically. Returns <0, 0 or >0. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}
