import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileDeviceNameMatrix, readDeviceNameMatrix } from './compile-device-matrix.mjs'
import { compileNetworkTopology } from './compile-network-topology.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(projectRoot, 'public', 'standalone.html')
const namesPath = join(projectRoot, 'public', 'device-names.json')
const topologyPath = join(projectRoot, 'public', 'network-topology.json')
const distPath = join(projectRoot, 'dist')

if (!existsSync(sourcePath)) {
  console.error(`[static] Missing standalone source: ${sourcePath}`)
  process.exit(1)
}

if (!existsSync(namesPath)) {
  console.error('[static] Missing public/device-names.json')
  process.exit(1)
}
if (!existsSync(topologyPath)) {
  console.error('[static] Missing public/network-topology.json')
  process.exit(1)
}

const matrix = readDeviceNameMatrix(namesPath)
let topology
try {
  topology = compileNetworkTopology(JSON.parse(readFileSync(topologyPath, 'utf8')), matrix)
} catch (error) {
  console.error(`[static] ${error.message}`)
  process.exit(1)
}
const sourceHtml = readFileSync(sourcePath, 'utf8')
const html = compileDeviceNameMatrix(sourceHtml, matrix)
if (!html.includes('<canvas id="mesh"') || !html.includes("getContext('webgl'")) {
  console.error('[static] Source is missing the WebGL network renderer.')
  process.exit(1)
}
if (!html.includes('requestAnimationFrame(paint)') || !html.includes('requestAnimationFrame(draw)') ||
  !html.includes('for(let packet=0;packet<4;packet++)')) {
  console.error('[static] Local requestAnimationFrame laser traffic is missing from a renderer.')
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
writeFileSync(join(distPath, 'standalone.html'), html)
writeFileSync(join(distPath, 'device-names.json'), `${JSON.stringify(matrix, null, 2)}\n`)
writeFileSync(join(distPath, 'network-topology.json'), `${JSON.stringify(topology, null, 2)}\n`)
console.log(`[static] Built standalone page, device dictionary, and network topology in dist/ (${Buffer.byteLength(html)} bytes)`)
