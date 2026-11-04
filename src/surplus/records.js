// Logical keys and payload validators for the surplus-runner shared records.
// Pure ES module: no browser or Node-only globals other than TextEncoder/TextDecoder, no clock.
import { DEFAULTS } from './constants.js'
import { isKnownServiceRef } from '../providers/ids.js'

export const RUN_STATUS = Object.freeze({
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  NEEDS_INPUT: 'needs_input',
  INTERRUPTED: 'interrupted',
})

export const FAILURE_REASONS = Object.freeze({
  TOOL_MISSING: 'tool_missing',
  NOT_SIGNED_IN: 'not_signed_in',
  QUOTA_EXHAUSTED: 'quota_exhausted',
  STOPPED_BY_USER: 'stopped_by_user',
  TIMEOUT: 'timeout',
  PROTECTED_HOURS: 'protected_hours',
  RESET_DAY: 'reset_day',
  BILLING_GUARD: 'billing_guard',
  FOLDER_ERROR: 'folder_error',
  INTERRUPTED: 'interrupted',
})

const POLICY_KEY = 'surplus-policy'
const CONTROL_KEY = 'surplus-control'
const LEASE_KEY = 'runner-lease'
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

const encoder = new TextEncoder()

export function isoOrNull(value) {
  return typeof value === 'string' && ISO_RE.test(value) && Number.isFinite(Date.parse(value)) ? value : null
}

export function isValidDateKey(value) {
  if (typeof value !== 'string') return false
  const match = DATE_RE.exec(value)
  if (!match) return false
  const [, y, m, d] = match.map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function requireId(value, label) {
  if (typeof value !== 'string' || value === '') throw new Error(`Invalid ${label}: expected a non-empty string id`)
  return value
}

function requireService(serviceId) {
  if (!isKnownServiceRef(serviceId)) throw new Error(`Invalid serviceId: ${String(serviceId)}`)
  return serviceId
}

function requireDate(resetDate) {
  if (!isValidDateKey(resetDate)) throw new Error(`Invalid resetDate: ${String(resetDate)}`)
  return resetDate
}

export const keyForPolicy = () => POLICY_KEY
export const keyForControl = () => CONTROL_KEY
export const keyForLease = () => LEASE_KEY
export const ideaKey = (id) => `idea:${requireId(id, 'idea id')}`
export const runKey = (id) => `run:${requireId(id, 'run id')}`
export const cycleRecordKey = (serviceId, resetDate) => `cycle:${requireService(serviceId)}:${requireDate(resetDate)}`
// The `cycleKey` stored on run records (not the logical key of the cycle record).
export const cycleKeyOf = (serviceId, resetDate) => `${requireService(serviceId)}:${requireDate(resetDate)}`

export function parseRecordKey(key) {
  if (typeof key !== 'string') return null
  if (key === POLICY_KEY) return { kind: 'policy' }
  if (key === CONTROL_KEY) return { kind: 'control' }
  if (key === LEASE_KEY) return { kind: 'lease' }
  if (key.startsWith('idea:') && key.length > 5) return { kind: 'idea', id: key.slice(5) }
  if (key.startsWith('run:') && key.length > 4) return { kind: 'run', id: key.slice(4) }
  if (key.startsWith('cycle:')) {
    const parts = key.slice(6).split(':')
    if (parts.length === 2 && isKnownServiceRef(parts[0]) && isValidDateKey(parts[1])) {
      return { kind: 'cycle', serviceId: parts[0], resetDate: parts[1] }
    }
  }
  return null
}

export const isSurplusKey = (key) => parseRecordKey(key) !== null

// --- Validators -----------------------------------------------------------------------------

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isString = (v) => typeof v === 'string'
const isNonEmptyString = (v) => typeof v === 'string' && v !== ''
const isNonNegativeNumber = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
const byteLength = (text) => encoder.encode(text).length

function result(errors) {
  return { valid: errors.length === 0, errors }
}

function notObject(label = 'record') {
  return result([{ field: 'record', message: `${label} must be an object` }])
}

export function capOutput(text, capBytes = DEFAULTS.OUTPUT_CAP_BYTES) {
  const bytes = encoder.encode(text)
  if (bytes.length <= capBytes) return { text, truncated: false }
  let cut = new TextDecoder().decode(bytes.slice(0, capBytes))
  // A cut inside a multi-byte character decodes to a trailing replacement character.
  while (cut.endsWith('�')) cut = cut.slice(0, -1)
  return { text: cut, truncated: true }
}

export function validateRunRecord(record) {
  if (!isObject(record)) return notObject('Run record')
  const errors = []
  const bad = (field, message) => errors.push({ field, message })
  if (!isNonEmptyString(record.id)) bad('id', 'id must be a non-empty string')
  if (!isNonEmptyString(record.ideaId)) bad('ideaId', 'ideaId must be a non-empty string')
  if (!isKnownServiceRef(record.serviceId)) bad('serviceId', 'serviceId is not a provider id')
  const snap = record.ideaSnapshot
  if (
    !isObject(snap) ||
    !isString(snap.text) ||
    !isString(snap.context) ||
    !(snap.workingFolder === null || isString(snap.workingFolder)) ||
    !(snap.resolvedFolder === null || isString(snap.resolvedFolder)) ||
    !Number.isInteger(snap.contentVersion) ||
    snap.contentVersion < 1
  ) {
    bad('ideaSnapshot', 'ideaSnapshot must hold text, context, workingFolder, resolvedFolder and contentVersion')
  }
  if (record.mode !== 'auto') bad('mode', "mode must be 'auto'")
  if (
    !isString(record.cycleKey) ||
    !isKnownServiceRef(record.serviceId) ||
    !record.cycleKey.startsWith(`${record.serviceId}:`) ||
    !isValidDateKey(record.cycleKey.slice(record.serviceId.length + 1))
  ) {
    bad('cycleKey', "cycleKey must be '{serviceId}:{YYYY-MM-DD}' for the run's service")
  }
  if (record.providerName !== undefined && !(isString(record.providerName) && record.providerName.length <= 60)) {
    bad('providerName', 'providerName must be a string of at most 60 characters')
  }
  if (isoOrNull(record.startedAt) === null) bad('startedAt', 'startedAt must be an ISO timestamp')
  if (record.endedAt !== null && isoOrNull(record.endedAt) === null) bad('endedAt', 'endedAt must be an ISO timestamp or null')
  if (!Object.values(RUN_STATUS).includes(record.status)) bad('status', 'status is not a known run status')
  if (record.failureReason !== null) {
    const fr = record.failureReason
    if (!isObject(fr) || !Object.values(FAILURE_REASONS).includes(fr.code) || !isString(fr.message)) {
      bad('failureReason', 'failureReason must be null or {code, message} with a known code')
    }
  }
  if (!isObject(record.decisionInputs)) bad('decisionInputs', 'decisionInputs must be an object')
  if (!isNonNegativeNumber(record.estimatedCostPct)) bad('estimatedCostPct', 'estimatedCostPct must be a number >= 0')
  if (!isString(record.output)) bad('output', 'output must be a string')
  else if (byteLength(record.output) > DEFAULTS.OUTPUT_CAP_BYTES) bad('output', 'output exceeds 256 KB')
  if (typeof record.truncated !== 'boolean') bad('truncated', 'truncated must be a boolean')
  if (record.proposal !== null) {
    const p = record.proposal
    if (!isObject(p) || !isString(p.diff) || typeof p.truncated !== 'boolean' || !Number.isInteger(p.files) || p.files < 0) {
      bad('proposal', 'proposal must be null or {diff, truncated, files}')
    } else if (byteLength(p.diff) > DEFAULTS.OUTPUT_CAP_BYTES) {
      bad('proposal', 'proposal diff exceeds 256 KB')
    }
  }
  if (record.localRunDir !== null && !isString(record.localRunDir)) bad('localRunDir', 'localRunDir must be a string or null')
  return result(errors)
}

export function validateCycleRecord(record) {
  if (!isObject(record)) return notObject('Cycle record')
  const errors = []
  const bad = (field, message) => errors.push({ field, message })
  if (!isKnownServiceRef(record.serviceId)) bad('serviceId', 'serviceId is not a provider id')
  if (record.providerName !== undefined && !(isString(record.providerName) && record.providerName.length <= 60)) {
    bad('providerName', 'providerName must be a string of at most 60 characters')
  }
  if (!isValidDateKey(record.resetDate)) bad('resetDate', 'resetDate must be a valid YYYY-MM-DD date')
  const pct = record.lastWeeklyRemainingPct
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
    bad('lastWeeklyRemainingPct', 'lastWeeklyRemainingPct must be a number from 0 to 100')
  }
  if (isoOrNull(record.readAt) === null) bad('readAt', 'readAt must be an ISO timestamp')
  return result(errors)
}

