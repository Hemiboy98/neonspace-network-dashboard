/**
 * NeonSpace Network Observatory — Background Scanning & Orchestration Server
 *
 * Runs 100% locally inside the Docker container footprint. Uses only Node.js
 * built-in modules — no npm dependencies, no cloud calls except optional
 * public APIs (GitHub events, Open-Meteo weather, Docker Hub tags).
 *
 * Modules:
 *  1. Anchor ICMP heartbeat + subnet ARP/ICMP discovery sweep
 *  2. TCP port health checks (8006, 7575, 32400, 22, 80)
 *  3. WAN diagnostics — 5-packet burst to 8.8.8.8, packet-loss %
 *  4. SSL certificate expiry sweep
 *  5. DNS resolution benchmark
 *  6. Docker socket — container list, stats, events, control API
 *  7. GitHub repository event polling
 *  8. Docker Hub image version check
 *  9. SMART drive health (smartctl)
 * 10. Plex API — active sessions + poster artwork
 * 11. Proxmox VE API — cluster workload
 * 12. Network interface throughput
 * 13. MAC vendor OUI lookup
 * 14. Wake-on-LAN magic packet broadcast
 * 15. Atmospheric weather (Open-Meteo, keyless)
 *
 * Communication: WebSocket (/ws) for live streaming + HTTP API (/api/*) for
 * control actions (Docker start/stop/restart, WoL).
 */

import { spawn, execSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, existsSync, readlinkSync, readdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { connect as tlsConnect } from 'node:tls'
import { lookup as dnsLookup, resolve4 } from 'node:dns/promises'
import { networkInterfaces } from 'node:os'

// ─── Configuration ────────────────────────────────────────────────────────────

const SCAN_INTERVAL = Number(process.env.SCAN_INTERVAL_MS || 10_000)
const DISCOVERY_INTERVAL = Number(process.env.DISCOVERY_INTERVAL_MS || 30_000)
const PORT_INTERVAL = Number(process.env.PORT_INTERVAL_MS || 10_000)
const WAN_INTERVAL = Number(process.env.WAN_INTERVAL_MS || 10_000)
const SSL_INTERVAL = Number(process.env.SSL_INTERVAL_MS || 300_000)
const DNS_INTERVAL = Number(process.env.DNS_INTERVAL_MS || 30_000)
const DOCKER_INTERVAL = Number(process.env.DOCKER_INTERVAL_MS || 10_000)
const GITHUB_INTERVAL = Number(process.env.GITHUB_INTERVAL_MS || 60_000)
const SMART_INTERVAL = Number(process.env.SMART_INTERVAL_MS || 120_000)
const PLEX_INTERVAL = Number(process.env.PLEX_INTERVAL_MS || 15_000)
const PVE_INTERVAL = Number(process.env.PVE_INTERVAL_MS || 15_000)
const THROUGHPUT_INTERVAL = Number(process.env.THROUGHPUT_INTERVAL_MS || 5_000)
const WEATHER_INTERVAL = Number(process.env.WEATHER_INTERVAL_MS || 600_000)
const PORT = Number(process.env.MONITOR_PORT || 8765)

const PVE_API_TOKEN = process.env.PVE_API_TOKEN || ''
const PLEX_TOKEN = process.env.PLEX_TOKEN || ''
const GITHUB_REPO = process.env.GITHUB_REPO || 'Hemiboy98/neonspace-network-dashboard'
const WEATHER_LAT = Number(process.env.WEATHER_LAT || 40.71)
const WEATHER_LON = Number(process.env.WEATHER_LON || -74.01)
const WOL_MAC = process.env.WOL_MAC || ''
const WOL_BROADCAST = process.env.WOL_BROADCAST || '192.168.4.255'
const SSL_TARGETS = (process.env.SSL_TARGETS || '192.168.4.200:8006,192.168.4.33:7575,192.168.4.49:32400').split(',').filter(Boolean)
const DNS_TARGETS = (process.env.DNS_TARGETS || 'google.com,cloudflare.com,github.com,plex.tv').split(',').filter(Boolean)
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock'

// ─── Anchor definitions ───────────────────────────────────────────────────────

const anchors = [
  { id: 'gateway', name: 'Gateway eero Router', ip: '192.168.4.1', kind: 'Router' },
  { id: 'homarr', name: 'Homarr Cockpit Portal', ip: '192.168.4.33', kind: 'Dashboard service' },
  { id: 'docker', name: 'Docker Host Engine', ip: '192.168.4.48', kind: 'Container host' },
  { id: 'plex', name: 'Chronos-05 Plex Vault', ip: '192.168.4.49', kind: 'Media server' },
  { id: 'proxmox', name: 'Proxmox VE Hypervisor', ip: '192.168.4.200', kind: 'Hypervisor' },
]

const portChecks = [
  { ip: '192.168.4.200', label: 'Proxmox VE UI', port: 8006, anchor: 'proxmox' },
  { ip: '192.168.4.33', label: 'Homarr Portal', port: 7575, anchor: 'homarr' },
  { ip: '192.168.4.49', label: 'Plex Streaming', port: 32400, anchor: 'plex' },
]

const portMatrixTargets = [
  { ip: '192.168.4.200', label: 'Proxmox VE' },
  { ip: '192.168.4.33', label: 'Homarr' },
  { ip: '192.168.4.48', label: 'Docker Host' },
  { ip: '192.168.4.49', label: 'Plex Vault' },
]
const portMatrixPorts = [22, 80, 443, 8006, 32400, 7575]

const knownIps = new Set(anchors.map((n) => n.ip))
const nodes = new Map(anchors.map((n) => [n.ip, { ...n, role: 'anchor', status: 'unknown', latencyMs: null, macAddress: null, vendor: null, lastChecked: null, lastSeen: null, portState: {}, evidence: 'Waiting for first probe' }]))
const clients = new Set()
const logs = []

// ─── State stores ─────────────────────────────────────────────────────────────

const state = {
  portMatrix: {},       // ip -> { port: { open, latencyMs } }
  wan: { lossPct: 0, rttMs: null, drops: 0, samples: [], history: [] },
  ssl: [],              // [{ host, port, daysLeft, issuer, valid }]
  dns: [],              // [{ domain, latencyMs, resolved }]
  docker: { containers: [], events: [], stats: {} },
  github: { events: [], commits: [], latestSha: null },
  smart: [],            // [{ device, model, temp, health, smartctl }]
  plex: { sessions: [], artwork: [], activeStreams: 0 },
  proxmox: { nodes: [], vms: [], storage: [] },
  throughput: { interfaces: [], history: [] },
  weather: { temp: null, pressure: null, humidity: null, wind: null, conditions: '', storms: false },
  macVendors: new Map(),
}

// ─── WebSocket frame helpers ─────────────────────────────────────────────────

function frame(value, opcode = 0x1) {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value)
  const length = payload.length
  let header
  if (length < 126) header = Buffer.from([0x80 | opcode, length])
  else if (length <= 0xffff) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(length, 2) }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2) }
  return Buffer.concat([header, payload])
}
function send(socket, message) { if (socket.destroyed || !socket.writable) return; socket.write(frame(JSON.stringify(message))) }
function broadcast(message) { for (const c of clients) send(c, message) }
function addLog({ name = 'System', ip = '', severity = 'info', message }) {
  const entry = { at: new Date().toISOString(), name, ip, severity, message }
  logs.push(entry); if (logs.length > 120) logs.shift()
  broadcast({ type: 'log', log: entry })
  console.log(`[${severity}] ${ip ? `${ip} · ` : ''}${name}: ${message}`)
}

