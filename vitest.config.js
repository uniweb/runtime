import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // The JSX transform both builds use (`vite.config.app.js`, `vite.config.ssr.js`): the automatic
  // runtime, so a component that imports no React — `components/Layout.jsx` — renders under test as
  // it ships (`tests/default-layout-parity.test.js`).
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
})
