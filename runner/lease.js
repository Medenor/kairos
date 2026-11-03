// Runner lease and designation (T055, FR-014, research D6).
//
// Two separate things live in the shared `runner-lease` record:
//  - the DESIGNATION (`designatedDeviceId`): which device may run. Written by the first `start` in a workspace and
//    moved only by `config --take-over` (config.js `takeOver`). It survives lease expiry.
//  - the LEASE (`deviceId`, `startedAt`, `heartbeatAt`, `leaseSeconds`): proof that one process of the designated
//    device is alive. Heartbeat every 60 s with `expected_version`, expired when now - heartbeatAt > 180 s.
//    `deviceId` + `startedAt` identify the holding process (`startedAt` is set once per claim).
//
// Trust model: the record is writable by any client of the unauthenticated shared store, so it can never authorise
// anything. A forged or garbled record can only make the runner stop (every mismatch is fail-closed and maps to exit
// code 3); starting a run still needs local config, local approvals and local preflight. The `approved` map
// published here is display-only for the dashboard and is never read back.
//
// Time is injected (`now: () => Date`); this module owns no timers. The loop calls `heartbeat()` or `maybeHeartbeat()`.

import { ApiClientError, isDuplicateKey, isVersionConflict } from './api-client.js'
import { isLeaseExpired, isoOrNull, keyForLease, validateLeasePayload } from '../src/surplus/records.js'

/** Process exit codes of the CLI (contracts/runner-cli.md). */
export const EXIT_CODES = Object.freeze({ OK: 0, USAGE: 1, PREFLIGHT: 2, LEASE: 3 })

/** Why a lease or designation is unusable. Every one of them maps to exit code 3. */
export const LEASE_REASONS = Object.freeze({
  NOT_DESIGNATED: 'not_designated', // another device is designated (even when its lease expired)
  LEASE_HELD: 'lease_held', // start refused: a live lease of another process or device exists
  LEASE_TAKEN: 'lease_taken', // running: another process now holds the lease
  LEASE_EXPIRED: 'lease_expired', // running: no successful heartbeat for more than leaseSeconds
  LEASE_INVALID: 'lease_invalid', // record unreadable, or carries no designation
  LEASE_MISSING: 'lease_missing', // record deleted while running
})

export class LeaseError extends Error {
  constructor(reason, message, { record = null } = {}) {
    super(message)
    this.name = 'LeaseError'
    this.reason = reason
    this.exitCode = EXIT_CODES.LEASE
    this.record = record
  }
}

const EPOCH_ISO = new Date(0).toISOString()
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNonEmptyString = (v) => typeof v === 'string' && v !== ''

/** Keep only `{ ideaId: contentVersion >= 1 (integer) }` entries. */
export function sanitizeApproved(map) {
  const out = {}
  if (!isObject(map)) return out
  for (const [id, version] of Object.entries(map)) {
    if (id !== '' && Number.isInteger(version) && version >= 1) out[id] = version
  }
  return out
}

function ownerName(payload) {
  if (isNonEmptyString(payload?.designatedDeviceName)) return payload.designatedDeviceName
  return isNonEmptyString(payload?.designatedDeviceId) ? payload.designatedDeviceId : 'unknown'
}

function messageFor(reason, payload) {
  switch (reason) {
    case LEASE_REASONS.NOT_DESIGNATED:
      return `Another device is the designated runner: designated runner is ${ownerName(payload)}. Run "config --take-over" on this device to replace it.`
    case LEASE_REASONS.LEASE_HELD: {
      const who = isNonEmptyString(payload?.deviceName) ? payload.deviceName : 'another process'
      const until = isoOrNull(payload?.heartbeatAt) ? new Date(Date.parse(payload.heartbeatAt) + payload.leaseSeconds * 1000).toISOString() : 'unknown'
      return `The runner lease is held by ${who} (expires ${until}). Stop that runner or wait for the lease to expire.`
    }
    case LEASE_REASONS.LEASE_TAKEN:
      return 'Another runner process took over the lease.'
    case LEASE_REASONS.LEASE_EXPIRED:
      return 'The lease expired: no heartbeat reached the shared store in time.'
    case LEASE_REASONS.LEASE_MISSING:
      return 'The runner lease record was deleted from the shared store.'
    default:
      return 'The runner lease record is unreadable or has no designated device. Run "config --take-over" on the device that should run.'
  }
}

