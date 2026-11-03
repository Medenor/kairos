// Pure idea operations for the surplus runner: create, edit, transition, reorder, validate.
// No clock: callers pass `now` (Date) and ids.
import { DEFAULTS, PRIORITY, SIZE, STATUS, SUPPORTED_SERVICE_IDS } from './constants.js'
import { isoOrNull } from './records.js'

export const CONTEXT_LIMIT_CHARS = DEFAULTS.CONTEXT_LIMIT_CHARS

const PRIORITIES = Object.values(PRIORITY)
const SIZES = Object.values(SIZE)
const STATUSES = Object.values(STATUS)
const DECISIONS = ['accepted', 'discarded', 'requeued']
const CONTENT_FIELDS = ['text', 'context', 'workingFolder']
const EDITABLE_FIELDS = [...CONTENT_FIELDS, 'priority', 'size', 'approvalRequested', 'order']

// State diagram of data-model.md.
const TRANSITIONS = Object.freeze({
  [STATUS.WAITING]: [STATUS.LAUNCHED_MANUALLY, STATUS.RUNNING, STATUS.ARCHIVED],
  [STATUS.LAUNCHED_MANUALLY]: [STATUS.WAITING, STATUS.ARCHIVED],
  [STATUS.RUNNING]: [STATUS.COMPLETED, STATUS.FAILED, STATUS.NEEDS_INPUT],
  [STATUS.FAILED]: [STATUS.WAITING, STATUS.ARCHIVED],
  [STATUS.NEEDS_INPUT]: [STATUS.WAITING],
  [STATUS.COMPLETED]: [STATUS.WAITING, STATUS.ARCHIVED],
  [STATUS.ARCHIVED]: [],
})

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const fail = (field, code, message) => ({ ok: false, error: { field, code, message } })

function requireNow(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('now must be a valid Date')
  return now.toISOString()
}

function checkField(field, value) {
  switch (field) {
    case 'text':
      if (typeof value !== 'string' || value.trim() === '') return ['text_required', 'The idea text is required.']
      return null
    case 'context':
      if (typeof value !== 'string') return ['context_invalid', 'Context must be text.']
      if (value.length > CONTEXT_LIMIT_CHARS) {
        return ['context_too_long', `Context is limited to ${CONTEXT_LIMIT_CHARS} characters (${value.length} given).`]
      }
      return null
    case 'workingFolder':
      return value === null || typeof value === 'string' ? null : ['working_folder_invalid', 'The working folder must be text.']
    case 'priority':
      return PRIORITIES.includes(value) ? null : ['priority_invalid', `Priority must be one of ${PRIORITIES.join(', ')}.`]
    case 'size':
      return SIZES.includes(value) ? null : ['size_invalid', `Size must be one of ${SIZES.join(', ')}.`]
    case 'approvalRequested':
      return typeof value === 'boolean' ? null : ['approval_invalid', 'approvalRequested must be true or false.']
    case 'order':
      return typeof value === 'number' && Number.isFinite(value) ? null : ['order_invalid', 'Order must be a number.']
    default:
      return null
  }
}

function normaliseFolder(value) {
  return value === undefined || value === '' ? null : value
}

export function createIdea(input) {
  const { id, now } = input ?? {}
  const createdAt = requireNow(now)
  if (typeof id !== 'string' || id === '') return fail('id', 'id_required', 'An idea needs an id.')
  const fields = {
    text: input.text,
    context: input.context ?? '',
    workingFolder: normaliseFolder(input.workingFolder),
    priority: input.priority ?? PRIORITY.NORMAL,
    size: input.size ?? SIZE.MEDIUM,
    approvalRequested: input.approvalRequested ?? false,
    order: input.order ?? 0,
  }
  for (const [field, value] of Object.entries(fields)) {
    const problem = checkField(field, value)
    if (problem) return fail(field, problem[0], problem[1])
  }
  return {
    ok: true,
    idea: {
      id,
      ...fields,
      contentVersion: 1,
      status: STATUS.WAITING,
      createdAt,
      updatedAt: createdAt,
      serviceId: null,
      resultDecision: null,
      lastRunId: null,
    },
  }
}

// changes: any of text, context, workingFolder, priority, size, approvalRequested, order.
// Other keys (status, serviceId, contentVersion, ...) are ignored: they are runner- or system-owned.
export function editIdea(idea, changes, now) {
  const updatedAt = requireNow(now)
  const next = { ...idea }
  let contentChanged = false
  for (const field of EDITABLE_FIELDS) {
    if (!isObject(changes) || !(field in changes)) continue
    const value = field === 'workingFolder' ? normaliseFolder(changes[field]) : changes[field]
    const problem = checkField(field, value)
    if (problem) return fail(field, problem[0], problem[1])
    if (value !== idea[field] && CONTENT_FIELDS.includes(field)) contentChanged = true
    next[field] = value
  }
  if (contentChanged) next.contentVersion = idea.contentVersion + 1
  next.updatedAt = updatedAt
  return { ok: true, idea: next, approvalWithdrawn: contentChanged }
}

