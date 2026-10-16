import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(projectRoot, 'public', 'standalone.html')
const namesPath = join(projectRoot, 'public', 'device-names.json')
const distPath = join(projectRoot, 'dist')

if (!existsSync(sourcePath)) {
  console.error(`[static] Missing standalone source: ${sourcePath}`)
  process.exit(1)
}

const html = readFileSync(sourcePath, 'utf8')
if (!html.includes('<canvas id="mesh"') || !html.includes("getContext('webgl'")) {
  console.error('[static] Source is missing the WebGL network renderer.')
  process.exit(1)
}
if (/<script[^>]+src=["']https?:\/\/|<link[^>]+href=["']https?:\/\//i.test(html)) {
  console.error('[static] The standalone page must not depend on remote scripts or stylesheets.')
  process.exit(1)
}

mkdirSync(distPath, { recursive: true })
for (const entry of readdirSync(distPath)) {
  // A legacy platform-owned redirects file may be read-only; it is inert and not
  // referenced by the static application, so leave it untouched if present.
  if (entry === '_redirects') continue
  try {
    rmSync(join(distPath, entry), { recursive: true, force: true })
  } catch (error) {
    console.error(`[static] Could not clear dist/${entry}: ${error.message}`)
    process.exit(1)
  }
}

writeFileSync(join(distPath, 'index.html'), html)
if (!existsSync(namesPath)) { console.error('[static] Missing public/device-names.json'); process.exit(1) }
writeFileSync(join(distPath, 'device-names.json'), readFileSync(namesPath))
console.log(`[static] Built standalone page and device dictionary in dist/ (${Buffer.byteLength(html)} bytes)` )
