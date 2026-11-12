import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { existsSync, readFileSync } from 'fs'

// scripts/gen-build-id.mjs writes this before `vite build` runs (see
// firebase.json predeploy) so the id embedded here matches the one later
// copied to dist/build-id.txt byte-for-byte — falls back to a fresh
// timestamp for local dev, where that predeploy step never runs.
const buildId = existsSync('.build-id') ? readFileSync('.build-id', 'utf-8').trim() : new Date().toISOString()

// Static pages that need this build's Firebase config. They live in
// firebase-templates/ with %VITE_*% placeholders, filled from the mode's env
// (.env for production, .env.eu for --mode eu) and served at the site root.
const FIREBASE_TEMPLATES = ['firebase-messaging-sw.js', 'display.html']

function firebaseTemplates(): Plugin {
  let env: Record<string, string> = {}
  const render = (file: string) =>
    readFileSync(path.resolve(__dirname, 'firebase-templates', file), 'utf-8')
      .replace(/%(VITE_\w+)%/g, (_, key: string) => {
        if (!env[key]) throw new Error(`${file}: ${key} is not set for this mode`)
        return env[key]
      })
  return {
    name: 'firebase-templates',
    configResolved(config) {
      env = loadEnv(config.mode, config.envDir || process.cwd(), 'VITE_')
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = FIREBASE_TEMPLATES.find(f => req.url?.split('?')[0] === `/${f}`)
        if (!file) return next()
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html')
        res.end(render(file))
      })
    },
    generateBundle() {
      for (const file of FIREBASE_TEMPLATES) this.emitFile({ type: 'asset', fileName: file, source: render(file) })
    },
  }
}

const VENDOR_CHUNKS: [string, RegExp][] = [
  ['vendor-react',    /^(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)$/],
  ['vendor-firebase', /^(firebase|@firebase\/.+)$/],
  ['vendor-editor',   /^@uiw\/.+$/],
  ['vendor-scanner',  /^@zxing\/.+$/],
  ['vendor-dnd',      /^@dnd-kit\/.+$/],
  ['vendor-qr',       /^qrcode\.react$/],
]

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    firebaseTemplates(),
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
        // By package path, not entry list: an entry list also claims the entry's
        // dependencies, which put react/jsx-runtime in vendor-editor and made
        // every page download the markdown editor.
        manualChunks(id) {
          const m = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
          if (!m) return
          // Loaded on first use (uploads, push setup): keep them out of the up-front chunk
          if (/node_modules\/@?firebase\/(storage|messaging)\//.test(id)) return
          return VENDOR_CHUNKS.find(([, re]) => re.test(m[1]))?.[0]
        },
      },
    },
  },
})
