import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'

const anchors = [
  { id: 'gateway', name: 'Gateway eero Router', ip: '192.168.4.1' },
  { id: 'proxmox', name: 'Proxmox VE Hypervisor', ip: '192.168.4.200' },
  { id: 'homarr', name: 'Homarr Cockpit Portal', ip: '192.168.4.33' },
  { id: 'docker', name: 'Docker Host Engine', ip: '192.168.4.48' },
  { id: 'plex', name: 'Chronos-05 Plex Vault', ip: '192.168.4.49' },
]
const intervalMs = Number(process.env.SCAN_INTERVAL_MS || 5000)
const discoveryIntervalMs = Number(process.env.DISCOVERY_INTERVAL_MS || 60000)
const port = Number(process.env.MONITOR_PORT || 8765)
const knownIps = new Set(anchors.map((node) => node.ip))
const nodes = new Map(anchors.map((node) => [node.ip, { ...node, role: 'anchor', status: 'unknown', latencyMs: null, macAddress: null, lastChecked: null, lastSeen: null, evidence: 'Waiting for first probe' }]))
const clients = new Set()
const logs = []
let anchorCycleRunning = false
let discoveryRunning = false
let lastDiscoveryAt = 0
let lastDiscoveryCompletedAt = null

function frame(value, opcode = 0x1) {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value)
  const length = payload.length
  let header
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length])
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  return Buffer.concat([header, payload])
}

function send(socket, message) {
  if (socket.destroyed || !socket.writable) return
  socket.write(frame(JSON.stringify(message)))
}

function broadcast(message) {
  for (const client of clients) send(client, message)
}

function snapshot() {
  const current = [...nodes.values()]
  const latencyValues = current.map((node) => node.latencyMs).filter(Number.isFinite).sort((a, b) => a - b)
  const middle = Math.floor(latencyValues.length / 2)
  const medianLatencyMs = latencyValues.length
    ? latencyValues.length % 2 ? latencyValues[middle] : (latencyValues[middle - 1] + latencyValues[middle]) / 2
    : null
  return {
    type: 'snapshot',
    at: new Date().toISOString(),
    intervalMs,
    discoveryIntervalMs,
    lastDiscoveryCompletedAt,
    nodes: current,
    metrics: {
      total: current.length,
      online: current.filter((node) => node.status === 'online' || node.status === 'degraded').length,
      degraded: current.filter((node) => node.status === 'degraded').length,
      offline: current.filter((node) => node.status === 'offline').length,
      unknown: current.filter((node) => node.status === 'unknown').length,
      medianLatencyMs,
    },
    logs: logs.slice(-40),
  }
}

function addLog({ name = 'Network monitor', ip = '', severity = 'info', message }) {
  const entry = { at: new Date().toISOString(), name, ip, severity, message }
  logs.push(entry)
  if (logs.length > 80) logs.shift()
  broadcast({ type: 'log', log: entry })
  console.log(`[${severity}] ${ip ? `${ip} · ` : ''}${name}: ${message}`)
}

function ping(ip) {
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const child = spawn('ping', ['-4', '-n', '-c', '1', '-W', '1', ip], { stdio: ['ignore', 'pipe', 'ignore'] })
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ reachable: false, error: 'Probe timed out' })
    }, 1600)
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { output += chunk })
    child.once('error', (error) => finish({ reachable: false, error: error.message }))
    child.once('close', (code) => {
      const match = output.match(/time[=<]([\d.]+)\s*ms/i)
      finish({ reachable: code === 0, latencyMs: match ? Number(match[1]) : null })
    })
  })
}

function arpTable() {
  try {
    return readFileSync('/proc/net/arp', 'utf8').split('\n').slice(1).reduce((table, line) => {
      const [ip, , flags, mac] = line.trim().split(/\s+/)
      if (ip && Number.parseInt(flags, 16) & 2 && mac && mac !== '00:00:00:00:00:00') table.set(ip, mac)
      return table
    }, new Map())
  } catch {
    return new Map()
  }
}

function makeStatus(reachable, latencyMs, error, macAddress = null) {
  if (error) return 'unknown'
  if (!reachable) return macAddress ? 'degraded' : 'offline'
  return latencyMs !== null && latencyMs >= 100 ? 'degraded' : 'online'
}