/**
 * createLease({ config, api, now? }) -> lease
 *
 *  - config  validated runner config (deviceId, deviceName, limits.heartbeatSeconds, limits.leaseSeconds)
 *  - api     client from api-client.js
 *  - now     () => Date (default real clock)
 *
 * lease.claim({ approved? }) -> Promise<{ created, record }>
 *     `start`: take the lease. Creates the record (designating this device) when none exists. Throws LeaseError
 *     (exitCode 3) with reason not_designated (another device is designated, expired lease or not), lease_held (a live
 *     lease exists, whether of another device after a take-over or of another process of this device) or lease_invalid
 *     (no designation readable). Other failures (network, 5xx) propagate as ApiClientError. Nothing is written when it
 *     throws a LeaseError. A designated device repairs an unreadable payload; nobody else does.
 *
 * lease.heartbeat({ approved? }) -> Promise<result>
 *     PUT with expected_version, refreshing heartbeatAt and the display-only `approved` map (omit to keep the last).
 *     result is one of
 *       { status: 'ok', record }
 *       { status: 'retry', error }   transient API failure, the lease is still locally valid: try again next tick
 *       { status: 'lost', reason, exitCode: 3, message }   reason in LEASE_REASONS; terminal, the loop must stop
 *                                     its run and exit with exitCode. Later calls return the same result.
 *     A 409 whose server record still names this device and this process is adopted (version refresh) and retried
 *     once; any other 409 outcome is `lost`. When the designation moved to another device the runner also marks its
 *     own lease released (best effort) so the new device can start at once. Throws if `claim` was never called.
 *
 * lease.maybeHeartbeat(opts?) -> Promise<result | null>   heartbeat only when heartbeatDue(), else null
 * lease.heartbeatDue() -> boolean         now - last successful heartbeat >= heartbeatSeconds
 * lease.verify() -> Promise<result>       read-only check (no PUT) of designation and lease for the 60 s quota
 *                                         watcher; same result shape as heartbeat
 * lease.release() -> Promise<boolean>     best effort: mark our lease expired (heartbeatAt = epoch), keep the designation;
 *                                         writes only when the record still belongs to this process. Call on clean exit.
 * lease.isHeld() -> boolean               claimed, not lost, last successful heartbeat within leaseSeconds
 * lease.lost -> result | null             the terminal `lost` result once known
 * lease.heartbeatIntervalMs, lease.leaseMs
 */
