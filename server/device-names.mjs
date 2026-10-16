import { readFileSync } from 'node:fs'

const REQUIRED_DEVICE_IPS = [
  '192.168.4.20',
  '192.168.4.22',
  '192.168.4.24',
  '192.168.4.27',
  '192.168.4.28',
  '192.168.4.31',
]

export function readDeviceNameMatrix(filePath) {
  let matrix
  try {
    matrix = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read device-name matrix at ${filePath}: ${error.message}`)
  }

  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
    throw new Error('Device-name matrix must be a JSON object keyed by IP address.')
  }

  const missing = REQUIRED_DEVICE_IPS.filter((ip) => typeof matrix[ip] !== 'string' || !matrix[ip].trim())
  if (missing.length) {
    throw new Error(`Device-name matrix is missing required home devices: ${missing.join(', ')}`)
  }

  return matrix
}
