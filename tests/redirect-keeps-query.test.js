/**
 * A redirect keeps the query and fragment the visitor arrived with — never onto another origin.
 *
 * A site's backend mails its links to the site's root, a token in the query (`/?verify=…`,
 * `/?reset=…`), and the member area reads it there. A root that redirects — an authored
 * `redirect:`, a page with no content of its own — sends the visitor on before any code runs.
 * ⛔ Until 2026-10-11 PageRenderer navigated to the redirect's location alone, so the token was
 * dropped on the way. The rule is `carryQuery` (`@uniweb/core/resolve-route`, pinned in core's
 * `resolve-route.test.js`); PageRenderer is a React component wired to react-router, so rather than
 * mount it, this reads the component, as `container-redirect-locale.test.js` does, so a revert fails.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../src/components/PageRenderer.jsx', import.meta.url)), 'utf8')

describe('a redirect in the app', () => {
  it("carries the visitor's query and fragment, against this document's origin", () => {
    expect(source).toMatch(/import \{ carryQuery \} from '@uniweb\/core\/resolve-route'/)
    expect(source).toMatch(
      /const to = carryQuery\(redirectLocation, \{ search: location\.search, hash: location\.hash \}, window\.location\.origin\)/,
    )
  })

  it('goes where the carried location says, in the app or out of it', () => {
    expect(source).toMatch(/window\.location\.replace\(to\)/)
    expect(source).toMatch(/navigate\(to, \{ replace: true \}\)/)
    // the bare location is gone from both
    expect(source).not.toMatch(/window\.location\.replace\(redirectLocation\)/)
    expect(source).not.toMatch(/navigate\(redirectLocation, \{ replace: true \}\)/)
  })

  it('runs again when only the query or fragment changes', () => {
    expect(source).toMatch(/\[redirectLocation, location\.search, location\.hash, navigate\]/)
  })
})