export function createLease({ config, api, now = () => new Date() }) {
  const key = keyForLease()
  const heartbeatIntervalMs = config.limits.heartbeatSeconds * 1000
  const leaseMs = config.limits.leaseSeconds * 1000
  const deviceId = config.deviceId

  let claimed = null // { recordId, version, payload, startedAt, lastOkMs, approved }
  let lost = null
  let released = false

  const lose = (reason, extra = {}) => {
    lost = { status: 'lost', reason, exitCode: EXIT_CODES.LEASE, message: messageFor(reason, extra.payload), ...extra }
    return lost
  }

  function freshPayload({ at, designatedAt, approved }) {
    return {
      designatedDeviceId: deviceId,
      designatedDeviceName: config.deviceName,
      designatedAt,
      deviceId,
      deviceName: config.deviceName,
      startedAt: at,
      heartbeatAt: at,
      leaseSeconds: config.limits.leaseSeconds,
      approved,
    }
  }

  // The reason a record is not ours to use while running, or null when it still names this device and process.
  function mismatch(payload) {
    if (!isObject(payload) || !isNonEmptyString(payload.designatedDeviceId)) return LEASE_REASONS.LEASE_INVALID
    if (payload.designatedDeviceId !== deviceId) return LEASE_REASONS.NOT_DESIGNATED
    if (!validateLeasePayload(payload).valid) return LEASE_REASONS.LEASE_INVALID
    if (payload.deviceId !== deviceId || payload.startedAt !== claimed.startedAt) return LEASE_REASONS.LEASE_TAKEN
    return null
  }

  const locallyExpired = () => now().getTime() - claimed.lastOkMs > leaseMs

  async function writeRelease(record) {
    try {
      await api.updateRecord(record.id, {
        expectedVersion: record.version,
        payload: { ...record.payload, heartbeatAt: EPOCH_ISO },
      })
      return true
    } catch {
      return false
    }
  }

  async function claim({ approved = {} } = {}) {
    const key0 = key
    let existing = await api.getByKey(key0)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const at = now().toISOString()
      const clean = sanitizeApproved(approved)
      let record
      if (!existing) {
        const payload = freshPayload({ at, designatedAt: at, approved: clean })
        try {
          record = await api.createRecord({ logicalKey: key0, payload })
        } catch (error) {
          if (!isDuplicateKey(error)) throw error
          existing = await api.getByKey(key0)
          if (!existing) throw error
          continue
        }
        claimed = { recordId: record.id, version: record.version, payload, startedAt: at, lastOkMs: Date.parse(at), approved: clean }
        lost = null
        released = false
        return { created: true, record }
      }

      const payload = existing.payload
      if (!isObject(payload) || !isNonEmptyString(payload.designatedDeviceId)) {
        throw new LeaseError(LEASE_REASONS.LEASE_INVALID, messageFor(LEASE_REASONS.LEASE_INVALID, payload), { record: existing })
      }
      if (payload.designatedDeviceId !== deviceId) {
        throw new LeaseError(LEASE_REASONS.NOT_DESIGNATED, messageFor(LEASE_REASONS.NOT_DESIGNATED, payload), { record: existing })
      }
      const readable = validateLeasePayload(payload).valid
      if (readable && !isLeaseExpired(payload, new Date(at))) {
        throw new LeaseError(LEASE_REASONS.LEASE_HELD, messageFor(LEASE_REASONS.LEASE_HELD, payload), { record: existing })
      }
      const next = freshPayload({
        at,
        designatedAt: isoOrNull(payload.designatedAt) ?? at,
        approved: clean,
      })
      try {
        record = await api.updateRecord(existing.id, { expectedVersion: existing.version, payload: next })
      } catch (error) {
        if (!isVersionConflict(error) || !error.serverRecord) throw error
        existing = error.serverRecord
        continue
      }
      claimed = { recordId: record.id, version: record.version, payload: next, startedAt: at, lastOkMs: Date.parse(at), approved: clean }
      lost = null
      released = false
      return { created: false, record }
    }
    throw new LeaseError(LEASE_REASONS.LEASE_HELD, 'The runner lease changed repeatedly while claiming it; another runner is probably starting.', { record: existing })
  }

  async function heartbeat({ approved } = {}) {
    if (!claimed) throw new Error('lease.claim() must succeed before heartbeat()')
    if (lost) return lost
    if (approved !== undefined) claimed.approved = sanitizeApproved(approved)

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const at = now()
      const payload = {
        ...claimed.payload,
        heartbeatAt: at.toISOString(),
        leaseSeconds: config.limits.leaseSeconds,
        approved: claimed.approved,
      }
      try {
        const record = await api.updateRecord(claimed.recordId, { expectedVersion: claimed.version, payload })
        claimed.version = record.version
        claimed.payload = payload
        claimed.lastOkMs = at.getTime()
        return { status: 'ok', record }
      } catch (error) {
        if (!(error instanceof ApiClientError)) throw error
        if (error.kind === 'not_found') return lose(LEASE_REASONS.LEASE_MISSING)
        if (isVersionConflict(error) && error.serverRecord) {
          const server = error.serverRecord
          const reason = mismatch(server.payload)
          if (reason) {
            if (reason === LEASE_REASONS.NOT_DESIGNATED && server.payload?.deviceId === deviceId && server.payload?.startedAt === claimed.startedAt) {
              await writeRelease(server)
            }
            return lose(reason, { payload: server.payload })
          }
          if (attempt === 0) {
            // Same designation and same process: someone only bumped the version. Adopt it and retry once.
            claimed.version = server.version
            claimed.payload = server.payload
            continue
          }
          return lose(LEASE_REASONS.LEASE_TAKEN, { payload: server.payload })
        }
        if (isVersionConflict(error)) return lose(LEASE_REASONS.LEASE_INVALID)
        // network, timeout or 5xx: keep going while the lease is still valid locally
        if (locallyExpired()) return lose(LEASE_REASONS.LEASE_EXPIRED)
        return { status: 'retry', error }
      }
    }
    return lose(LEASE_REASONS.LEASE_TAKEN)
  }

  async function verify() {
    if (!claimed) throw new Error('lease.claim() must succeed before verify()')
    if (lost) return lost
    let record
    try {
      record = await api.getByKey(key)
    } catch (error) {
      if (!(error instanceof ApiClientError)) throw error
      if (locallyExpired()) return lose(LEASE_REASONS.LEASE_EXPIRED)
      return { status: 'retry', error }
    }
    if (!record) return lose(LEASE_REASONS.LEASE_MISSING)
    const reason = mismatch(record.payload)
    if (reason) return lose(reason, { payload: record.payload })
    if (locallyExpired()) return lose(LEASE_REASONS.LEASE_EXPIRED)
    return { status: 'ok', record }
  }

  async function release() {
    if (!claimed || released) return false
    released = true
    claimed.lastOkMs = Number.NEGATIVE_INFINITY
    let record
    try {
      record = await api.getByKey(key)
    } catch {
      return false
    }
    if (!record || !isObject(record.payload)) return false
    if (record.payload.deviceId !== deviceId || record.payload.startedAt !== claimed.startedAt) return false
    return writeRelease(record)
  }

  return {
    heartbeatIntervalMs,
    leaseMs,
    claim,
    heartbeat,
    verify,
    release,
    heartbeatDue: () => Boolean(claimed) && !lost && now().getTime() - claimed.lastOkMs >= heartbeatIntervalMs,
    async maybeHeartbeat(opts) {
      return this.heartbeatDue() ? heartbeat(opts) : null
    },
    isHeld: () => Boolean(claimed) && !lost && !released && now().getTime() - claimed.lastOkMs <= leaseMs,
    get lost() {
      return lost
    },
  }
}