// ─── ICMP ping ───────────────────────────────────────────────────────────────

function ping(ip, count = 1) {
  return new Promise((resolve) => {
    let output = '', settled = false
    const child = spawn('ping', ['-4', '-n', '-c', String(count), '-W', '1', ip], { stdio: ['ignore', 'pipe', 'ignore'] })
    const timeout = setTimeout(() => { child.kill('SIGKILL'); finish({ reachable: false, latencyMs: null, lossPct: 100, error: 'timed out' }) }, count * 1600 + 800)
    const finish = (r) => { if (settled) return; settled = true; clearTimeout(timeout); resolve(r) }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d) => { output += d })
    child.once('error', (e) => finish({ reachable: false, latencyMs: null, lossPct: 100, error: e.message }))
    child.once('close', (code) => {
      const latMatch = output.match(/time[=<]([\d.]+)\s*ms/i)
      const lossMatch = output.match(/(\d+)%\s*packet\s*loss/i)
      const rttMatch = output.match(/rtt\s*[=/]?\s*([\d.]+)\/([\d.]+)\/([\d.]+)/i)
      finish({
        reachable: code === 0,
        latencyMs: latMatch ? Number(latMatch[1]) : null,
        lossPct: lossMatch ? Number(lossMatch[1]) : code === 0 ? 0 : 100,
        rttMin: rttMatch ? Number(rttMatch[1]) : null,
        rttAvg: rttMatch ? Number(rttMatch[2]) : null,
        rttMax: rttMatch ? Number(rttMatch[3]) : null,
      })
    })
  })
}

// ─── ARP table ────────────────────────────────────────────────────────────────

function arpTable() {
  try {
    return readFileSync('/proc/net/arp', 'utf8').split('\n').slice(1).reduce((table, line) => {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 4) { const [ip, , flags, mac] = parts; if (Number.parseInt(flags, 16) & 2 && mac && mac !== '00:00:00:00:00:00') table.set(ip, mac) }
      return table
    }, new Map())
  } catch { return new Map() }
}

// ─── MAC vendor OUI lookup ────────────────────────────────────────────────────

const OUI_DB = new Map([
  ['00:1D:4F', 'Apple'], ['AC:DE:48', 'Apple'], ['F0:24:75', 'Apple'], ['3C:22:FB', 'Apple'], ['A4:5E:60', 'Apple'], ['DC:A4:CA', 'Apple'], ['70:56:81', 'Apple'], ['B0:BE:83', 'Apple'], ['00:17:F2', 'Apple'],
  ['F8:0F:41', 'Intel'], ['00:1B:21', 'Intel'], ['00:13:02', 'Intel'], ['00:04:23', 'Intel'], ['00:0B:DB', 'Intel'], ['68:05:CA', 'Intel'], ['00:0E:0C', 'Intel'],
  ['A4:5D:36', 'Sony'], ['00:1F:1F', 'Sony'], ['00:02:2D', 'Sony'], ['00:09:DF', 'Sony'], ['90:A8:22', 'Sony'], ['F8:E9:03', 'Sony'], ['00:25:DA', 'Sony'], ['70:9F:1F', 'Sony'],
  ['00:1D:6A', 'Nintendo'], ['00:19:1D', 'Nintendo'], ['00:1B:7A', 'Nintendo'], ['00:21:BD', 'Nintendo'], ['00:22:D7', 'Nintendo'], ['00:24:44', 'Nintendo'], ['00:26:59', 'Nintendo'], ['00:27:09', 'Nintendo'], ['00:1E:35', 'Nintendo'], ['00:1E:A9', 'Nintendo'],
  ['00:0C:29', 'VMware'], ['00:50:56', 'VMware'], ['00:05:69', 'VMware'],
  ['00:1B:EB', 'Proxmox/Virtual'], ['00:16:3E', 'Xen/KVM'],
  ['B8:27:EB', 'Raspberry Pi'], ['DC:A6:32', 'Raspberry Pi'], ['E4:5F:01', 'Raspberry Pi'], ['D8:3A:DD', 'Raspberry Pi'],
  ['00:08:9B', 'eero/Amazon'], ['00:71:47', 'eero/Amazon'], ['34:56:EE', 'eero/Amazon'], ['44:65:0D', 'eero/Amazon'], ['AC:63:BE', 'eero/Amazon'],
  ['00:1F:3C', 'T-Mobile'], ['00:25:45', 'T-Mobile'], ['C8:3A:35', 'T-Mobile'],
  ['00:04:ED', 'TP-Link'], ['50:C7:BF', 'TP-Link'], ['60:32:B1', 'TP-Link'], ['EC:08:6B', 'TP-Link'], ['A8:57:2E', 'TP-Link'],
  ['00:1A:A0', 'TP-Link'], ['B0:95:75', 'TP-Link'], ['14:EB:33', 'TP-Link'],
  ['00:0C:84', 'Netgear'], ['00:1B:2F', 'Netgear'], ['00:1F:33', 'Netgear'], ['C0:3F:0E', 'Netgear'], ['A0:21:B7', 'Netgear'], ['9C:3D:CF', 'Netgear'], ['20:4E:7F', 'Netgear'], ['44:94:FC', 'Netgear'],
  ['00:13:10', 'Asus'], ['00:0A:EB', 'Asus'], ['00:11:2F', 'Asus'], ['04:42:1A', 'Asus'], ['08:62:66', 'Asus'], ['AC:9E:17', 'Asus'], ['38:2C:4A', 'Asus'], ['04:D9:F5', 'Asus'],
  ['00:1D:92', 'Asus'], ['F8:0C:F3', 'Asus'], ['C8:7F:54', 'Asus'],
  ['00:19:DB', 'AsRock'], ['00:30:67', 'AsRock'],
  ['00:E0:4C', 'Realtek'], ['52:54:00', 'QEMU/KVM'],
  ['B0:7F:B5', 'LG'], ['00:0E:58', 'LG'], ['00:16:6B', 'LG'], ['00:1B:44', 'LG'], ['00:1F:25', 'LG'], ['C8:7E:75', 'LG'], ['A4:7C:8E', 'LG'], ['A8:23:8A', 'LG'],
  ['08:10:76', 'TCL'], ['00:19:87', 'TCL'], ['4C:AA:16', 'TCL'],
  ['00:24:E4', 'Samsung'], ['00:12:FB', 'Samsung'], ['00:15:99', 'Samsung'], ['00:16:32', 'Samsung'], ['00:1B:98', 'Samsung'], ['00:24:54', 'Samsung'], ['00:26:37', 'Samsung'], ['38:AA:3C', 'Samsung'], ['E0:62:7A', 'Samsung'], ['C8:1E:E7', 'Samsung'], ['B0:EC:71', 'Samsung'], ['8C:77:12', 'Samsung'], ['54:40:AD', 'Samsung'], ['D4:87:D8', 'Samsung'], ['04:BD:70', 'Samsung'], ['78:4F:43', 'Samsung'], ['5C:0A:5B', 'Samsung'],
  ['00:17:88', 'Philips Hue'], ['EC:B5:5A', 'Philips Hue'],
  ['00:24:E4', 'Onn/Roku'], ['B8:27:EB', 'Roku'], ['BC:77:37', 'Roku'], ['00:0D:41', 'Roku'], ['CC:6D:A0', 'Roku'], ['A8:B5:7D', 'Roku'], ['AC:3F:A4', 'Roku'],
])

