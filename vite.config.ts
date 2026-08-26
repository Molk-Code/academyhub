import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(new Date().toISOString()),
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
