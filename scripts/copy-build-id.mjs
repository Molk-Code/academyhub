// Run AFTER `vite build` (see firebase.json predeploy). Copies the id
// gen-build-id.mjs generated pre-build (and that vite.config.ts baked into
// the bundle as __BUILD_ID__) into dist/ so it's served as a static file.
import { copyFileSync } from 'fs'
copyFileSync('.build-id', 'dist/build-id.txt')
