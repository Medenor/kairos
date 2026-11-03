// Pure state operations behind the surplus store hook (T024): idea actions, policy and control
// updates, change detection for shared writes, and conflict resolution of non-idea records.
// No clock, no storage, no network: ids and `now` are passed in. Every action returns
// {ok: true, state, ...} or {ok: false, error: {field, code, message}} and never mutates its input.
import { PRIORITY, STATUS } from './constants.js'
import { createIdea, editIdea, reorderIdeas, transitionIdea } from './ideas.js'
import { applyResultDecision } from './runs.js'
import { defaultPolicy, validatePolicy } from './policy.js'
import { applySurplusRecords } from './storage.js'
import { cycleRecordKey, ideaKey, keyForControl, keyForPolicy, parseRecordKey } from './records.js'

const PRIORITY_RANK = Object.freeze({ [PRIORITY.HIGH]: 0, [PRIORITY.NORMAL]: 1, [PRIORITY.LOW]: 2 })

const fail = (field, code, message) => ({ ok: false, error: { field, code, message } })
const time = (iso) => Date.parse(iso)

// --- ids ------------------------------------------------------------------------------------

// RFC 4122 v4 id. crypto.randomUUID needs a secure context, and the dashboard is often opened over
// plain http on the LAN, so fall back to getRandomValues, then to Math.random. Never reuse an id:
// the backend answers 500 when a logical key of a deleted record is created again.
export function makeUuid(cryptoLike) {
  if (typeof cryptoLike?.randomUUID === 'function') return cryptoLike.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof cryptoLike?.getRandomValues === 'function') cryptoLike.getRandomValues(bytes)
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// --- ordering -------------------------------------------------------------------------------

