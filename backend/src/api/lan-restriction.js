import { ApiError } from './errors.js'

function ipToInt(ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
}

function isIpv4InCidr(ip, cidr) {
  const [base, bits] = cidr.split('/')
  const ipInt = ipToInt(ip)
  const baseInt = ipToInt(base)
  const size = Number(bits)
  if (ipInt === null || baseInt === null || Number.isNaN(size)) return false
  const mask = size === 0 ? 0 : (~0 << (32 - size)) >>> 0
  return (ipInt & mask) === (baseInt & mask)
}

export function createLanRestriction({ enabled, allowedSubnets, securityEvents }) {
  return function enforceLanOnly(ctx) {
    if (!enabled) return
    const sourceIp = (ctx.req.socket.remoteAddress || '').replace('::ffff:', '')
    if (sourceIp === '::1' || sourceIp === '127.0.0.1') return
    const allowed = allowedSubnets.some((cidr) => isIpv4InCidr(sourceIp, cidr))
    if (!allowed) {
      securityEvents.log('access_denied', { sourceIp, metadata: { reason: 'lan_restriction' } })
      throw new ApiError(403, 'LAN_ONLY', 'Access denied: client is outside allowed LAN subnets')
    }
  }
}
