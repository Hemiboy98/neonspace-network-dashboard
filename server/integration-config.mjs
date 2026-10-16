import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, resolve, sep } from 'node:path'

const MAX_FILES = 32
const MAX_FILE_BYTES = 256 * 1024
const MAX_DEPTH = 3
const KEY_ALIASES = new Map([
  ['PVEAPITOKEN', 'PVE_API_TOKEN'],
  ['PVETOKEN', 'PVE_API_TOKEN'],
  ['PROXMOXAPITOKEN', 'PVE_API_TOKEN'],
  ['PROXMOXTOKEN', 'PVE_API_TOKEN'],
  ['PLEXTOKEN', 'PLEX_TOKEN'],
  ['PVEHOST', 'PVE_HOST'],
  ['PROXMOXHOST', 'PVE_HOST'],
  ['PLEXHOST', 'PLEX_HOST'],
])

function normalizeKey(key, parents) {
  const compact = String(key).replace(/[^a-z0-9]/gi, '').toUpperCase()
  if (KEY_ALIASES.has(compact)) return KEY_ALIASES.get(compact)
  const context = parents.join('.').toLowerCase()
  if (['APITOKEN', 'TOKEN'].includes(compact) && /(pve|proxmox)/.test(context)) return 'PVE_API_TOKEN'
  if (compact === 'TOKEN' && /plex/.test(context)) return 'PLEX_TOKEN'
  if (compact === 'HOST' && /(pve|proxmox)/.test(context)) return 'PVE_HOST'
  if (compact === 'HOST' && /plex/.test(context)) return 'PLEX_HOST'
  return null
}

function readJsonFiles(root) {
  const files = []
  const base = resolve(root)

  function visit(directory, depth) {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (files.length >= MAX_FILES) break
      if (entry.name.startsWith('.')) continue
      const path = resolve(directory, entry.name)
      if (path !== base && !path.startsWith(`${base}${sep}`)) continue
      if (entry.isDirectory()) visit(path, depth + 1)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) files.push(path)
    }
  }

  visit(base, 0)
  return files
}

/**
 * Load only the supported integration credentials from a private, mounted
 * directory. This intentionally never searches app source or public assets.
 */
export function loadIntegrationConfig(directory) {
  const values = {}
  if (!directory) return values

  for (const path of readJsonFiles(directory)) {
    try {
      if (statSync(path).size > MAX_FILE_BYTES) continue
      const document = JSON.parse(readFileSync(path, 'utf8'))
      const walk = (value, parents = []) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return
        for (const [key, child] of Object.entries(value)) {
          const target = normalizeKey(key, parents)
          if (target && typeof child === 'string' && child.trim()) {
            values[target] ??= child.trim()
          } else if (child && typeof child === 'object') {
            walk(child, [...parents, key])
          }
        }
      }
      walk(document)
    } catch (error) {
      console.warn(`[monitor] skipped invalid integration JSON ${basename(path)}: ${error.message}`)
    }
  }

  const loaded = Object.keys(values).sort()
  if (loaded.length) console.info(`[monitor] loaded integration settings: ${loaded.join(', ')}`)
  return values
}
