import { readFileSync } from 'node:fs'

const REQUIRED_DEVICE_IPS = [
  '192.168.4.1', '192.168.4.20', '192.168.4.21', '192.168.4.23',
  '192.168.4.24', '192.168.4.26', '192.168.4.27', '192.168.4.28',
  '192.168.4.29', '192.168.4.30', '192.168.4.31', '192.168.4.32',
  '192.168.4.33', '192.168.4.34', '192.168.4.47', '192.168.4.48',
  '192.168.4.49', '192.168.4.200',
]

function isValidDeviceIp(ip) {
  if (typeof ip !== 'string' || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false
  const octets = ip.split('.').map(Number)
  return octets.every((octet) => octet >= 0 && octet <= 255) &&
    ((octets[0] === 192 && octets[1] === 168 && octets[2] === 4 && octets[3] > 0 && octets[3] < 255) ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127))
}

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

  for (const [ip, name] of Object.entries(matrix)) {
    if (!isValidDeviceIp(ip)) throw new Error(`Invalid device IP address in matrix: ${ip}`)
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new Error(`Invalid device label for ${ip}; names must be 1–80 characters without control characters.`)
    }
  }

  return Object.fromEntries(Object.entries(matrix).map(([ip, name]) => [ip, name.trim()]))
}
