// Review helpers for surplus run records (feature 006, US4). Pure ES module: no clock, no storage.
//
// Run records are immutable once finalised (data-model.md), so a user decision lives on the idea
// (`resultDecision`, `status`), never on the run. Accepting a result changes nothing outside Kairos:
// output and proposed changes stay drafts (FR-019) and applying them is always a separate user action.
import { STATUS } from './constants.js'
import { transitionIdea } from './ideas.js'
import { FAILURE_REASONS, RUN_STATUS } from './records.js'

export const DECISIONS = Object.freeze(['accepted', 'discarded', 'requeued'])

// Human-readable text per failure code (FR-021). Used when a record carries no message of its own.
export const FAILURE_MESSAGES = Object.freeze({
  [FAILURE_REASONS.TOOL_MISSING]: 'The command-line tool for this service was not found on the runner device.',
  [FAILURE_REASONS.NOT_SIGNED_IN]: 'The tool on the runner device is not signed in to the subscription.',
  [FAILURE_REASONS.QUOTA_EXHAUSTED]: 'The quota ran out during the run, so it was stopped.',
  [FAILURE_REASONS.STOPPED_BY_USER]: 'You stopped the run.',
  [FAILURE_REASONS.TIMEOUT]: 'The run exceeded its maximum duration and was stopped.',
  [FAILURE_REASONS.PROTECTED_HOURS]: 'The run was stopped because protected hours began.',
  [FAILURE_REASONS.RESET_DAY]: 'The run was stopped because the reset day began.',
  [FAILURE_REASONS.BILLING_GUARD]: 'The run was refused because it could have been billed to an API key instead of the subscription.',
  [FAILURE_REASONS.FOLDER_ERROR]: 'The working folder could not be used (missing, unreadable or too large to copy).',
  [FAILURE_REASONS.INTERRUPTED]: 'The runner stopped or restarted before the run finished.',
})

const GENERIC_FAILURE = 'The run did not complete.'