function vendorForMac(mac) {
  if (!mac || mac === '00:00:00:00:00:00') return null
  const oui = mac.toUpperCase().slice(0, 8)
  return OUI_DB.get(oui) || null
}

// ─── TCP port check ───────────────────────────────────────────────────────────

function checkPort(ip, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = new (require('node:net').Socket)()
    let done = false
    const timer = setTimeout(() => { if (!done) { done = true; socket.destroy(); resolve({ open: false, latencyMs: null, error: 'timeout' }) } }, timeoutMs)
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => { if (!done) { done = true; clearTimeout(timer); socket.destroy(); resolve({ open: true, latencyMs: null }) } })
    socket.once('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ open: false, latencyMs: null, error: e.code || e.message }) } })
    socket.once('timeout', () => { if (!done) { done = true; clearTimeout(timer); socket.destroy(); resolve({ open: false, latencyMs: null, error: 'timeout' }) } })
    socket.connect({ host: ip, port })
  })
}

// ─── Status determination ────────────────────────────────────────────────────

function makeStatus(reachable, latencyMs, error, macAddress = null) {
  if (error) return 'unknown'
  if (!reachable) return macAddress ? 'degraded' : 'offline'
  return latencyMs !== null && latencyMs >= 100 ? 'degraded' : 'online'
}

// ─── Anchor heartbeat ─────────────────────────────────────────────────────────

async function probe(node, mode) {
  const result = await ping(node.ip)
  const previous = nodes.get(node.ip)
  const macAddress = arpTable().get(node.ip) || null
  const vendor = vendorForMac(macAddress) || previous?.vendor || null
  const status = makeStatus(result.reachable, result.latencyMs, result.error, macAddress)
  const at = new Date().toISOString()
  const record = { ...(previous || node), ...node, role: node.role || 'anchor', status, latencyMs: result.reachable ? result.latencyMs : null, macAddress, vendor, lastChecked: at, lastSeen: result.reachable || macAddress ? at : previous?.lastSeen || null, evidence: result.error ? `Probe error: ${result.error}` : result.reachable ? 'ICMP echo reply' : macAddress ? 'ARP neighbor present; ICMP did not reply' : 'No ICMP or ARP response' }
  nodes.set(node.ip, record)
  broadcast({ type: 'node', node: record })
  const changed = !previous || previous.status !== status
  if (mode === 'anchor' || changed || result.reachable) {
    const msg = result.error ? `Probe unavailable: ${result.error}` : result.reachable ? `ICMP response in ${result.latencyMs === null ? 'under 1 ms' : `${result.latencyMs.toFixed(1)} ms`}` : macAddress ? 'ARP neighbor responded; ICMP timed out' : 'No ICMP response'
    addLog({ name: record.name, ip: record.ip, severity: result.error ? 'warn' : result.reachable ? status === 'degraded' ? 'warn' : 'ok' : 'warn', message: msg })
  }
  return record
}

let anchorRunning = false
async function runAnchorCycle() {
  if (anchorRunning) return
  anchorRunning = true
  try { await Promise.all(anchors.map((n) => probe(n, 'anchor'))); broadcast(snapshot()) } finally { anchorRunning = false }
}

// ─── Subnet discovery sweep ───────────────────────────────────────────────────

let discoveryRunning = false
let lastDiscoveryAt = 0
let lastDiscoveryCompletedAt = null