async function probe(node, mode) {
  const result = await ping(node.ip)
  const previous = nodes.get(node.ip)
  const macAddress = arpTable().get(node.ip) || null
  const status = makeStatus(result.reachable, result.latencyMs, result.error, macAddress)
  const at = new Date().toISOString()
  const record = {
    ...(previous || node),
    ...node,
    role: node.role || 'anchor',
    status,
    latencyMs: result.reachable ? result.latencyMs : null,
    macAddress,
    lastChecked: at,
    lastSeen: result.reachable || macAddress ? at : previous?.lastSeen || null,
    evidence: result.error ? `Probe error: ${result.error}` : result.reachable ? 'ICMP echo reply' : macAddress ? 'ARP neighbor present; ICMP did not reply' : 'No ICMP or ARP response',
  }
  nodes.set(node.ip, record)
  broadcast({ type: 'node', node: record })

  const changed = !previous || previous.status !== status
  if (mode === 'anchor' || changed || result.reachable) {
    const message = result.error
      ? `Probe unavailable: ${result.error}`
      : result.reachable
        ? `ICMP response in ${result.latencyMs === null ? 'under 1 ms' : `${result.latencyMs.toFixed(1)} ms`}`
        : macAddress ? 'ARP neighbor responded; ICMP timed out' : 'No ICMP response'
    addLog({ name: record.name, ip: record.ip, severity: result.error ? 'warn' : result.reachable ? status === 'degraded' ? 'warn' : 'ok' : 'warn', message })
  }
  return record
}

async function runAnchorCycle() {
  if (anchorCycleRunning) return
  anchorCycleRunning = true
  try {
    await Promise.all(anchors.map((node) => probe(node, 'anchor')))
    broadcast(snapshot())
  } finally {
    anchorCycleRunning = false
  }
}

async function runDiscoverySweep(manual = false) {
  if (discoveryRunning) {
    broadcast({ type: 'scan', state: 'busy', message: 'Subnet discovery is already running.' })
    return
  }
  if (manual && Date.now() - lastDiscoveryAt < 10000) {
    broadcast({ type: 'scan', state: 'cooldown', message: 'Please wait before starting another subnet sweep.' })
    return
  }
  discoveryRunning = true
  lastDiscoveryAt = Date.now()
  const targets = Array.from({ length: 253 }, (_, index) => `192.168.4.${index + 2}`).filter((ip) => !knownIps.has(ip))
  addLog({ severity: 'info', message: `Starting ARP-assisted ICMP sweep · ${targets.length} addresses` })
  broadcast({ type: 'scan', state: 'started', total: targets.length, message: 'Probing 192.168.4.2–254' })
  const concurrency = 32
  let cursor = 0
  let completed = 0
  try {
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (cursor < targets.length) {
        const ip = targets[cursor++]
        const result = await ping(ip)
        const previous = nodes.get(ip)
        const macAddress = arpTable().get(ip) || null
        if (result.error) {
          if (previous) nodes.set(ip, { ...previous, status: 'unknown', latencyMs: null, lastChecked: new Date().toISOString(), evidence: `Probe error: ${result.error}` })
        } else if (result.reachable || macAddress || previous) {
          const name = previous?.name || `Discovered terminal · ${ip}`
          const record = {
            id: previous?.id || `host-${ip.replaceAll('.', '-')}`,
            name,
            ip,
            role: 'discovered',
            status: makeStatus(result.reachable, result.latencyMs, null, macAddress),
            latencyMs: result.reachable ? result.latencyMs : null,
            macAddress,
            lastChecked: new Date().toISOString(),
            lastSeen: result.reachable || macAddress ? new Date().toISOString() : previous?.lastSeen || null,
            evidence: result.reachable ? 'ICMP echo reply' : macAddress ? 'ARP neighbor present; ICMP did not reply' : 'No ICMP or ARP response',
          }
          nodes.set(ip, record)
          broadcast({ type: 'node', node: record })
          if (result.reachable || (previous && previous.status !== record.status)) {
            addLog({ name, ip, severity: result.reachable ? record.status === 'degraded' ? 'warn' : 'ok' : 'warn', message: result.reachable ? `ICMP response in ${result.latencyMs === null ? 'under 1 ms' : `${result.latencyMs.toFixed(1)} ms`}` : record.evidence })
          }
        }
        completed += 1
        if (completed % concurrency === 0 || completed === targets.length) broadcast({ type: 'scan', state: 'progress', completed, total: targets.length })
      }
    }))
    lastDiscoveryCompletedAt = new Date().toISOString()
    addLog({ severity: 'ok', message: `Subnet sweep complete · ${targets.length} addresses checked · ${nodes.size - anchors.length} discovered terminals tracked` })
    broadcast(snapshot())
    broadcast({ type: 'scan', state: 'complete', total: targets.length, discovered: nodes.size - anchors.length })
  } finally {
    discoveryRunning = false
  }
}

