import { spawn } from 'node:child_process'

let stopping = false
const children = new Map()

function stop(signal = 'SIGTERM', exitCode = 0) {
  if (stopping) return
  stopping = true
  process.exitCode = exitCode
  for (const child of children.values()) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
  }
  const forceExit = setTimeout(() => {
    for (const child of children.values()) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  }, 5000)
  forceExit.unref()
}

function launch(name, command, args) {
  const child = spawn(command, args, { stdio: 'inherit' })
  children.set(name, child)
  child.once('error', (error) => {
    console.error(`[container] ${name} failed to start: ${error.message}`)
    stop('SIGTERM', 1)
  })
  child.once('exit', (code, signal) => {
    if (stopping) return
    console.error(`[container] ${name} exited unexpectedly (${signal || code || 'unknown'})`)
    stop('SIGTERM', code || 1)
  })
  return child
}

process.once('SIGTERM', () => stop('SIGTERM'))
process.once('SIGINT', () => stop('SIGINT'))

launch('network monitor', process.execPath, ['/app/monitor.mjs'])
launch('nginx', 'nginx', ['-g', 'daemon off;'])