async function runDiscoverySweep(manual = false) {
  if (discoveryRunning) { broadcast({ type: 'scan', state: 'busy', message: 'Subnet discovery is already running.' }); return }
  if (manual && Date.now() - lastDiscoveryAt < 10_000) { broadcast({ type: 'scan', state: 'cooldown', message: 'Please wait before starting another subnet sweep.' }); return }
  discoveryRunning = true; lastDiscoveryAt = Date.now()
  const targets = Array.from({ length: 253 }, (_, i) => `192.168.4.${i + 2}`).filter((ip) => !knownIps.has(ip))
  addLog({ severity: 'info', message: `Starting ARP-assisted ICMP sweep · ${targets.length} addresses` })
  broadcast({ type: 'scan', state: 'started', total: targets.length, message: 'Probing 192.168.4.2–254' })
  const concurrency = 32; let cursor = 0, completed = 0
  try {
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (cursor < targets.length) {
        const ip = targets[cursor++]; const result = await ping(ip); const previous = nodes.get(ip); const macAddress = arpTable().get(ip) || null; const vendor = vendorForMac(macAddress) || previous?.vendor || null
        if (result.error) { if (previous) nodes.set(ip, { ...previous, status: 'unknown', latencyMs: null, lastChecked: new Date().toISOString(), evidence: `Probe error: ${result.error}` }) }
        else if (result.reachable || macAddress || previous) {
          const name = previous?.name || `Discovered terminal · ${ip}`
          const record = { id: previous?.id || `host-${ip.replaceAll('.', '-')}`, name, ip, role: 'discovered', status: makeStatus(result.reachable, result.latencyMs, null, macAddress), latencyMs: result.reachable ? result.latencyMs : null, macAddress, vendor, lastChecked: new Date().toISOString(), lastSeen: result.reachable || macAddress ? new Date().toISOString() : previous?.lastSeen || null, evidence: result.reachable ? 'ICMP echo reply' : macAddress ? 'ARP neighbor present; ICMP did not reply' : 'No ICMP or ARP response' }
          nodes.set(ip, record); broadcast({ type: 'node', node: record })
          if (result.reachable || (previous && previous.status !== record.status)) addLog({ name, ip, severity: result.reachable ? record.status === 'degraded' ? 'warn' : 'ok' : 'warn', message: result.reachable ? `ICMP response in ${result.latencyMs === null ? 'under 1 ms' : `${result.latencyMs.toFixed(1)} ms`}` : record.evidence })
        }
        completed += 1
        if (completed % concurrency === 0 || completed === targets.length) broadcast({ type: 'scan', state: 'progress', completed, total: targets.length })
      }
    }))
    lastDiscoveryCompletedAt = new Date().toISOString()
    addLog({ severity: 'ok', message: `Subnet sweep complete · ${targets.length} addresses checked · ${nodes.size - anchors.length} discovered terminals tracked` })
    broadcast(snapshot()); broadcast({ type: 'scan', state: 'complete', total: targets.length, discovered: nodes.size - anchors.length })
  } finally { discoveryRunning = false }
}

// ─── Port health checks ──────────────────────────────────────────────────────

async function runPortChecks() {
  for (const pc of portChecks) {
    const result = await checkPort(pc.ip, pc.port)
    const at = new Date().toISOString()
    const record = { ...result, label: pc.label, ip: pc.ip, port: pc.port, at }
    // Update anchor node port state
    const node = nodes.get(pc.ip)
    if (node) {
      node.portState = { ...(node.portState || {}), [pc.port]: result.open }
      node.serviceHealthy = Object.values(node.portState).some(Boolean)
      nodes.set(pc.ip, node)
      broadcast({ type: 'node', node })
    }
    broadcast({ type: 'port-check', portCheck: record })
    if (!result.open) addLog({ name: pc.label, ip: pc.ip, severity: 'warn', message: `Port ${pc.port} not responding` })
    else if (result.open) addLog({ name: pc.label, ip: pc.ip, severity: 'ok', message: `Port ${pc.port} responsive — System Stabilized` })
  }
  // Full port matrix for the scanner panel
  const matrix = {}
  for (const target of portMatrixTargets) {
    matrix[target.ip] = { label: target.label, ports: {} }
    for (const port of portMatrixPorts) {
      const result = await checkPort(target.ip, port, 1500)
      matrix[target.ip].ports[port] = { open: result.open, latencyMs: result.latencyMs }
    }
  }
  state.portMatrix = matrix
  broadcast({ type: 'port-matrix', matrix })
}

// ─── WAN diagnostics ─────────────────────────────────────────────────────────

async function runWanDiagnostics() {
  const result = await ping('8.8.8.8', 5)
  const sample = { at: new Date().toISOString(), lossPct: result.lossPct, rttMs: result.rttAvg || result.latencyMs, rttMin: result.rttMin, rttMax: result.rttMax }
  state.wan.samples.push(sample)
  if (state.wan.samples.length > 60) state.wan.samples.shift()
  state.wan.history.push({ at: sample.at, lossPct: result.lossPct, rttMs: sample.rttMs })
  if (state.wan.history.length > 120) state.wan.history.shift()
  state.wan.lossPct = result.lossPct
  state.wan.rttMs = sample.rttMs
  if (result.lossPct > 0) state.wan.drops += 1
  broadcast({ type: 'wan', wan: { ...sample, totalDrops: state.wan.drops, history: state.wan.history.slice(-30) } })
  if (result.lossPct >= 40) addLog({ name: 'WAN Diagnostics', ip: '8.8.8.8', severity: 'warn', message: `Packet loss ${result.lossPct}% — ISP instability detected` })
}

// ─── SSL certificate check ────────────────────────────────────────────────────

async function checkSsl(host, port) {
  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => { if (!done) { done = true; resolve({ host, port, error: 'timeout' }) } }, 4000)
    try {
      const socket = tlsConnect({ host, port, rejectUnauthorized: false, servername: host }, () => {
        if (done) return; done = true; clearTimeout(timer)
        const cert = socket.getPeerCertificate()
        socket.destroy()
        if (!cert || !cert.valid_to) { resolve({ host, port, error: 'no certificate' }); return }
        const expiry = new Date(cert.valid_to)
        const daysLeft = Math.ceil((expiry - Date.now()) / 86_400_000)
        resolve({ host, port, daysLeft, issuer: cert.issuer?.O || 'Unknown', subject: cert.subject?.CN || host, valid: daysLeft > 0 })
      })
      socket.once('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ host, port, error: e.message }) } })
      socket.once('timeout', () => { if (!done) { done = true; clearTimeout(timer); socket.destroy(); resolve({ host, port, error: 'timeout' }) } })
    } catch (e) { if (!done) { done = true; clearTimeout(timer); resolve({ host, port, error: e.message }) } }
  })
}

