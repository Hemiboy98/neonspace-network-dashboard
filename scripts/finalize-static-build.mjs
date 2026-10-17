/**
 * Flatten the TanStack Start build into a static `dist/` that Blink hosting serves.
 *
 * TanStack Start's `vite build` (configured with `build.outDir: '.vite-out'`)
 * emits:
 *   .vite-out/client/   ← prerendered HTML + assets (what we want, STATIC)
 *   .vite-out/server/   ← SSR Nitro server (NOT used by Blink's static S3 hosting)
 *
 * Blink uploads `dist/` and serves `dist/index.html` (see src/constants/publish.ts
 * BUILD_PATHS['vite-react'] = 'dist'). So we copy `.vite-out/client/*` up into a
 * flat `dist/` and drop the server.
 *
 * Why build into `.vite-out` instead of `dist/` directly: sandboxes created before the
 * platform stopped injecting `_redirects` still carry a read-only copy owned by another
 * user, and Start's client build tries to EMPTY its out dir first → `EACCES: unlink
 * _redirects`. Building into a clean temp dir avoids that entirely; here we only COPY
 * into `dist/` (never delete), so a legacy read-only `_redirects` is tolerated. Nothing
 * injects that file any more and nothing executes it — see skills/blink-hosting.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileDeviceNameMatrix, readDeviceNameMatrix } from './compile-device-matrix.mjs'
import { compileNetworkTopology } from './compile-network-topology.mjs'

const SRC = '.vite-out/client'
const DEST = 'dist'

if (!existsSync(SRC)) {
  console.error(`[finalize] build output missing: ${SRC} — did "vite build" run?`)
  process.exit(1)
}

mkdirSync(DEST, { recursive: true })

for (const entry of readdirSync(SRC)) {
  try {
    cpSync(join(SRC, entry), join(DEST, entry), { recursive: true, force: true })
  } catch (e) {
    // ONLY `_redirects` may be skipped, and only because sandboxes created before the platform
    // stopped injecting it still carry a read-only copy owned by another user that cannot be
    // overwritten. The file is inert either way — nothing executes it. ANY other failed entry
    // (assets/, index.html, route html) would leave dist/index.html pointing at missing or stale
    // hashed assets — a silently broken deployment. Fail the build instead.
    // Remove this branch once no live sandbox predates the injector's removal.
    if (entry === '_redirects') {
      console.warn(`[finalize] skip ${entry}: ${e.code || e.message} (legacy read-only copy; the file is not executed)`)
    } else {
      console.error(`[finalize] FAILED copying ${entry} into dist/: ${e.code || e.message} — aborting (a partial dist/ deploys broken)`)
      process.exit(1)
    }
  }
}

const standalonePath = join(DEST, 'standalone.html')
const matrixPath = join(DEST, 'device-names.json')
const topologyPath = join(DEST, 'network-topology.json')
if (!existsSync(standalonePath) || !existsSync(matrixPath) || !existsSync(topologyPath)) {
  console.error('[finalize] standalone.html, device-names.json, or network-topology.json missing from the static assets.')
  process.exit(1)
}
try {
  const matrix = readDeviceNameMatrix(matrixPath)
  const html = compileDeviceNameMatrix(readFileSync(standalonePath, 'utf8'), matrix)
  const topology = compileNetworkTopology(JSON.parse(readFileSync(topologyPath, 'utf8')), matrix)
  writeFileSync(standalonePath, html)
  writeFileSync(topologyPath, `${JSON.stringify(topology, null, 2)}\n`)
} catch (error) {
  console.error(`[finalize] Could not compile the static device inventory: ${error.message}`)
  process.exit(1)
}

rmSync('.vite-out', { recursive: true, force: true })

if (!existsSync(join(DEST, 'index.html'))) {
  console.error('[finalize] dist/index.html missing after flatten — build is not publishable')
  process.exit(1)
}

console.log('[finalize] ✓ static build flattened to dist/ (dist/index.html ready)')
