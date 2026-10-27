import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * DistriFlow unit-test config (audit Finding 2-d#1 — zero test infrastructure).
 * Tests are colocated with sources as src/lib/*.test.ts.
 * Setup steps live in docs/TESTING.md:
 *   npm i -D vitest   →   npm test  (add "test": "vitest run" to package.json scripts)
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // mirrors tsconfig.json paths: "@/*": ["./src/*"]
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