async function runSslChecks() {
  const results = []
  for (const target of SSL_TARGETS) {
    const [host, port = '443'] = target.split(':')
    const result = await checkSsl(host, Number(port))
    results.push(result)
    if (result.daysLeft !== undefined && result.daysLeft <= 30) addLog({ name: 'SSL Certificate', ip: host, severity: 'warn', message: `Certificate for ${host}:${port} expires in ${result.daysLeft} days` })
  }
  state.ssl = results
  broadcast({ type: 'ssl', ssl: results })
}

// ─── DNS resolution benchmark ────────────────────────────────────────────────

async function runDnsBenchmark() {
  const results = []
  for (const domain of DNS_TARGETS) {
    const start = performance.now()
    try {
      const resolved = await resolve4(domain)
      const latencyMs = Number((performance.now() - start).toFixed(2))
      results.push({ domain, latencyMs, resolved: resolved[0] || null, error: null })
    } catch (e) {
      const latencyMs = Number((performance.now() - start).toFixed(2))
      results.push({ domain, latencyMs, resolved: null, error: e.message })
    }
  }
  state.dns = results
  broadcast({ type: 'dns', dns: results })
}

// ─── Docker integration ──────────────────────────────────────────────────────

function dockerRequest(path, method = 'GET', body = null) {
  return new Promise((resolve) => {
    if (!existsSync(DOCKER_SOCKET)) { resolve({ error: 'Docker socket not mounted' }); return }
    const { spawn: spawnHelper } = require('node:child_process')
    try {
      const args = ['--unix-socket', DOCKER_SOCKET, '-s', '-X', method, `http://localhost/v1.41${path}`]
      if (body) args.push('-H', 'Content-Type: application/json', '-d', JSON.stringify(body))
      let output = '', errOutput = '', settled = false
      const child = spawnHelper('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      const timer = setTimeout(() => { if (!settled) { settled = true; child.kill('SIGKILL'); resolve({ error: 'timeout' }) } }, 5000)
      child.stdout.setEncoding('utf8'); child.stdout.on('data', (d) => { output += d })
      child.stderr.setEncoding('utf8'); child.stderr.on('data', (d) => { errOutput += d })
      child.once('close', (code) => {
        if (settled) return; settled = true; clearTimeout(timer)
        if (code !== 0) { resolve({ error: errOutput || `curl exit ${code}` }); return }
        try { resolve(JSON.parse(output)) } catch { resolve({ raw: output }) }
      })
      child.once('error', (e) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ error: e.message }) } })
    } catch (e) { resolve({ error: e.message }) }
  })
}

async function runDockerMonitor() {
  const containers = await dockerRequest('/containers/json?all=true')
  if (containers.error) { if (state.docker.containers.length === 0) broadcast({ type: 'docker-status', available: false, error: containers.error }); return }
  const enriched = await Promise.all((Array.isArray(containers) ? containers : []).map(async (c) => {
    const stats = await dockerRequest(`/containers/${c.Id}/stats?stream=false`)
    const name = c.Names?.[0]?.replace(/^\//, '') || c.Id.slice(0, 12)
    const cpuDelta = stats?.cpu_stats?.cpu_usage?.total_usage - stats?.precpu_stats?.cpu_usage?.total_usage || 0
    const systemDelta = stats?.cpu_stats?.system_cpu_usage - stats?.precpu_stats?.system_cpu_usage || 0
    const cpuPct = systemDelta > 0 ? (cpuDelta / systemDelta) * (stats?.cpu_stats?.online_cpus || 1) * 100 : 0
    const memUsage = stats?.memory_stats?.usage || 0
    const memLimit = stats?.memory_stats?.limit || 0
    const memPct = memLimit > 0 ? (memUsage / memLimit) * 100 : 0
    return {
      id: c.Id, name, image: c.Image, status: c.Status, state: c.State,
      cpuPct: Number(cpuPct.toFixed(2)), memUsage, memLimit, memPct: Number(memPct.toFixed(2)),
      ports: c.Ports || [], created: c.Created, shortId: c.Id.slice(0, 12),
    }
  }))
  state.docker.containers = enriched
  broadcast({ type: 'docker', docker: { containers: enriched, available: true } })
}

// Docker Hub version check
async function checkDockerHubVersions(containers) {
  for (const c of containers) {
    const [repo] = c.image.split(':')
    const tag = c.image.split(':')[1] || 'latest'
    if (!repo.includes('/')) continue
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const res = await fetch(`https://hub.docker.com/v2/repositories/${repo}/tags/${tag}`, { signal: controller.signal })
      clearTimeout(timeout)
      if (res.ok) { /* could check digest vs running */ }
    } catch {}
  }
}

// ─── GitHub events ───────────────────────────────────────────────────────────

