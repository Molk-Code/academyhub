import { defineConfig } from 'vitest/config'
import path from 'path'

// Unit tests for the web app (src/**). Cloud Functions have their own
// emulator tests: npm --prefix functions test
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
