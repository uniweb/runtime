/**
 * The built-in layout — what a page renders with when the foundation offers no layout for it
 * (`Page.getLayoutName()` is null, or names none the foundation has): the header, the body and
 * the footer in one full-height column. Any other area is passed in and not drawn.
 *
 * ⭐ ONE COPY, FOR BOTH RENDERERS: the browser's (`components/Layout.jsx`) and the prerender's
 * (`ssr-renderer.js`, behind `uniweb build` and a host's prerender alike). It needs no hooks, no
 * Router and no DOM, so it is written with `createElement` and both import it — the L3 twins
 * exist for code that needs those, and this needs none.
 * ⛔ Until 2026-10-07 each renderer wrote its own, and the prerender's had no column: the browser
 * replaces the prerendered HTML rather than hydrating it, so a short page's footer sat right under
 * its content in the first paint — and in what a crawler reads — and jumped to the bottom when the
 * browser's render took over. Pinned by `tests/default-layout-parity.test.js`.
 *
 * ⛔ No stacking is set here. The areas arrive ordered: the runtime gives each area wrapper its
 * layer (`area-wrappers.js`), so chrome paints above the body whether or not view transitions are
 * on, and a foundation can re-rank them with `layers` in its layout meta. This layout used to
 * hard-code `z-index: 40` on the header and `30` on the footer for that job; once the runtime owned
 * the ordering, those numbers were a second mechanism for it, and the older one won — a positioned
 * element here becomes a stacking context that seals the area's own layer inside it. Measured
 * 2026-07-31: `layers: { header: 0 }` on the default layout changed nothing.
 */

import React from 'react'

const COLUMN = { display: 'flex', flexDirection: 'column', minHeight: '100vh' }
const GROW = { flex: 1 }

/**
 * @param {{ header?: React.ReactNode, body?: React.ReactNode, footer?: React.ReactNode }} props
 * @returns {React.ReactElement}
 */
export function DefaultLayout({ header, body, footer }) {
  return React.createElement(
    'div',
    { style: COLUMN },
    header && React.createElement('header', null, header),
    body && React.createElement('main', { style: GROW }, body),
    footer && React.createElement('footer', null, footer),
  )
}
