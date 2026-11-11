// Run AFTER `vite build` (see firebase.json predeploy). Copies the id
// gen-build-id.mjs generated pre-build (and that vite.config.ts baked into
// the bundle as __BUILD_ID__) into dist/ so it's served as a static file.
// Optional arg: the build's output dir (dist-eu for the EU build).
import { copyFileSync } from 'fs'
copyFileSync('.build-id', `${process.argv[2] ?? 'dist'}/build-id.txt`)
