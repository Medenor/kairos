// Local persistence and shared-record application for the surplus-runner feature.
// Pure ES module: the storage object is injected ({getItem, setItem, removeItem?}), no window,
// localStorage or clock access. Corrupt or foreign data loads as empty and never throws.
import { STATUS } from './constants.js'
import { validateIdeaRecord } from './ideas.js'
import { defaultPolicy, validatePolicy } from './policy.js'
import { parseRecordKey, validateControlPayload, validateCycleRecord, validateLeasePayload, validateRunRecord } from './records.js'

export const SURPLUS_STORAGE_KEYS = Object.freeze({
  ideas: 'kairos:surplus:ideas',
  policy: 'kairos:surplus:policy',
  runs: 'kairos:surplus:runs',
  cycles: 'kairos:surplus:cycles',
  control: 'kairos:surplus:control',
  lease: 'kairos:surplus:lease',
})

// Fields the user edits, and fields the runner changes. Everything else is derived from these.
const USER_FIELDS = ['text', 'context', 'workingFolder', 'priority', 'size', 'approvalRequested', 'order', 'contentVersion', 'createdAt', 'resultDecision']
const RUNNER_FIELDS = ['status', 'serviceId', 'lastRunId']
const CONTENT_FIELDS = ['text', 'context', 'workingFolder']

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const time = (iso) => Date.parse(iso)

export function emptySurplusState() {
  return {
    ideas: [],
    policy: defaultPolicy(),
    runs: [],
    cycles: [],
    control: null,
    lease: null,
    // Transient, never persisted: logical key -> last valid shared record, and unusable shared records.
    recordIndex: {},
    invalid: [],
  }
}

// --- Local storage ------------------------------------------------------------------------

