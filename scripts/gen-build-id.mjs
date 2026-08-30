import { writeFileSync } from 'fs'
writeFileSync('dist/build-id.txt', new Date().toISOString())
