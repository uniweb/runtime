/**
 * Prefetch on intent: a link's page is fetched while the reader is about to follow it.
 *
 * Only a site whose content is split loads this module (`useLinkInterceptor`). A site whose
 * pages all arrived with it never downloads it, so the runtime every site carries pays only for
 * the decision.
 *
 * A pointer resting on a link, or focus staying on one, for INTENT_DELAY fetches the split
 * content of the page the link goes to. A press fetches it at once, since a touch has no hover.
 * The click that follows then usually finds the content here, and the page changes without
 * waiting (`navigation.js`). A pointer sweeping across a rail of links fetches nothing, and
 * nothing is fetched for a connection that asks to save data.
 */

import { prefetchContent } from './navigation.js'
import { findAnchorElement, inAppLink, localeSwitchOf } from './hooks/useLinkInterceptor.js'

/** How long a pointer rests on a link, or focus stays on it, before its page is fetched. */
const INTENT_DELAY = 65

/**
 * Fetch the split content of the page a link goes to, when a click on it would navigate in the
 * app: not a fragment on this page, a `<Link reload>`, or a page in another locale.
 *
 * @param {HTMLAnchorElement} anchor
 */
function prefetchFor(anchor) {
  const link = inAppLink(anchor)
  if (!link || link.href.startsWith('#') || anchor.hasAttribute('data-reload')) return
  if (localeSwitchOf(link.routeHref, link.website)) return
  prefetchContent(link.routeHref)
}

/**
 * Fetch a link's page whenever a reader is about to follow it.
 *
 * @returns {() => void} stops watching
 */
export function watchLinkIntent() {
  if (globalThis.navigator?.connection?.saveData) return () => {}

  let intent = null

  const rest = (event) => {
    const anchor = findAnchorElement(event.target)
    if (!anchor || anchor === intent?.anchor) return
    clearTimeout(intent?.timer)
    intent = { anchor, timer: setTimeout(() => prefetchFor(anchor), INTENT_DELAY) }
  }

  const leave = (event) => {
    if (!intent || intent.anchor.contains(event.relatedTarget)) return
    clearTimeout(intent.timer)
    intent = null
  }

  const press = (event) => {
    const anchor = findAnchorElement(event.target)
    if (anchor) prefetchFor(anchor)
  }

  const listeners = [
    ['pointerover', rest],
    ['focusin', rest],
    ['pointerout', leave],
    ['focusout', leave],
    ['pointerdown', press],
  ]
  for (const [type, listener] of listeners) document.addEventListener(type, listener)

  return () => {
    for (const [type, listener] of listeners) document.removeEventListener(type, listener)
    clearTimeout(intent?.timer)
  }
}
