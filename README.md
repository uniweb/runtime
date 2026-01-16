# @uniweb/runtime

Minimal runtime for loading Uniweb foundations and orchestrating rendering.

## Overview

This package provides the browser-side runtime for Uniweb sites. It loads foundations dynamically and renders content using React Router.

For Vite build plugins, see [`@uniweb/build`](https://github.com/uniweb/build).

## Installation

```bash
npm install @uniweb/runtime
```

## Usage

### Runtime Loading

Initialize the runtime with a Foundation URL:

```jsx
import { initRuntime } from '@uniweb/runtime'

// Load foundation from URL
initRuntime('/foundation/foundation.js', {
  development: import.meta.env.DEV,
})

// Or with CSS
initRuntime({
  url: '/foundation/foundation.js',
  cssUrl: '/foundation/assets/style.css'
})
```

### Static Bundling

Foundation imported directly and bundled with the site:

```jsx
import * as Foundation from '@my-org/my-foundation'
import { initRuntime } from '@uniweb/runtime'

initRuntime(Foundation)
```

## API

### initRuntime(source, options)

Initialize the runtime with a foundation.

**source** - One of:
- URL string to foundation module
- Object with `{ url, cssUrl }`
- Foundation module object (for static bundling)

**options:**
```js
{
  development: false,    // Enable dev mode (StrictMode, verbose errors)
  configData: null,      // Site content (or reads from DOM)
  basename: undefined    // React Router basename
}
```

For core classes (`Uniweb`, `Website`, `Block`, etc.), import from [`@uniweb/core`](https://github.com/uniweb/core).

## Architecture

```
@uniweb/runtime (browser)
    │
    ├── Loads foundation dynamically
    ├── Creates Uniweb instance via @uniweb/core
    └── Orchestrates React/Router rendering
```

Foundations should:
- Import components from `@uniweb/kit` (bundled)
- Mark `@uniweb/core` as external (provided by runtime)

## Build Plugins

Vite plugins have moved to `@uniweb/build`:

```js
// vite.config.js
import { siteContentPlugin } from '@uniweb/build/site'
import { foundationDevPlugin } from '@uniweb/build/dev'

export default defineConfig({
  plugins: [
    siteContentPlugin({ sitePath: './', inject: true }),
    foundationDevPlugin({ path: '../foundation', serve: '/foundation' }),
  ]
})
```

## Related Packages

- [`@uniweb/core`](https://github.com/uniweb/core) - Core classes (Uniweb, Website, Block)
- [`@uniweb/kit`](https://github.com/uniweb/kit) - Component library for foundations
- [`@uniweb/build`](https://github.com/uniweb/build) - Vite build plugins
- [`uniweb`](https://github.com/uniweb/cli) - CLI for creating projects

## License

Apache 2.0
