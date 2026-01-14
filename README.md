# @uniweb/runtime

Runtime loader and Vite plugins for Uniweb sites.

## Overview

This package provides the runtime environment for Uniweb sites—content-driven websites that load Foundation components dynamically. It bridges site content with Foundation components and provides Vite plugins for development.

## Installation

```bash
npm install @uniweb/runtime
```

## Features

- **Foundation Loading** - Load Foundations via dynamic import or import maps
- **Content Rendering** - Render pages from structured content (JSON/YAML)
- **Vite Plugins** - Collect site content and serve foundations in development
- **React Integration** - Built on React with React Router for navigation

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

### Vite Plugins for Sites

Use the Vite plugins to collect content and optionally serve a foundation:

```js
// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { siteContentPlugin, foundationPlugin } from '@uniweb/runtime/vite'

export default defineConfig({
  plugins: [
    react(),

    // Collect content from pages/ directory
    siteContentPlugin({
      sitePath: './',
      inject: true,  // Inject into HTML
    }),

    // Optional: Serve foundation in dev mode
    foundationPlugin({
      name: 'my-foundation',
      path: '../my-foundation',
      serve: '/foundation',
    }),
  ]
})
```

### Site Content Structure

Sites use a pages/ directory structure:

```
site/
├── site.yml           # Site configuration
├── theme.yml          # Theme configuration
└── pages/
    ├── @header/       # Special: header section
    │   └── 1.md
    ├── @footer/       # Special: footer section
    │   └── 1.md
    ├── home/          # Home page (route: /)
    │   ├── page.yml   # Page metadata
    │   ├── 1.md       # First section
    │   └── 2.md       # Second section
    └── about/         # About page (route: /about)
        ├── page.yml
        └── 1.md
```

### Section Markdown Format

Each `.md` file is a section with YAML frontmatter:

```markdown
---
component: Hero
preset: default
title: Welcome to Our Site
subtitle: Building the future together
---

Additional markdown content here...
```

## API Reference

### Runtime Functions

| Function | Description |
|----------|-------------|
| `initRuntime(source, options)` | Initialize runtime with foundation |
| `initRTE(source, options)` | Alias for initRuntime |

### Exported Components

| Component | Description |
|-----------|-------------|
| `Link` | Router-aware link component |
| `SafeHtml` | Safe HTML rendering |
| `ChildBlocks` | Render child sections |
| `ErrorBoundary` | Error boundary wrapper |

### Vite Plugins

| Plugin | Description |
|--------|-------------|
| `siteContentPlugin(options)` | Collect and inject site content |
| `foundationPlugin(options)` | Build and serve foundation in dev |
| `collectSiteContent(sitePath)` | Programmatic content collection |

### Plugin Options

**siteContentPlugin:**
```js
{
  sitePath: './',           // Path to site directory
  pagesDir: 'pages',        // Pages subdirectory
  inject: true,             // Inject into HTML
  filename: 'site-content.json',  // Output filename
  watch: true               // Watch for changes (dev)
}
```

**foundationPlugin:**
```js
{
  name: 'foundation',       // Foundation name (for logs)
  path: '../foundation',    // Path to foundation package
  serve: '/foundation',     // URL path to serve from
  watch: true,              // Watch for changes
  buildOnStart: true        // Build when dev server starts
}
```

## Core Classes

### Uniweb

The main runtime instance (available as `globalThis.uniweb`):

```js
uniweb.getComponent(name)     // Get component from foundation
uniweb.listComponents()       // List available components
uniweb.activeWebsite          // Current website instance
```

### Website

Manages pages, theme, and localization:

```js
website.getPage(route)        // Get page by route
website.setActivePage(route)  // Navigate to page
website.localize(value)       // Localize a value
website.getLanguage()         // Get current language
```

### Block

Represents a section on a page:

```js
block.initComponent()         // Initialize foundation component
block.getBlockContent()       // Get structured content
block.getBlockProperties()    // Get configuration properties
block.getBlockLinks()         // Get links from content
```

## Two Loading Modes

### Runtime Loading (Import Maps)

Foundation loaded at runtime via dynamic import. React provided by host via import map.

```html
<script type="importmap">
{
  "imports": {
    "react": "https://esm.sh/react@18",
    "react-dom": "https://esm.sh/react-dom@18"
  }
}
</script>
```

### Static Bundling

Foundation imported directly and bundled with the site.

```jsx
import * as Foundation from '@my-org/my-foundation'
import { initRuntime } from '@uniweb/runtime'

initRuntime(Foundation)
```

## Related Packages

- [`uniweb`](https://github.com/uniweb/cli) - CLI for creating Uniweb projects
- [`@uniweb/build`](https://github.com/uniweb/build) - Foundation build tooling

## License

Apache 2.0