async function runGitHubPoll() {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/events?per_page=20`, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'NeonSpace-Dashboard' }, signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return
    const events = await res.json()
    const commits = []
    for (const e of events) {
      if (e.type === 'PushEvent') for (const c of e.payload?.commits || []) {
        commits.push({ sha: c.sha?.slice(0, 7), message: c.message?.split('\n')[0] || '', author: e.actor?.login || c.author?.name || 'unknown', at: e.created_at, ref: e.payload?.ref || '' })
      }
    }
    state.github.events = events.slice(0, 20).map((e) => ({ id: e.id, type: e.type, actor: e.actor?.login, repo: e.repo?.name, created_at: e.created_at, payload_action: e.payload?.action, commits: e.payload?.commits?.length || 0 }))
    state.github.commits = commits.slice(0, 20)
    if (commits.length && commits[0].sha !== state.github.latestSha) {
      state.github.latestSha = commits[0].sha
      addLog({ name: 'GitHub Telemetry', severity: 'ok', message: `New push: ${commits[0].sha} — ${commits[0].message}` })
    }
    broadcast({ type: 'github', github: state.github })
  } catch (e) { /* silent — GitHub polling is best-effort */ }
}

// ─── SMART drive health ───────────────────────────────────────────────────────

async function runSmartCheck() {
  const drives = []
  try {
    const blockDevices = readdirSync('/dev').filter((d) => /^sd[a-z]$|^nvme\d+n\d+$/.test(d))
    for (const dev of blockDevices) {
      try {
        const output = execSync(`smartctl -A -j /dev/${dev} 2>/dev/null`, { timeout: 5000, encoding: 'utf8' })
        const data = JSON.parse(output)
        const temp = data.temperature?.current || null
        const reallocated = data.ata_smart_attributes?.table?.find((a) => a.id === 5)?.raw?.value || 0
        const spinRetry = data.ata_smart_attributes?.table?.find((a) => a.id === 10)?.raw?.value || 0
        const badSectors = data.ata_smart_attributes?.table?.find((a) => a.id === 197)?.raw?.value || 0
        const health = data.smart_status?.passed ? 'healthy' : 'failing'
        const model = data.model_name || data.product || dev
        drives.push({ device: `/dev/${dev}`, model, temp, reallocated, spinRetry, badSectors, health })
        if (health === 'failing') addLog({ name: 'SMART Health', severity: 'warn', message: `Drive ${dev} (${model}) reports failing health` })
      } catch { /* smartctl not available or not a SMART device */ }
    }
  } catch { /* /dev not accessible */ }
  if (!drives.length) {
    // Fallback: try reading /sys/block for basic info
    try {
      const blocks = readdirSync('/sys/block').filter((b) => /^sd[a-z]$|^nvme\d+n\d+$/.test(b))
      for (const b of blocks) {
        try {
          const model = readFileSync(`/sys/block/${b}/device/model`, 'utf8').trim()
          drives.push({ device: `/dev/${b}`, model, temp: null, reallocated: null, spinRetry: null, badSectors: null, health: 'unknown' })
        } catch {}
      }
    } catch {}
  }
  state.smart = drives
  broadcast({ type: 'smart', smart: drives })
}

// ─── Plex API ────────────────────────────────────────────────────────────────

async function runPlexPoll() {
  if (!PLEX_TOKEN) { state.plex = { sessions: [], artwork: [], activeStreams: 0, configured: false }; return }
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const res = await fetch('http://192.168.4.49:32400/status/sessions?X-Plex-Token=' + PLEX_TOKEN, { headers: { 'Accept': 'application/json', 'X-Plex-Token': PLEX_TOKEN }, signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) { state.plex = { sessions: [], artwork: [], activeStreams: 0, configured: true, error: `HTTP ${res.status}` }; return }
    const data = await res.json()
    const sessions = (data.MediaContainer?.Metadata || []).map((item) => ({
      key: item.key, title: item.title, type: item.type, grandparentTitle: item.grandparentTitle,
      summary: item.summary?.slice(0, 200), duration: item.duration, viewOffset: item.viewOffset,
      user: item.User?.title, player: item.Player?.title, state: item.Player?.state,
      artThumb: item.art ? `http://192.168.4.49:32400${item.art}?X-Plex-Token=${PLEX_TOKEN}` : null,
      thumb: item.thumb ? `http://192.168.4.49:32400${item.thumb}?X-Plex-Token=${PLEX_TOKEN}` : null,
      poster: item.thumb ? `http://192.168.4.49:32400${item.thumb}?X-Plex-Token=${PLEX_TOKEN}` : null,
    }))
    state.plex = { sessions, artwork: sessions.map((s) => s.poster).filter(Boolean), activeStreams: sessions.length, configured: true }
    broadcast({ type: 'plex', plex: state.plex })
  } catch (e) { state.plex = { sessions: [], artwork: [], activeStreams: 0, configured: true, error: e.message } }
}

// ─── Proxmox VE API ───────────────────────────────────────────────────────────

