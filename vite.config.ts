import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { existsSync, readFileSync } from 'fs'

// scripts/gen-build-id.mjs writes this before `vite build` runs (see
// firebase.json predeploy) so the id embedded here matches the one later
// copied to dist/build-id.txt byte-for-byte — falls back to a fresh
// timestamp for local dev, where that predeploy step never runs.
const buildId = existsSync('.build-id') ? readFileSync('.build-id', 'utf-8').trim() : new Date().toISOString()

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  esbuild: {
    drop: ['console', 'debugger'],
  },
  build: {
    target: ['safari14', 'ios14', 'chrome87', 'firefox78', 'edge88'],
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-firebase':  ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/functions', 'firebase/storage', 'firebase/messaging'],
          'vendor-react':     ['react', 'react-dom', 'react-router-dom'],
          'vendor-editor':    ['@uiw/react-md-editor', 'react-markdown'],
          'vendor-scanner':   ['@zxing/browser', '@zxing/library'],
          'vendor-dnd':       ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          'vendor-qr':        ['qrcode.react'],
          'vendor-xlsx':      ['xlsx'],
        },
      },
    },
  },
})