export function validateControlPayload(payload) {
  if (!isObject(payload)) return notObject('Control payload')
  const errors = []
  if (typeof payload.autoRunEnabled !== 'boolean') errors.push({ field: 'autoRunEnabled', message: 'autoRunEnabled must be a boolean' })
  if (isoOrNull(payload.updatedAt) === null) errors.push({ field: 'updatedAt', message: 'updatedAt must be an ISO timestamp' })
  return result(errors)
}

export function validateLeasePayload(payload) {
  if (!isObject(payload)) return notObject('Lease payload')
  const errors = []
  const bad = (field, message) => errors.push({ field, message })
  if (!isNonEmptyString(payload.designatedDeviceId)) bad('designatedDeviceId', 'designatedDeviceId must be a non-empty string')
  if (!isString(payload.designatedDeviceName)) bad('designatedDeviceName', 'designatedDeviceName must be a string')
  if (isoOrNull(payload.designatedAt) === null) bad('designatedAt', 'designatedAt must be an ISO timestamp')
  if (!isNonEmptyString(payload.deviceId)) bad('deviceId', 'deviceId must be a non-empty string')
  if (!isString(payload.deviceName)) bad('deviceName', 'deviceName must be a string')
  if (isoOrNull(payload.startedAt) === null) bad('startedAt', 'startedAt must be an ISO timestamp')
  if (isoOrNull(payload.heartbeatAt) === null) bad('heartbeatAt', 'heartbeatAt must be an ISO timestamp')
  if (typeof payload.leaseSeconds !== 'number' || !Number.isFinite(payload.leaseSeconds) || payload.leaseSeconds <= 0) {
    bad('leaseSeconds', 'leaseSeconds must be a positive number')
  }
  const approved = payload.approved
  if (!isObject(approved) || !Object.values(approved).every((v) => Number.isInteger(v) && v >= 1)) {
    bad('approved', 'approved must map idea ids to contentVersion integers >= 1')
  }
  return result(errors)
}

// A lease is expired when now - heartbeatAt > leaseSeconds. An unreadable lease counts as expired.
export function isLeaseExpired(lease, now) {
  if (!isObject(lease) || isoOrNull(lease.heartbeatAt) === null) return true
  if (typeof lease.leaseSeconds !== 'number' || !Number.isFinite(lease.leaseSeconds)) return true
  return now.getTime() - Date.parse(lease.heartbeatAt) > lease.leaseSeconds * 1000
}