// options: { now, serviceId, lastRunId, resultDecision }. Throws on an invalid transition.
export function transitionIdea(idea, toStatus, options = {}) {
  if (!STATUSES.includes(toStatus)) throw new Error(`Unknown status: ${String(toStatus)}`)
  const from = idea.status
  if (!(TRANSITIONS[from] ?? []).includes(toStatus)) throw new Error(`Invalid transition: ${from} -> ${toStatus}`)
  const updatedAt = requireNow(options.now)
  const next = { ...idea, status: toStatus, updatedAt }
  if (toStatus === STATUS.LAUNCHED_MANUALLY || toStatus === STATUS.RUNNING) {
    if (!SUPPORTED_SERVICE_IDS.includes(options.serviceId)) throw new Error(`transition to ${toStatus} needs a supported serviceId`)
    next.serviceId = options.serviceId
  }
  if (toStatus === STATUS.WAITING) next.serviceId = null
  if (options.lastRunId !== undefined) next.lastRunId = options.lastRunId
  if (options.resultDecision !== undefined) {
    if (options.resultDecision !== null && !DECISIONS.includes(options.resultDecision)) {
      throw new Error(`Invalid resultDecision: ${String(options.resultDecision)}`)
    }
    next.resultDecision = options.resultDecision
  }
  return next
}

// orderedIds: ids placed first-to-last get order 1..n. Unlisted ideas keep their order.
export function reorderIdeas(ideas, orderedIds, now) {
  const updatedAt = requireNow(now)
  const known = new Set(ideas.map((i) => i.id))
  const seen = new Set()
  for (const id of orderedIds) {
    if (!known.has(id)) throw new Error(`Unknown idea id: ${id}`)
    if (seen.has(id)) throw new Error(`Duplicate idea id: ${id}`)
    seen.add(id)
  }
  const position = new Map(orderedIds.map((id, index) => [id, index + 1]))
  return ideas.map((idea) => {
    const order = position.get(idea.id)
    return order === undefined || order === idea.order ? idea : { ...idea, order, updatedAt }
  })
}

export function validateIdeaRecord(record) {
  if (!isObject(record)) return { valid: false, errors: [{ field: 'record', message: 'Idea record must be an object' }] }
  const errors = []
  const bad = (field, message) => errors.push({ field, message })
  if (typeof record.id !== 'string' || record.id === '') bad('id', 'id must be a non-empty string')
  if (typeof record.text !== 'string' || record.text.trim() === '') bad('text', 'text must be a non-empty string')
  if (record.context !== undefined) {
    if (typeof record.context !== 'string') bad('context', 'context must be a string')
    else if (record.context.length > CONTEXT_LIMIT_CHARS) bad('context', `context exceeds ${CONTEXT_LIMIT_CHARS} characters`)
  }
  if (record.workingFolder !== undefined && record.workingFolder !== null && typeof record.workingFolder !== 'string') {
    bad('workingFolder', 'workingFolder must be a string or null')
  }
  if (!PRIORITIES.includes(record.priority)) bad('priority', 'priority is not a known value')
  if (!SIZES.includes(record.size)) bad('size', 'size is not a known value')
  if (!STATUSES.includes(record.status)) bad('status', 'status is not a known value')
  if (!Number.isInteger(record.contentVersion) || record.contentVersion < 1) bad('contentVersion', 'contentVersion must be an integer >= 1')
  if (record.approvalRequested !== undefined && typeof record.approvalRequested !== 'boolean') {
    bad('approvalRequested', 'approvalRequested must be a boolean')
  }
  if (record.order !== undefined && !(typeof record.order === 'number' && Number.isFinite(record.order))) bad('order', 'order must be a number')
  if (isoOrNull(record.createdAt) === null) bad('createdAt', 'createdAt must be an ISO timestamp')
  if (isoOrNull(record.updatedAt) === null) bad('updatedAt', 'updatedAt must be an ISO timestamp')
  if (record.serviceId !== undefined && record.serviceId !== null && typeof record.serviceId !== 'string') {
    bad('serviceId', 'serviceId must be a string or null')
  }
  if (record.resultDecision !== undefined && record.resultDecision !== null && !DECISIONS.includes(record.resultDecision)) {
    bad('resultDecision', 'resultDecision is not a known value')
  }
  if (record.lastRunId !== undefined && record.lastRunId !== null && typeof record.lastRunId !== 'string') {
    bad('lastRunId', 'lastRunId must be a string or null')
  }
  return errors.length === 0 ? { valid: true, errors: [], idea: record } : { valid: false, errors }
}

// Splits payloads read from the shared store. Invalid records are listed, never run.
export function validateIdeaRecords(records) {
  const ideas = []
  const invalid = []
  for (const record of records) {
    const result = validateIdeaRecord(record)
    if (result.valid) ideas.push(result.idea)
    else invalid.push({ id: isObject(record) && typeof record.id === 'string' ? record.id : null, errors: result.errors })
  }
  return { ideas, invalid }
}