async function runProxmoxPoll() {
  if (!PVE_API_TOKEN) { state.proxmox = { nodes: [], vms: [], storage: [], configured: false }; return }
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const [tokenUser, tokenName] = PVE_API_TOKEN.split('=')
    const res = await fetch('https://192.168.4.200:8006/api2/json/nodes', {
      headers: { Authorization: `PVEAPIToken=${tokenUser}!${tokenName}=${PVE_API_TOKEN.split('=').pop()}`, Accept: 'application/json' },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) { state.proxmox = { nodes: [], vms: [], storage: [], configured: true, error: `HTTP ${res.status}` }; return }
    const data = await res.json()
    const pveNodes = data.data || []
    const vms = []
    for (const node of pveNodes) {
      try {
        const vmRes = await fetch(`https://192.168.4.200:8006/api2/json/nodes/${node.node}/qemu`, {
          headers: { Authorization: `PVEAPIToken=${PVE_API_TOKEN}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
        })
        if (vmRes.ok) { const vmData = await vmRes.json(); for (const vm of vmData.data || []) vms.push({ ...vm, node: node.node }) }
      } catch {}
    }
    state.proxmox = { nodes: pveNodes, vms, storage: [], configured: true }
    broadcast({ type: 'proxmox', proxmox: state.proxmox })
  } catch (e) { state.proxmox = { nodes: [], vms: [], storage: [], configured: true, error: e.message } }
}

// ─── Network throughput ──────────────────────────────────────────────────────

let prevNetDev = null
async function runThroughput() {
  try {
    const lines = readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)
    const interfaces = []
    for (const line of lines) {
      const match = line.trim().match(/^(\S+):\s*(.*)$/)
      if (!match) continue
      const [, name, rest] = match
      const parts = rest.split(/\s+/)
      const rxBytes = Number(parts[0]) || 0, txBytes = Number(parts[8]) || 0
      interfaces.push({ name, rxBytes, txBytes })
    }
    if (prevNetDev) {
      const now = Date.now()
      for (const iface of interfaces) {
        const prev = prevNetDev.find((i) => i.name === iface.name)
        if (prev) {
          const elapsed = (now - prevNetDev.timestamp) / 1000
          iface.rxBps = Math.max(0, ((iface.rxBytes - prev.rxBytes) / elapsed) * 8)
          iface.txBps = Math.max(0, ((iface.txBytes - prev.txBytes) / elapsed) * 8)
        }
      }
    }
    prevNetDev = [...interfaces, { timestamp: Date.now() }]
    state.throughput.interfaces = interfaces
    state.throughput.history.push({ at: new Date().toISOString(), interfaces: interfaces.map((i) => ({ name: i.name, rxBps: i.rxBps || 0, txBps: i.txBps || 0 })) })
    if (state.throughput.history.length > 60) state.throughput.history.shift()
    broadcast({ type: 'throughput', throughput: { interfaces, history: state.throughput.history.slice(-30) } })
  } catch {}
}

// ─── Weather (Open-Meteo, keyless) ────────────────────────────────────────────

async function runWeatherPoll() {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,surface_pressure,weather_code&hourly=pressure_msl&timezone=auto`, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return
    const data = await res.json()
    const code = data.current?.weather_code || 0
    const storms = code >= 95 && code <= 99
    state.weather = {
      temp: data.current?.temperature_2m, pressure: data.current?.surface_pressure || data.hourly?.pressure_msl?.[0],
      humidity: data.current?.relative_humidity_2m, wind: data.current?.wind_speed_10m,
      conditions: weatherCodeToText(code), storms, code, at: new Date().toISOString(),
    }
    broadcast({ type: 'weather', weather: state.weather })
  } catch {}
}

function weatherCodeToText(code) {
  if (code === 0) return 'Clear sky'
  if (code <= 3) return 'Overcast'
  if (code <= 48) return 'Fog'
  if (code <= 57) return 'Drizzle'
  if (code <= 67) return 'Rain'
  if (code <= 77) return 'Snow'
  if (code <= 82) return 'Rain showers'
  if (code <= 86) return 'Snow showers'
  if (code >= 95) return 'Thunderstorm'
  return 'Unknown'
}

// ─── Wake-on-LAN ──────────────────────────────────────────────────────────────

function sendMagicPacket(mac, broadcast = WOL_BROADCAST) {
  return new Promise((resolve) => {
    try {
      const clean = mac.replace(/[:-]/g, '')
      if (clean.length !== 12) { resolve({ ok: false, error: 'Invalid MAC address' }); return }
      const magic = Buffer.alloc(102)
      magic.fill(0xff, 0, 6)
      for (let i = 6; i < 102; i += 6) { for (let j = 0; j < 6; j++) magic[i + j] = parseInt(clean.slice(j * 2, j * 2 + 2), 16) }
      const dgram = require('node:dgram')
      const sock = dgram.createSocket('udp4')
      sock.on('error', (e) => { sock.close(); resolve({ ok: false, error: e.message }) })
      sock.bind(() => { sock.setBroadcast(true); sock.send(magic, 0, magic.length, 9, broadcast, (err) => { sock.close(); resolve(err ? { ok: false, error: err.message } : { ok: true, mac, broadcast }) }) })
    } catch (e) { resolve({ ok: false, error: e.message }) }
  })
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

function snapshot() {
  const current = [...nodes.values()]
  const latencies = current.map((n) => n.latencyMs).filter(Number.isFinite).sort((a, b) => a - b)
  const mid = Math.floor(latencies.length / 2)
  const medianLatencyMs = latencies.length ? latencies.length % 2 ? latencies[mid] : (latencies[mid - 1] + latencies[mid]) / 2 : null
  return {
    type: 'snapshot', at: new Date().toISOString(),
    intervalMs: SCAN_INTERVAL, discoveryIntervalMs: DISCOVERY_INTERVAL, lastDiscoveryCompletedAt,
    nodes: current,
    metrics: { total: current.length, online: current.filter((n) => n.status === 'online' || n.status === 'degraded').length, degraded: current.filter((n) => n.status === 'degraded').length, offline: current.filter((n) => n.status === 'offline').length, unknown: current.filter((n) => n.status === 'unknown').length, medianLatencyMs },
    wan: { lossPct: state.wan.lossPct, rttMs: state.wan.rttMs, drops: state.wan.drops },
    docker: { available: existsSync(DOCKER_SOCKET), containerCount: state.docker.containers.length },
    plex: { configured: !!PLEX_TOKEN, activeStreams: state.plex.activeStreams },
    proxmox: { configured: !!PVE_API_TOKEN },
    weather: state.weather,
    logs: logs.slice(-60),
  }
}

// ─── Full state broadcast ────────────────────────────────────────────────────

function broadcastFullState(socket) {
  send(socket, snapshot())
  send(socket, { type: 'port-matrix', matrix: state.portMatrix })
  send(socket, { type: 'wan', wan: { lossPct: state.wan.lossPct, rttMs: state.wan.rttMs, drops: state.wan.drops, history: state.wan.history.slice(-30) } })
  send(socket, { type: 'ssl', ssl: state.ssl })
  send(socket, { type: 'dns', dns: state.dns })
  send(socket, { type: 'docker', docker: { containers: state.docker.containers, available: existsSync(DOCKER_SOCKET) } })
  send(socket, { type: 'github', github: state.github })
  send(socket, { type: 'smart', smart: state.smart })
  send(socket, { type: 'plex', plex: state.plex })
  send(socket, { type: 'proxmox', proxmox: state.proxmox })
  send(socket, { type: 'throughput', throughput: { interfaces: state.throughput.interfaces, history: state.throughput.history.slice(-30) } })
  send(socket, { type: 'weather', weather: state.weather })
}

// ─── HTTP API router ─────────────────────────────────────────────────────────

function sendJson(res, status, data) { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(data)) }

async function handleApi(req, res, url) {
  const path = url.pathname
  const method = req.method

  // CORS preflight
  if (method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'Content-Type' }); res.end(); return }

  if (path === '/api/docker' && method === 'GET') { sendJson(res, 200, { containers: state.docker.containers, available: existsSync(DOCKER_SOCKET) }); return }

  const dockerMatch = path.match(/^\/api\/docker\/([a-f0-9]{12,64})\/(start|stop|restart)$/)
  if (dockerMatch && method === 'POST') {
    const [, id, action] = dockerMatch
    const result = await dockerRequest(`/containers/${id}/${action}`, 'POST')
    addLog({ name: 'Docker Controller', severity: result.error ? 'warn' : 'ok', message: result.error ? `Failed to ${action} ${id.slice(0, 12)}: ${result.error}` : `Container ${id.slice(0, 12)} ${action} command sent` })
    sendJson(res, result.error ? 500 : 200, result); return
  }

  if (path === '/api/wol' && method === 'POST') {
    let body = ''
    req.on('data', (d) => { body += d }); req.on('end', async () => {
      const { mac, broadcast } = JSON.parse(body || '{}')
      const targetMac = mac || WOL_MAC
      if (!targetMac) { sendJson(res, 400, { ok: false, error: 'No MAC address configured. Set WOL_MAC env var or pass mac in body.' }); return }
      const result = await sendMagicPacket(targetMac, broadcast || WOL_BROADCAST)
      addLog({ name: 'Wake-on-LAN', severity: result.ok ? 'ok' : 'warn', message: result.ok ? `Magic packet broadcast to ${targetMac}` : `WoL failed: ${result.error}` })
      sendJson(res, result.ok ? 200 : 500, result)
    }); return
  }

  if (path === '/api/state' && method === 'GET') { sendJson(res, 200, { portMatrix: state.portMatrix, wan: state.wan, ssl: state.ssl, dns: state.dns, smart: state.smart, weather: state.weather, github: state.github, throughput: state.throughput, plex: state.plex, proxmox: state.proxmox }); return }

  sendJson(res, 404, { error: 'Not found' })
}

// ─── WebSocket client handler ────────────────────────────────────────────────

function handleClientData(socket, chunk) {
  socket.frameBuffer = Buffer.concat([socket.frameBuffer || Buffer.alloc(0), chunk])
  while (socket.frameBuffer.length >= 2) {
    const first = socket.frameBuffer[0], second = socket.frameBuffer[1], opcode = first & 0x0f, masked = (second & 0x80) !== 0
    let length = second & 0x7f, offset = 2
    if (length === 126) { if (socket.frameBuffer.length < 4) return; length = socket.frameBuffer.readUInt16BE(2); offset = 4 }
    else if (length === 127) { if (socket.frameBuffer.length < 10) return; const ext = socket.frameBuffer.readBigUInt64BE(2); if (ext > 65536n) return socket.destroy(); length = Number(ext); offset = 10 }
    if (!masked) return socket.destroy()
    if (socket.frameBuffer.length < offset + 4 + length) return
    const mask = socket.frameBuffer.subarray(offset, offset + 4)
    const payload = Buffer.from(socket.frameBuffer.subarray(offset + 4, offset + 4 + length))
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4]
    socket.frameBuffer = socket.frameBuffer.subarray(offset + 4 + length)
    if (opcode === 0x8) return socket.end(frame(Buffer.alloc(0), 0x8))
    if (opcode === 0x9) socket.write(frame(payload, 0xa))
    if (opcode === 0x1) { try { const msg = JSON.parse(payload.toString('utf8')); if (msg.type === 'scan-now') void runDiscoverySweep(true) } catch { send(socket, { type: 'error', message: 'Invalid monitor command.' }) } }
  }
}

// ─── HTTP server ─────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url)
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found')
  } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.message })) }
})

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key']
  const origin = req.headers.origin
  let sameOrigin = !origin
  if (origin) { try { sameOrigin = new URL(origin).host === req.headers.host } catch { sameOrigin = false } }
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname !== '/ws' || req.headers.upgrade?.toLowerCase() !== 'websocket' || !key || !sameOrigin) { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return }
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  clients.add(socket)
  socket.on('data', (chunk) => handleClientData(socket, chunk))
  socket.on('close', () => clients.delete(socket))
  socket.on('error', () => clients.delete(socket))
  broadcastFullState(socket)
})