export function failureMessage(code) {
  return FAILURE_MESSAGES[code] ?? GENERIC_FAILURE
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** A run is finalised once it left 'running'. */
export const isFinalised = (run) => isObject(run) && run.status !== RUN_STATUS.RUNNING

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

/** Deep-frozen copy of a finalised run record: any write to it throws in strict mode. */
export function freezeRun(run) {
  return deepFreeze(structuredClone(run))
}

/**
 * `{ code, message }` for a failed or interrupted run, null otherwise. The record's own message wins;
 * the code-based text fills in when it is empty or the record has no reason.
 */
export function describeRunFailure(run) {
  if (!isObject(run)) return null
  const reason = isObject(run.failureReason) ? run.failureReason : null
  if (reason) {
    const message = typeof reason.message === 'string' && reason.message.trim() !== '' ? reason.message : failureMessage(reason.code)
    return { code: reason.code, message }
  }
  if (run.status === RUN_STATUS.INTERRUPTED) {
    return { code: FAILURE_REASONS.INTERRUPTED, message: FAILURE_MESSAGES[FAILURE_REASONS.INTERRUPTED] }
  }
  if (run.status === RUN_STATUS.FAILED) return { code: null, message: GENERIC_FAILURE }
  return null
}

/** Ideas that can be run again: waiting, or failed / needs_input (a requeue returns them to waiting). */
export function isRetriable(idea) {
  return isObject(idea) && [STATUS.WAITING, STATUS.FAILED, STATUS.NEEDS_INPUT].includes(idea.status)
}

export function sortRunsNewestFirst(runs) {
  return [...(Array.isArray(runs) ? runs : [])].sort(
    (a, b) => String(b.startedAt).localeCompare(String(a.startedAt)) || String(b.id).localeCompare(String(a.id)),
  )
}

/**
 * Decision state of one run against its idea. Only the idea's latest run can be decided.
 * actions lists the decisions that applyResultDecision would accept for it.
 */
export function reviewState(run, idea) {
  const none = { decidable: false, decided: false, decision: null, retriable: isRetriable(idea), actions: [] }
  if (!isObject(run) || !isObject(idea) || !isFinalised(run) || idea.lastRunId !== run.id) return none

  const decision = idea.resultDecision ?? null
  const decided =
    decision !== null &&
    (idea.status === STATUS.ARCHIVED || (idea.status === STATUS.WAITING && decision === 'requeued'))
  if (decided) return { ...none, decided: true, decision }

  const actions = DECISIONS.filter((d) => decisionError(idea, d) === null && (d !== 'accepted' || run.status === RUN_STATUS.COMPLETED))
  return { decidable: actions.length > 0, decided: false, decision: null, retriable: isRetriable(idea), actions }
}

const DECIDABLE_STATUSES = [STATUS.COMPLETED, STATUS.FAILED, STATUS.NEEDS_INPUT, STATUS.WAITING]

function decisionError(idea, decision) {
  if (idea.status === STATUS.ARCHIVED) return ['already_decided', 'This idea is already archived.']
  if (!DECIDABLE_STATUSES.includes(idea.status)) {
    return ['not_decidable', `An idea that is ${idea.status} has no result to decide on.`]
  }
  if (decision === 'accepted' && idea.status !== STATUS.COMPLETED) {
    return ['not_acceptable', 'Only a completed result can be accepted.']
  }
  if (decision === 'requeued' && idea.status === STATUS.WAITING && idea.resultDecision === 'requeued') {
    return ['already_decided', 'This idea is already back in the queue.']
  }
  return null
}

/**
 * Records the user's decision on a run result, on the idea only.
 *   accepted  completed -> archived, resultDecision 'accepted'
 *   discarded any decidable -> archived, resultDecision 'discarded'
 *   requeued  any decidable -> waiting (retriable), resultDecision 'requeued'
 * Returns { ok: true, idea } (a new object) or { ok: false, error: {field, code, message} }.
 * The run record is not an input and is never touched; nothing outside Kairos changes.
 */
export function applyResultDecision(idea, decision, now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('now must be a valid Date')
  const fail = (code, message) => ({ ok: false, error: { field: 'decision', code, message } })
  if (!isObject(idea)) return fail('idea_required', 'The idea of this run was not found.')
  if (!DECISIONS.includes(decision)) return fail('decision_invalid', `Decision must be one of ${DECISIONS.join(', ')}.`)
  const problem = decisionError(idea, decision)
  if (problem) return fail(problem[0], problem[1])

  const options = { now, resultDecision: decision }
  let next = idea
  if (decision === 'requeued') {
    // Already waiting (interrupted run): only the decision is recorded.
    next = idea.status === STATUS.WAITING ? { ...idea, resultDecision: decision, updatedAt: now.toISOString() } : transitionIdea(idea, STATUS.WAITING, options)
  } else {
    // needs_input has no direct archive transition: it goes through waiting, as the state diagram allows.
    const from = idea.status === STATUS.NEEDS_INPUT ? transitionIdea(idea, STATUS.WAITING, { now }) : idea
    next = transitionIdea(from, STATUS.ARCHIVED, options)
  }
  return { ok: true, idea: next }
}

/**
 * Splits a unified diff into display lines: `{ kind: 'meta' | 'hunk' | 'add' | 'del' | 'context', text }`.
 * Plain text only: callers must render `text` as text, never as HTML.
 */
export function parseDiff(diff) {
  if (typeof diff !== 'string' || diff === '') return []
  const lines = diff.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.map((text) => {
    let kind = 'context'
    if (/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity index|rename (from|to)|Binary files)/.test(text)) kind = 'meta'
    else if (text.startsWith('@@')) kind = 'hunk'
    else if (text.startsWith('+')) kind = 'add'
    else if (text.startsWith('-')) kind = 'del'
    return { kind, text }
  })
}
