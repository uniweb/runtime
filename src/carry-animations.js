/**
 * A page's CSS animations carry on across the browser's first render.
 *
 * ⭐ The browser renders over a prerendered page rather than hydrating it (`createRoot`, `index.jsx`),
 * and a CSS animation's clock belongs to its element. So the commit that replaces the page restarts
 * every animation in it, and a page's first commit usually lands while its entrance is still running:
 * a hero already on screen would drop back to invisible and play again. `uniweb dev` never prerenders,
 * so a foundation's author never sees it.
 *
 * Each animation of the new page takes as its start the moment the old page was first painted, which
 * is when its twin started, so it goes on from where its twin was. The observer fires after the commit
 * and before the browser paints, so no frame shows a restart. It disconnects at that first commit, so
 * a later navigation is left as it was.
 *
 * ⭐ The time of first paint rather than the old animations' own start times, read before the commit:
 * an animation that has ended with no fill is gone from `getAnimations()`, and its twin would play
 * again.
 *
 * ⛔ Only a running animation on the document's timeline:
 * - a paused one is waiting for something, like a reveal that starts when its section scrolls into
 *   view, and setting a start time would start it;
 * - a scroll-driven one has a timeline of its own, whose time is no moment on this clock.
 *
 * It reaches CSS animations alone. One a component starts from JavaScript when it mounts never ran on
 * the prerendered page: it starts at boot, over whatever that page has shown by then.
 *
 * Nothing to carry: an empty root (`uniweb dev`, a page served without a prerender), and a page not
 * painted yet, whose first render is the first thing a visitor sees. That can include a page painted
 * a frame ago, which the browser has not reported yet: its animations have hardly begun.
 *
 * @param {Element} root - The element React is about to render into.
 */
export function carryAnimations(root) {
  if (!root.firstChild || !document.getAnimations) return
  new MutationObserver((_, watch) => {
    watch.disconnect()
    const painted = performance.getEntriesByName('first-contentful-paint')[0]?.startTime
    if (painted == null) return
    for (const animation of document.getAnimations()) {
      if (
        animation.animationName &&
        animation.playState === 'running' &&
        animation.timeline === document.timeline &&
        root.contains(animation.effect?.target)
      ) {
        animation.startTime = painted
      }
    }
  }).observe(root, { childList: true })
}
