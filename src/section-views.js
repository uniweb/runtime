/**
 * section_view — which sections of a page a visitor actually reached.
 *
 * ⭐ **Reached behind a dynamic import** (`hooks/useSectionViews.js`), so a site
 * that instruments no page never downloads this file. Same arrangement as
 * `script-loader.js`: the always-loaded surface is a few lines, the machinery is
 * code-split. **This is the whole reason the opt-in is a declaration rather than
 * a foundation calling a hook** — the declaration is what lets the cost be zero
 * when the answer is no.
 *
 * ## What it emits, and what it deliberately does not
 *
 * One `section_view` per section per page view, the first time that section is
 * at least half visible. Nothing on the way out, and **no duration**.
 *
 * ⛔ **Dwell time is NOT measured, and the reason is validity rather than
 * cost.** An `IntersectionObserver` at 0.5 measures *how long a section was
 * ≥50% in the viewport*, which for a tall section is dominated by **how long it
 * takes to scroll past it**. A tall boring section would outscore a short
 * compelling one on a chart labelled "engagement" — the right number about a
 * different set. The question dwell was meant to answer is already answered by
 * the counts: seen-by 80% / 40% / 15% across a page says where people stopped,
 * with a clean interpretation and no timing at all.
 *
 * ## The element lookup goes through the shared rule
 *
 * Sections are found by `sectionDomId(block)` — the same helper the renderers
 * write the id with — and never by a selector like `[id^="section-"]`. A
 * hardcoded prefix would be a second copy of a rule that already drifted once
 * (the search extractor kept emitting `Section1` while the DOM said
 * `section-what-is-uniweb`, and no test failed). Heading anchors share the id
 * namespace and carry no prefix, so a selector-based lookup would also have to
 * exclude them; deriving from the graph cannot pick them up at all.
 *
 * Design: `kb/framework/plans/tracking.md`.
 *
 * @module @uniweb/runtime/section-views
 */

import { sectionDomId } from '@uniweb/core/section-id'

/** A section counts as seen at half visible — the legacy emitter's threshold. */
const THRESHOLD = 0.5

/**
 * Observe the rendered sections of one page and report each once.
 *
 * @param {object} page - the active `Page`; its blocks carry `track()`
 * @returns {(() => void) | null} teardown, or null when there was nothing to do
 */
export function observeSections(page) {
  if (typeof IntersectionObserver === 'undefined' || typeof document === 'undefined') {
    return null
  }

  // The graph is the source of both the identity and the element. A block whose
  // element is absent is skipped rather than retried: in split-content mode a
  // page's sections can arrive after this runs, and a v1 that silently missed
  // them is better than one that polls. (If that becomes a real gap, the fix is
  // to re-run on the content-loaded signal, not to widen the query.)
  const targets = new Map()
  for (const block of page?.bodyBlocks || []) {
    const el = document.getElementById(sectionDomId(block))
    if (el) targets.set(el, block)
  }
  if (targets.size === 0) return null

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        // `isIntersecting` flips at ANY threshold crossing, so the ratio is
        // checked explicitly — otherwise a section entering by one pixel would
        // report as seen.
        if (!entry.isIntersecting || entry.intersectionRatio < THRESHOLD) continue
        const block = targets.get(entry.target)
        if (!block) continue
        // Unobserve rather than track a reported set: once is once per page
        // view, and dropping the element also drops the work.
        observer.unobserve(entry.target)
        targets.delete(entry.target)
        // The envelope comes from the block — `path`, `section` (the component
        // type) and `section_id` (this instance) are attached for free, and a
        // site with no tracking destination makes this a silent no-op.
        block.track('section_view')
      }
    },
    { threshold: THRESHOLD }
  )

  for (const el of targets.keys()) observer.observe(el)
  return () => observer.disconnect()
}

export default observeSections