function handleClientData(socket, chunk) {
  socket.frameBuffer = Buffer.concat([socket.frameBuffer || Buffer.alloc(0), chunk])
  while (socket.frameBuffer.length >= 2) {
    const first = socket.frameBuffer[0]
    const second = socket.frameBuffer[1]
    const opcode = first & 0x0f
    const masked = (second & 0x80) !== 0
    let length = second & 0x7f
    let offset = 2
    if (length === 126) {
      if (socket.frameBuffer.length < 4) return
      length = socket.frameBuffer.readUInt16BE(2)
      offset = 4
    } else if (length === 127) {
      if (socket.frameBuffer.length < 10) return
      const extended = socket.frameBuffer.readBigUInt64BE(2)
      if (extended > 65536n) return socket.destroy()
      length = Number(extended)
      offset = 10
    }
    if (!masked) return socket.destroy()
    if (socket.frameBuffer.length < offset + 4 + length) return
    const mask = socket.frameBuffer.subarray(offset, offset + 4)
    const payload = Buffer.from(socket.frameBuffer.subarray(offset + 4, offset + 4 + length))
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4]
    socket.frameBuffer = socket.frameBuffer.subarray(offset + 4 + length)
    if (opcode === 0x8) return socket.end(frame(Buffer.alloc(0), 0x8))
    if (opcode === 0x9) socket.write(frame(payload, 0xa))
    if (opcode === 0x1) {
      try {
        const message = JSON.parse(payload.toString('utf8'))
        if (message.type === 'scan-now') void runDiscoverySweep(true)
      } catch {
        send(socket, { type: 'error', message: 'Invalid monitor command.' })
      }
    }
  }
}

const server = createServer((_request, response) => {
  response.writeHead(404, { 'content-type': 'text/plain' })
  response.end('Not found')
})
server.on('upgrade', (request, socket) => {
  const key = request.headers['sec-websocket-key']
  const origin = request.headers.origin
  let sameOrigin = !origin
  if (origin) {
    try {
      sameOrigin = new URL(origin).host === request.headers.host
    } catch {
      sameOrigin = false
    }
  }
  if (request.url !== '/ws' || request.headers.upgrade?.toLowerCase() !== 'websocket' || !key || !sameOrigin) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    return
  }
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  clients.add(socket)
  socket.on('data', (chunk) => handleClientData(socket, chunk))
  socket.on('close', () => clients.delete(socket))
  socket.on('error', () => clients.delete(socket))
  send(socket, snapshot())
})
server.listen(port, '127.0.0.1', () => console.log(`[monitor] WebSocket service listening on 127.0.0.1:${port}`))

const heartbeatTimer = setInterval(() => { void runAnchorCycle() }, intervalMs)
const discoveryTimer = setInterval(() => { void runDiscoverySweep() }, discoveryIntervalMs)
const keepaliveTimer = setInterval(() => {
  for (const client of clients) if (!client.destroyed && client.writable) client.write(frame(Buffer.alloc(0), 0x9))
}, 25000)
void runAnchorCycle().then(() => runDiscoverySweep()).catch((error) => addLog({ severity: 'warn', message: `Initial scan failed: ${error.message}` }))

function shutdown() {
  clearInterval(heartbeatTimer)
  clearInterval(discoveryTimer)
  clearInterval(keepaliveTimer)
  for (const client of clients) client.end(frame(Buffer.alloc(0), 0x8))
  server.close()
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