// Priority (high first), then manual order, then creation time. Returns a new array.
export function sortIdeas(ideas) {
  return ideas
    .slice()
    .sort(
      (a, b) =>
        (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
        (a.order ?? 0) - (b.order ?? 0) ||
        time(a.createdAt) - time(b.createdAt),
    )
}

export const nextOrder = (ideas) => ideas.reduce((max, idea) => Math.max(max, idea.order ?? 0), 0) + 1

// --- idea actions ---------------------------------------------------------------------------

const withIdeas = (state, ideas) => ({ ...state, ideas })
const findIdea = (state, id) => state.ideas.find((idea) => idea.id === id)
const notFound = (id) => fail('id', 'idea_not_found', `No idea with id ${String(id)}.`)

// input: {text, context?, workingFolder?, priority?, size?, approvalRequested?}. A new idea goes
// last in its priority class.
export function addIdea(state, input, { id, now }) {
  if (state.ideas.some((idea) => idea.id === id)) return fail('id', 'id_in_use', 'An idea with this id already exists.')
  const created = createIdea({ ...(input ?? {}), id, now, order: nextOrder(state.ideas) })
  if (!created.ok) return created
  return { ok: true, state: withIdeas(state, [...state.ideas, created.idea]), idea: created.idea }
}

// Editing text, context or working folder bumps contentVersion: the approval is withdrawn and the
// result says so, for the "must be approved again" notice (FR-029).
export function updateIdea(state, id, changes, now) {
  const idea = findIdea(state, id)
  if (!idea) return notFound(id)
  const edited = editIdea(idea, changes, now)
  if (!edited.ok) return edited
  return {
    ok: true,
    state: withIdeas(state, state.ideas.map((i) => (i === idea ? edited.idea : i))),
    idea: edited.idea,
    approvalWithdrawn: edited.approvalWithdrawn,
  }
}

export function reorder(state, orderedIds, now) {
  try {
    return { ok: true, state: withIdeas(state, reorderIdeas(state.ideas, orderedIds, now)) }
  } catch (error) {
    return fail('orderedIds', 'reorder_invalid', error.message)
  }
}

function transition(state, id, toStatus, options) {
  const idea = findIdea(state, id)
  if (!idea) return notFound(id)
  try {
    const next = transitionIdea(idea, toStatus, options)
    return { ok: true, state: withIdeas(state, state.ideas.map((i) => (i === idea ? next : i))), idea: next }
  } catch (error) {
    return fail('status', 'transition_invalid', error.message)
  }
}

export const archiveIdea = (state, id, now) => transition(state, id, STATUS.ARCHIVED, { now })

export function markLaunchedManually(state, id, serviceId, now) {
  return transition(state, id, STATUS.LAUNCHED_MANUALLY, { now, serviceId })
}

// Accept, discard or re-queue the result of a run (FR-019, FR-020). Only the idea changes: run
// records stay read-only and nothing outside Kairos is touched.
export function decideRun(state, ideaId, decision, now) {
  const idea = findIdea(state, ideaId)
  if (!idea) return notFound(ideaId)
  const decided = applyResultDecision(idea, decision, now)
  if (!decided.ok) return decided
  return { ok: true, state: withIdeas(state, state.ideas.map((i) => (i === idea ? decided.idea : i))), idea: decided.idea }
}

// A running idea belongs to the runner for the duration of the run.
export function deleteIdea(state, id) {
  const idea = findIdea(state, id)
  if (!idea) return notFound(id)
  if (idea.status === STATUS.RUNNING) return fail('status', 'idea_running', 'A running idea cannot be deleted.')
  return { ok: true, state: withIdeas(state, state.ideas.filter((i) => i !== idea)), idea }
}

// A request only; the runner never treats it as an authorisation (FR-013).
export function requestApproval(state, id, now) {
  return updateIdea(state, id, { approvalRequested: true }, now)
}

// --- policy and control ---------------------------------------------------------------------

// `next` is a complete policy or a function (current policy) => policy. Invalid policies are refused.
export function updatePolicy(state, next) {
  const policy = typeof next === 'function' ? next(state.policy) : next
  const checked = validatePolicy(policy)
  if (!checked.ok) {
    return { ...fail('policy', 'policy_invalid', checked.errors.map((e) => `${e.path || 'policy'}: ${e.message}`).join('; ')), errors: checked.errors }
  }
  if (JSON.stringify(policy) === JSON.stringify(state.policy)) return { ok: true, state, policy: state.policy }
  return { ok: true, state: { ...state, policy }, policy }
}

export function setControl(state, autoRunEnabled, now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('now must be a valid Date')
  return { ok: true, state: { ...state, control: { autoRunEnabled: Boolean(autoRunEnabled), updatedAt: now.toISOString() } } }
}

// --- shared records: change detection and payloads ------------------------------------------

// Logical keys whose browser-owned record differs between two states, as {logicalKey, op}. Runs and
// the lease are never written by the browser. Relies on reference equality: the idea operations
// keep untouched entries as they were.
export function diffDirty(prev, next) {
  const changes = []
  const prevIdeas = new Map(prev.ideas.map((i) => [i.id, i]))
  const nextIdeas = new Map(next.ideas.map((i) => [i.id, i]))
  for (const [id, idea] of nextIdeas) if (prevIdeas.get(id) !== idea) changes.push({ logicalKey: ideaKey(id), op: 'upsert' })
  for (const id of prevIdeas.keys()) if (!nextIdeas.has(id)) changes.push({ logicalKey: ideaKey(id), op: 'delete' })

  const cycleId = (c) => cycleRecordKey(c.serviceId, c.resetDate)
  const prevCycles = new Map(prev.cycles.map((c) => [cycleId(c), c]))
  for (const cycle of next.cycles) if (prevCycles.get(cycleId(cycle)) !== cycle) changes.push({ logicalKey: cycleId(cycle), op: 'upsert' })

  if (prev.policy !== next.policy) changes.push({ logicalKey: keyForPolicy(), op: 'upsert' })
  if (prev.control !== next.control && next.control) changes.push({ logicalKey: keyForControl(), op: 'upsert' })
  return changes
}

// The payload to write for a logical key, or null when the entity no longer exists locally.
export function payloadFor(state, logicalKey) {
  const parsed = parseRecordKey(logicalKey)
  if (!parsed) return null
  switch (parsed.kind) {
    case 'idea':
      return state.ideas.find((i) => i.id === parsed.id) ?? null
    case 'cycle':
      return state.cycles.find((c) => c.serviceId === parsed.serviceId && c.resetDate === parsed.resetDate) ?? null
    case 'policy':
      return state.policy
    case 'control':
      return state.control
    default:
      return null
  }
}

// Local browser-owned records the shared store does not hold yet (created while offline, before a
// workspace existed, or never synced). Called once after the first full pull.
export function unsyncedLocalKeys(state) {
  const known = state.recordIndex
  const keys = []
  for (const idea of state.ideas) if (!known[ideaKey(idea.id)]) keys.push(ideaKey(idea.id))
  for (const cycle of state.cycles) {
    const key = cycleRecordKey(cycle.serviceId, cycle.resetDate)
    if (!known[key]) keys.push(key)
  }
  if (!known[keyForPolicy()] && JSON.stringify(state.policy) !== JSON.stringify(defaultPolicy())) keys.push(keyForPolicy())
  if (!known[keyForControl()] && state.control) keys.push(keyForControl())
  return keys
}

// --- shared records: remote deletes ---------------------------------------------------------

// sync/pull never returns deleted records, so a remote delete is only visible as the absence of a
// record we already hold. Given the index held before a FULL pull and that pull's items, returns the
// idea, run and cycle keys that disappeared.
export function remoteDeletedKeys(oldIndex, pulledItems) {
  const present = new Set(pulledItems.filter((i) => i?.record_type === 'routing_config').map((i) => i.logical_key))
  return Object.keys(oldIndex).filter((key) => {
    const parsed = parseRecordKey(key)
    return parsed && ['idea', 'run', 'cycle'].includes(parsed.kind) && !present.has(key)
  })
}

export function dropRemoteDeleted(state, keys) {
  const items = keys.map((key) => ({
    record_type: 'routing_config',
    logical_key: key,
    deleted_at: 'remote',
    version: state.recordIndex[key]?.version ?? 0,
  }))
  return items.length ? applySurplusRecords(state, items) : state
}

// --- shared records: conflicts of non-idea records ------------------------------------------

// Control: the newer record wins and, at equal time, a stop wins (same rule as applySurplusRecords).
export function resolveControlConflict(local, server) {
  const l = time(local.updatedAt)
  const s = time(server.updatedAt)
  if (l > s) return { winner: 'local', payload: local }
  if (l < s) return { winner: 'server', payload: server }
  return local.autoRunEnabled === false ? { winner: 'local', payload: local } : { winner: 'server', payload: server }
}

// Cycle: keep the later reading.
export function resolveCycleConflict(local, server) {
  return time(local.readAt) >= time(server.readAt) ? { winner: 'local', payload: local } : { winner: 'server', payload: server }
}
