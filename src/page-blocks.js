/**
 * Every block a page's render can reach: its body and the layout areas it uses (the runtime's own
 * layout choice — the page's `layout:`, else the foundation's default, else the site's default set,
 * minus any area the page hides), plus what those blocks hold.
 *
 * ⭐ One walk for the two that ask for a page's data before its render: a host's data step
 * (`load-page-data.js`) and the browser before it shows a page it navigates to (`navigation.js`).
 * So the two cannot disagree about which blocks a page reaches.
 *
 * @param {Object} page - a Page
 * @returns {Object[]} its blocks, each one once
 */
export function blocksOf(page) {
  const out = []
  const walk = (list) => {
    for (const block of list || []) {
      if (!block) continue
      out.push(block)
      walk(block.childBlocks)
      walk(block.insets)
    }
  }
  walk(page.getBodyBlocks?.() ?? page.bodyBlocks)
  for (const area of Object.values(page.getLayoutAreas?.() ?? {})) walk(area)
  return out
}
