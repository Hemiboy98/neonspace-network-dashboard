import { readDeviceNameMatrix } from '../server/device-names.mjs'

export { readDeviceNameMatrix }

export function compileDeviceNameMatrix(html, matrix) {
  const marker = '__DEVICE_NAME_MATRIX__'
  const markerCount = html.split(marker).length - 1
  if (markerCount !== 1) {
    throw new Error(`Standalone page must contain exactly one ${marker} placeholder; found ${markerCount}.`)
  }

  const embedded = JSON.stringify(matrix).replace(/[<\u2028\u2029]/g, (character) => ({
    '<': '\\u003c',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  })[character])
  const compiled = html.replace(marker, embedded)
  if (compiled.includes(marker)) throw new Error('Device-name matrix placeholder remained after compilation.')
  return compiled
}
