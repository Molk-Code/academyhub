// Run BEFORE `vite build` (see firebase.json predeploy). Writes the id vite.config.ts
// embeds as __BUILD_ID__ to a repo-root file so dist/build-id.txt (written by
// copy-build-id.mjs, after the build) ends up with the EXACT same value — the
// client's startup check compares __BUILD_ID__ against a fresh fetch of
// build-id.txt, so they must match whenever a client already has the latest build.
import { writeFileSync } from 'fs'
writeFileSync('.build-id', new Date().toISOString())
