/**
 * A rewrite route (`rewrite:` in page.yml) is the HOST's to proxy, before the app loads.
 *
 * ⛔ Until 2026-09-30 PageRenderer reloaded the page whenever the URL resolved to a rewrite. On a
 * host that does not proxy — it serves the app at that URL — the reloaded document resolved to the
 * rewrite again and reloaded again, for ever. Now only an in-app navigation reloads (so a host that
 * proxies can answer); the document's own first load shows the not-found page, as a static build
 * emits no page there.
 *
 * PageRenderer is a React component wired to react-router, so rather than mount it, this reads the
 * component, as `container-redirect-locale.test.js` does, so a revert fails.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../src/components/PageRenderer.jsx', import.meta.url)), 'utf8')

describe('a rewrite route in the app', () => {
  it('on the document\'s first load it is not found — the host did not proxy', () => {
    expect(source).toMatch(/rewriteNotProxied\s*=\s*isRewrite\s*&&\s*location\.key\s*===\s*'default'/)
    expect(source).toMatch(/isNotFound\s*=\s*\(!page && !redirectLocation\)\s*\|\|\s*rewriteNotProxied/)
  })

  it('only an in-app navigation reloads', () => {
    expect(source).toMatch(/if \(isRewrite && !rewriteNotProxied\) \{\s*window\.location\.reload\(\)/)
    // the unconditional reload is gone
    expect(source).not.toMatch(/if \(resolution\?\.kind === 'rewrite'\) \{\s*window\.location\.reload\(\)/)
  })
})
