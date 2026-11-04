// Display-only view of the runner lease (feature 006, T059). Pure: `now` is always passed in.
// Nothing here authorises anything: `approved` and `approvalRequested` are informational markers
// (FR-013). Only the runner terminal prompt approves an idea.
import { isLeaseExpired } from './records.js'

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export const APPROVAL_INFO_ONLY =
  'Informational only. The browser never approves a run: the prompt on the runner device is the only approval.'

// Whole seconds since the last heartbeat, or null when unreadable. Never negative.
export function leaseAgeSeconds(lease, now) {
  if (!isObject(lease) || typeof lease.heartbeatAt !== 'string') return null
  const t = Date.parse(lease.heartbeatAt)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / 1000))
}

export function formatAge(seconds) {
  if (seconds === null || seconds === undefined) return 'unknown'
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds} s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

// -> null when there is no lease; else {deviceName, online, ageSeconds, ageLabel, summary}
export function describeLease(lease, now) {
  if (!isObject(lease)) return null
  const deviceName =
    (typeof lease.designatedDeviceName === 'string' && lease.designatedDeviceName.trim()) ||
    (typeof lease.deviceName === 'string' && lease.deviceName.trim()) ||
    'unnamed device'
  const online = !isLeaseExpired(lease, now)
  const ageSeconds = leaseAgeSeconds(lease, now)
  const ageLabel = formatAge(ageSeconds)
  const summary = online
    ? `Runner device: ${deviceName}, last heartbeat ${ageLabel}`
    : `Runner device: ${deviceName}, offline (last heartbeat ${ageLabel})`
  return { deviceName, online, ageSeconds, ageLabel, summary }
}

// True when the (display-only) approved map lists this exact content version of the idea.
export function isApprovedOnRunner(lease, idea) {
  if (!isObject(lease) || !isObject(lease.approved) || !isObject(idea)) return false
  return Number.isInteger(idea.contentVersion) && lease.approved[idea.id] === idea.contentVersion
}

// Approval only makes sense for an idea that can still be picked up: waiting (a failed, needs-input
// or completed idea goes back to waiting first). Display only, like the rest of this file.
export function canRequestApproval(idea) {
  return isObject(idea) && idea.status === 'waiting' && idea.approvalRequested !== true
}
