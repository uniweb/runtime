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

## API Reference

### Runtime Functions

| Function | Description |
|----------|-------------|
| `initRuntime(source, options)` | Initialize runtime with foundation |
| `initRTE(source, options)` | Alias for initRuntime |

### Options

```js
initRuntime(source, {
  development: false,    // Enable dev mode (StrictMode, verbose errors)
  configData: null,      // Site content (or reads from DOM)
  basename: undefined    // React Router basename
})
```

### Exported Components

| Component | Description |
|-----------|-------------|
| `ChildBlocks` | Render child sections |
| `ErrorBoundary` | Error boundary wrapper |

### Core Classes (re-exported from @uniweb/core)

| Class | Description |
|-------|-------------|
| `Uniweb` | Main runtime instance |
| `Website` | Page and localization management |
| `Page` | Page representation |
| `Block` | Section/component representation |
| `Input` | Form input handling |
| `createUniweb(config)` | Factory to create Uniweb instance |

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