/**
 * Read-only description of the lease record for the `status` command. Never throws on a missing or garbled record
 * (only on API failure, as ApiClientError).
 *   { exists, valid, designatedDeviceId, designatedDeviceName, designatedHere, holderDeviceId, holderDeviceName,
 *     heartbeatAt, ageSeconds, expired, approved }
 * `expired` is true when there is no readable lease; `approved` is display-only.
 */
export async function readLeaseStatus({ config, api, now = () => new Date() }) {
  const record = await api.getByKey(keyForLease())
  const str = (v) => (isNonEmptyString(v) ? v : null)
  if (!record || !isObject(record.payload)) {
    return {
      exists: Boolean(record),
      valid: false,
      designatedDeviceId: null,
      designatedDeviceName: null,
      designatedHere: false,
      holderDeviceId: null,
      holderDeviceName: null,
      heartbeatAt: null,
      ageSeconds: null,
      expired: true,
      approved: {},
    }
  }
  const p = record.payload
  const at = now()
  const heartbeatAt = isoOrNull(p.heartbeatAt)
  return {
    exists: true,
    valid: validateLeasePayload(p).valid,
    designatedDeviceId: str(p.designatedDeviceId),
    designatedDeviceName: str(p.designatedDeviceName),
    designatedHere: p.designatedDeviceId === config.deviceId,
    holderDeviceId: str(p.deviceId),
    holderDeviceName: str(p.deviceName),
    heartbeatAt,
    ageSeconds: heartbeatAt ? Math.max(0, Math.floor((at.getTime() - Date.parse(heartbeatAt)) / 1000)) : null,
    expired: isLeaseExpired(p, at),
    approved: sanitizeApproved(p.approved),
  }
}