server.listen(PORT, '127.0.0.1', () => console.log(`[monitor] Listening on 127.0.0.1:${PORT} — WS + API`))

// ─── Schedulers ──────────────────────────────────────────────────────────────

const timers = [
  setInterval(() => void runAnchorCycle(), SCAN_INTERVAL),
  setInterval(() => void runDiscoverySweep(), DISCOVERY_INTERVAL),
  setInterval(() => void runPortChecks(), PORT_INTERVAL),
  setInterval(() => void runWanDiagnostics(), WAN_INTERVAL),
  setInterval(() => void runSslChecks(), SSL_INTERVAL),
  setInterval(() => void runDnsBenchmark(), DNS_INTERVAL),
  setInterval(() => void runDockerMonitor(), DOCKER_INTERVAL),
  setInterval(() => void runGitHubPoll(), GITHUB_INTERVAL),
  setInterval(() => void runSmartCheck(), SMART_INTERVAL),
  setInterval(() => void runPlexPoll(), PLEX_INTERVAL),
  setInterval(() => void runProxmoxPoll(), PVE_INTERVAL),
  setInterval(() => void runThroughput(), THROUGHPUT_INTERVAL),
  setInterval(() => void runWeatherPoll(), WEATHER_INTERVAL),
  setInterval(() => { for (const c of clients) if (!c.destroyed && c.writable) c.write(frame(Buffer.alloc(0), 0x9)) }, 25_000),
]

// ─── Initial boot ────────────────────────────────────────────────────────────

addLog({ severity: 'info', message: `NeonSpace monitor starting · ${anchors.length} anchors · scan every ${SCAN_INTERVAL / 1000}s` })

void runAnchorCycle().then(() => runDiscoverySweep()).catch((e) => addLog({ severity: 'warn', message: `Initial scan failed: ${e.message}` }))
void runPortChecks().catch(() => {})
void runWanDiagnostics().catch(() => {})
void runSslChecks().catch(() => {})
void runDnsBenchmark().catch(() => {})
void runDockerMonitor().catch(() => {})
void runGitHubPoll().catch(() => {})
void runSmartCheck().catch(() => {})
void runThroughput().catch(() => {})
void runWeatherPoll().catch(() => {})
void runPlexPoll().catch(() => {})
void runProxmoxPoll().catch(() => {})

// ─── Shutdown ────────────────────────────────────────────────────────────────

function shutdown() { timers.forEach(clearInterval); for (const c of clients) c.end(frame(Buffer.alloc(0), 0x8)); server.close() }
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)