function readJson(storage, key) {
  try {
    const raw = storage?.getItem?.(key)
    if (raw === null || raw === undefined || raw === '') return undefined
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function writeJson(storage, key, value) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return false
    if (value === null || value === undefined) {
      storage.removeItem?.(key)
      return true
    }
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

const validList = (value, isValid) => (Array.isArray(value) ? value.filter((entry) => isValid(entry)) : [])

export function loadIdeas(storage) {
  return validList(readJson(storage, SURPLUS_STORAGE_KEYS.ideas), (e) => validateIdeaRecord(e).valid)
}

export function loadPolicy(storage) {
  const stored = readJson(storage, SURPLUS_STORAGE_KEYS.policy)
  return validatePolicy(stored).ok ? stored : defaultPolicy()
}

export function loadRuns(storage) {
  return validList(readJson(storage, SURPLUS_STORAGE_KEYS.runs), (e) => validateRunRecord(e).valid)
}

export function loadCycles(storage) {
  return validList(readJson(storage, SURPLUS_STORAGE_KEYS.cycles), (e) => validateCycleRecord(e).valid)
}

function loadControl(storage) {
  const stored = readJson(storage, SURPLUS_STORAGE_KEYS.control)
  return validateControlPayload(stored).valid ? stored : null
}

function loadLease(storage) {
  const stored = readJson(storage, SURPLUS_STORAGE_KEYS.lease)
  return validateLeasePayload(stored).valid ? stored : null
}

// Each save returns true when written, false when storage is missing or refused the write.
export const saveIdeas = (storage, ideas) => writeJson(storage, SURPLUS_STORAGE_KEYS.ideas, ideas)
export const savePolicy = (storage, policy) => writeJson(storage, SURPLUS_STORAGE_KEYS.policy, policy)
export const saveRuns = (storage, runs) => writeJson(storage, SURPLUS_STORAGE_KEYS.runs, runs)
export const saveCycles = (storage, cycles) => writeJson(storage, SURPLUS_STORAGE_KEYS.cycles, cycles)

export function loadSurplusState(storage) {
  return {
    ...emptySurplusState(),
    ideas: loadIdeas(storage),
    policy: loadPolicy(storage),
    runs: loadRuns(storage),
    cycles: loadCycles(storage),
    control: loadControl(storage),
    lease: loadLease(storage),
  }
}

// Persists ideas, policy, runs, cycles, control and lease. Returns true only if every write succeeded.
export function saveSurplusState(storage, state) {
  return [
    saveIdeas(storage, state.ideas),
    savePolicy(storage, state.policy),
    saveRuns(storage, state.runs),
    saveCycles(storage, state.cycles),
    writeJson(storage, SURPLUS_STORAGE_KEYS.control, state.control),
    writeJson(storage, SURPLUS_STORAGE_KEYS.lease, state.lease),
  ].every(Boolean)
}

// --- Idea merge ---------------------------------------------------------------------------

function pick(source, fields) {
  const out = {}
  for (const field of fields) if (field in source) out[field] = source[field]
  return out
}

// Merge a shared idea into the local one when both exist (pull path).
// - The shared idea is not newer (by updatedAt) than the local one: local user fields stay, so a
//   stale shared copy never overwrites a newer local edit. Runner-owned fields stay local too,
//   except a runner claim (local waiting, shared running): the runner won the compare-and-set.
// - Otherwise (shared newer or same age): the shared idea wins as a whole.
// updatedAt is a single timestamp, so a runner bump cannot be told apart from a user edit; the
// caller flushes pending local edits before pulling.
export function mergeIdea(local, shared) {
  if (!(time(local.updatedAt) > time(shared.updatedAt))) return { ...shared }
  const merged = { ...local }
  if (local.status === STATUS.WAITING && shared.status === STATUS.RUNNING) Object.assign(merged, pick(shared, RUNNER_FIELDS))
  return merged
}

// Merge after a 409 on a local write (push path): the server copy is authoritative for the
// runner-owned fields, the local copy for everything the user edits. If both sides edited the
// content, contentVersion is bumped past the server's so any approval is withdrawn.
export function mergeIdeaAfterConflict(local, server) {
  const merged = { ...server, ...pick(local, USER_FIELDS), ...pick(server, RUNNER_FIELDS) }
  const contentDiffers = CONTENT_FIELDS.some((field) => local[field] !== server[field])
  merged.contentVersion = contentDiffers
    ? Math.max(local.contentVersion, server.contentVersion + 1)
    : Math.max(local.contentVersion, server.contentVersion)
  merged.updatedAt = time(local.updatedAt) >= time(server.updatedAt) ? local.updatedAt : server.updatedAt
  return merged
}

// --- Shared records -----------------------------------------------------------------------

function upsertBy(list, entry, same, prefer) {
  const index = list.findIndex((existing) => same(existing, entry))
  if (index === -1) return [...list, entry]
  const chosen = prefer(list[index], entry)
  if (chosen === list[index]) return list
  const next = list.slice()
  next[index] = chosen
  return next
}

const withoutBy = (list, same) => list.filter((entry) => !same(entry))

function validatePayloadFor(parsed, payload) {
  switch (parsed.kind) {
    case 'idea': {
      const result = validateIdeaRecord(payload)
      if (result.valid && payload.id !== parsed.id) return { valid: false, errors: [{ field: 'id', message: 'id does not match the logical key' }] }
      return result
    }
    case 'run': {
      const result = validateRunRecord(payload)
      if (result.valid && payload.id !== parsed.id) return { valid: false, errors: [{ field: 'id', message: 'id does not match the logical key' }] }
      return result
    }
    case 'cycle': {
      const result = validateCycleRecord(payload)
      if (result.valid && (payload.serviceId !== parsed.serviceId || payload.resetDate !== parsed.resetDate)) {
        return { valid: false, errors: [{ field: 'record', message: 'serviceId and resetDate do not match the logical key' }] }
      }
      return result
    }
    case 'policy': {
      const result = validatePolicy(payload)
      return { valid: result.ok, errors: result.errors.map((e) => ({ field: e.path, message: e.message })) }
    }
    case 'control':
      return validateControlPayload(payload)
    case 'lease':
      return validateLeasePayload(payload)
    default:
      return { valid: false, errors: [{ field: 'record', message: 'unknown record kind' }] }
  }
}

function applyValid(state, parsed, payload) {
  switch (parsed.kind) {
    case 'idea': {
      const existing = state.ideas.find((i) => i.id === parsed.id)
      const incoming = { ...payload }
      const ideas = existing
        ? state.ideas.map((i) => (i === existing ? mergeIdea(existing, incoming) : i))
        : [...state.ideas, incoming]
      return { ...state, ideas }
    }
    case 'run': {
      const existing = state.runs.find((r) => r.id === parsed.id)
      // A finalised run is read-only for the browser.
      if (existing && existing.status !== 'running') return state
      return { ...state, runs: upsertBy(state.runs, { ...payload }, (a, b) => a.id === b.id, (_old, next) => next) }
    }
    case 'cycle': {
      const same = (a, b) => a.serviceId === b.serviceId && a.resetDate === b.resetDate
      const prefer = (old, next) => (time(next.readAt) >= time(old.readAt) ? next : old)
      return { ...state, cycles: upsertBy(state.cycles, { ...payload }, same, prefer) }
    }
    case 'policy':
      return { ...state, policy: payload }
    case 'control': {
      const current = state.control
      const newer =
        !current ||
        time(payload.updatedAt) > time(current.updatedAt) ||
        (time(payload.updatedAt) === time(current.updatedAt) && payload.autoRunEnabled === false)
      return newer ? { ...state, control: { ...payload } } : state
    }
    case 'lease': {
      const current = state.lease
      const newer = !current || time(payload.heartbeatAt) >= time(current.heartbeatAt)
      return newer ? { ...state, lease: { ...payload } } : state
    }
    default:
      return state
  }
}

function applyDeleted(state, parsed) {
  if (parsed.kind === 'idea') return { ...state, ideas: withoutBy(state.ideas, (i) => i.id === parsed.id) }
  if (parsed.kind === 'run') return { ...state, runs: withoutBy(state.runs, (r) => r.id === parsed.id) }
  if (parsed.kind === 'cycle') {
    return { ...state, cycles: withoutBy(state.cycles, (c) => c.serviceId === parsed.serviceId && c.resetDate === parsed.resetDate) }
  }
  return state
}

// Folds a batch of shared records into a surplus state. `base` is a surplus state (see
// emptySurplusState); it is never mutated. Only `routing_config` records whose logical key is in
// a known surplus namespace are considered, so quota_state and snapshot records are ignored.
// Returns a new state; `recordIndex` maps logical key to the last valid shared record (for ids and
// versions when writing back) and `invalid` lists records that failed validation:
// {logicalKey, kind, recordId, version, errors}. An invalid record is never applied and never
// replaces a previously applied valid one.
export function applySurplusRecords(base, items = []) {
  let state = { ...base, recordIndex: { ...base.recordIndex } }
  const invalid = new Map((base.invalid ?? []).map((entry) => [entry.logicalKey, entry]))

  for (const item of items) {
    if (!isObject(item) || item.record_type !== 'routing_config') continue
    const parsed = parseRecordKey(item.logical_key)
    if (!parsed) continue

    const known = state.recordIndex[item.logical_key]
    if (known && Number(item.version) < Number(known.version)) continue // out-of-order older version

    if (item.deleted_at) {
      state = applyDeleted(state, parsed)
      delete state.recordIndex[item.logical_key]
      invalid.delete(item.logical_key)
      continue
    }

    const check = validatePayloadFor(parsed, item.payload)
    if (!check.valid) {
      invalid.set(item.logical_key, {
        logicalKey: item.logical_key,
        kind: parsed.kind,
        recordId: item.id ?? null,
        version: item.version ?? null,
        errors: check.errors,
      })
      continue
    }

    invalid.delete(item.logical_key)
    state = applyValid(state, parsed, item.payload)
    state.recordIndex[item.logical_key] = item
  }

  return { ...state, invalid: [...invalid.values()] }
}
