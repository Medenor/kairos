import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export function hashPassword(password) {
  const salt = randomBytes(16)
  const digest = scryptSync(password, salt, 64)
  return `${salt.toString('hex')}:${digest.toString('hex')}`
}

export function verifyPassword(password, storedHash) {
  const [saltHex, digestHex] = String(storedHash).split(':')
  if (!saltHex || !digestHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(digestHex, 'hex')
  const actual = scryptSync(password, salt, expected.length)
  return timingSafeEqual(actual, expected)
}
