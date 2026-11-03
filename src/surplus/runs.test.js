// T061: tests for src/surplus/runs.js (implemented by T062).
//
// API under test (all pure; `now` is a Date, run and idea records are plain objects):
//
//   applyResultDecision(idea, 'accepted' | 'discarded' | 'requeued', now) -> { ok: true, idea } | { ok: false, error }
//     Updates ONLY the idea (resultDecision, status, updatedAt). Never touches a run record and never
//     mutates its input. accepted/discarded archive the idea; requeued puts it back to 'waiting'.
//   isRetriable(idea) -> boolean         waiting, failed or needs_input ideas can be run again
//   isFinalised(run) / freezeRun(run)    finalised runs are deep-frozen copies (read-only)
//   failureMessage(code) / describeRunFailure(run)   human-readable failure reasons (FR-021)
//   reviewState(run, idea) -> { decidable, decided, decision, retriable, actions }
//   sortRunsNewestFirst(runs), parseDiff(diff)
import test from 'node:test'
import assert from 'node:assert/strict'
import { FAILURE_REASONS, RUN_STATUS, validateRunRecord } from './records.js'
import { validateIdeaRecord } from './ideas.js'
import {
  FAILURE_MESSAGES,
  applyResultDecision,
  describeRunFailure,
  failureMessage,
  freezeRun,
  isFinalised,
  isRetriable,
  parseDiff,
  reviewState,
  sortRunsNewestFirst,
} from './runs.js'

const NOW = new Date('2026-11-04T10:00:00.000Z')

function idea(overrides = {}) {
  return {
    id: 'i1',
    text: 'Refactor the parser',
    context: '',
    workingFolder: null,
    priority: 'normal',
    size: 'small',
    approvalRequested: true,
    order: 1,
    contentVersion: 1,
    status: 'completed',
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-03T08:00:00.000Z',
    serviceId: 'claude',
    resultDecision: null,
    lastRunId: 'r1',
    ...overrides,
  }
}

function run(overrides = {}) {
  return {
    id: 'r1',
    ideaId: 'i1',
    serviceId: 'claude',
    ideaSnapshot: { text: 'Refactor the parser', context: '', workingFolder: null, resolvedFolder: null, contentVersion: 1 },
    mode: 'auto',
    cycleKey: 'claude:2026-11-10',
    startedAt: '2026-11-03T20:00:00.000Z',
    endedAt: '2026-11-03T20:30:00.000Z',
    status: 'completed',
    failureReason: null,
    decisionInputs: { eligible: true },
    estimatedCostPct: 3,
    output: 'Done',
    truncated: false,
    proposal: { diff: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n', truncated: false, files: 1 },
    localRunDir: null,
    ...overrides,
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

test('fixtures are valid records', () => {
  assert.equal(validateRunRecord(run()).valid, true)
  assert.equal(validateIdeaRecord(idea()).valid, true)
})

test('accepting archives the idea and records the decision, touching nothing else', () => {
  const before = idea()
  const result = applyResultDecision(before, 'accepted', NOW)
  assert.equal(result.ok, true)
  assert.equal(result.idea.status, 'archived')
  assert.equal(result.idea.resultDecision, 'accepted')
  assert.equal(result.idea.updatedAt, NOW.toISOString())
  const { status: _s, resultDecision: _r, updatedAt: _u, ...rest } = result.idea
  const { status: _s0, resultDecision: _r0, updatedAt: _u0, ...rest0 } = before
  assert.deepEqual(rest, rest0)
})

test('discarding archives the idea with resultDecision discarded', () => {
  const result = applyResultDecision(idea(), 'discarded', NOW)
  assert.equal(result.ok, true)
  assert.equal(result.idea.status, 'archived')
  assert.equal(result.idea.resultDecision, 'discarded')
})

test('re-queueing returns the idea to waiting, retriable, with no service', () => {
  const result = applyResultDecision(idea(), 'requeued', NOW)
  assert.equal(result.ok, true)
  assert.equal(result.idea.status, 'waiting')
  assert.equal(result.idea.resultDecision, 'requeued')
  assert.equal(result.idea.serviceId, null)
  assert.equal(result.idea.contentVersion, 1)
  assert.equal(isRetriable(result.idea), true)
  assert.equal(validateIdeaRecord(result.idea).valid, true)
})

test('failed and needs_input ideas can be re-queued or discarded', () => {
  for (const status of ['failed', 'needs_input']) {
    const requeued = applyResultDecision(idea({ status }), 'requeued', NOW)
    assert.equal(requeued.ok, true)
    assert.equal(requeued.idea.status, 'waiting')
    const discarded = applyResultDecision(idea({ status }), 'discarded', NOW)
    assert.equal(discarded.ok, true)
    assert.equal(discarded.idea.status, 'archived')
    assert.equal(validateIdeaRecord(discarded.idea).valid, true)
  }
})

test('a failed run result cannot be accepted', () => {
  const result = applyResultDecision(idea({ status: 'failed' }), 'accepted', NOW)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'not_acceptable')
})

test('an interrupted run leaves a waiting idea retriable and decidable (FR-021)', () => {
  const interrupted = run({
    status: RUN_STATUS.INTERRUPTED,
    failureReason: { code: FAILURE_REASONS.INTERRUPTED, message: 'Runner restarted' },
    proposal: null,
  })
  const waiting = idea({ status: 'waiting', serviceId: null })
  assert.equal(isRetriable(waiting), true)
  const state = reviewState(interrupted, waiting)
  assert.equal(state.retriable, true)
  assert.equal(state.decidable, true)
  assert.deepEqual(state.actions, ['discarded', 'requeued'])
  const result = applyResultDecision(waiting, 'requeued', NOW)
  assert.equal(result.ok, true)
  assert.equal(result.idea.status, 'waiting')
  assert.equal(result.idea.resultDecision, 'requeued')
})

test('failed ideas count as retriable, running and archived ones do not', () => {
  assert.equal(isRetriable(idea({ status: 'failed' })), true)
  assert.equal(isRetriable(idea({ status: 'needs_input' })), true)
  assert.equal(isRetriable(idea({ status: 'running' })), false)
  assert.equal(isRetriable(idea({ status: 'archived' })), false)
})

test('archived and running ideas refuse a decision', () => {
  const archived = applyResultDecision(idea({ status: 'archived', resultDecision: 'accepted' }), 'requeued', NOW)
  assert.equal(archived.ok, false)
  assert.equal(archived.error.code, 'already_decided')
  const running = applyResultDecision(idea({ status: 'running' }), 'discarded', NOW)
  assert.equal(running.ok, false)
  assert.equal(running.error.code, 'not_decidable')
})

test('unknown decision, invalid idea and invalid now are refused', () => {
  assert.equal(applyResultDecision(idea(), 'merge', NOW).ok, false)
  assert.equal(applyResultDecision(idea(), 'merge', NOW).error.code, 'decision_invalid')
  assert.equal(applyResultDecision(null, 'accepted', NOW).ok, false)
  assert.throws(() => applyResultDecision(idea(), 'accepted', 'yesterday'), TypeError)
})

test('applyResultDecision never mutates the idea and returns no run record', () => {
  const before = deepFreeze(idea())
  const result = applyResultDecision(before, 'accepted', NOW)
  assert.equal(result.ok, true)
  assert.notEqual(result.idea, before)
  assert.deepEqual(Object.keys(result).sort(), ['idea', 'ok'])
})

test('a decision leaves the run record untouched (deep-equal, still valid)', () => {
  const record = freezeRun(run())
  const snapshot = JSON.parse(JSON.stringify(record))
  for (const decision of ['accepted', 'discarded', 'requeued']) {
    applyResultDecision(idea(), decision, NOW)
    assert.deepEqual(record, snapshot)
  }
  assert.equal(validateRunRecord(record).valid, true)
})

test('finalised run records are read-only', () => {
  const source = run()
  const frozen = freezeRun(source)
  assert.equal(isFinalised(frozen), true)
  assert.notEqual(frozen, source)
  assert.throws(() => {
    frozen.status = 'failed'
  }, TypeError)
  assert.throws(() => {
    frozen.decisionInputs.eligible = false
  }, TypeError)
  assert.throws(() => {
    frozen.proposal.diff = ''
  }, TypeError)
  source.status = 'failed'
  assert.equal(frozen.status, 'completed')
})

test('a running run is not finalised', () => {
  assert.equal(isFinalised(run({ status: 'running', endedAt: null })), false)
  for (const status of ['completed', 'failed', 'needs_input', 'interrupted']) assert.equal(isFinalised(run({ status })), true)
})

test('every failure code has a non-empty human-readable message', () => {
  for (const code of Object.values(FAILURE_REASONS)) {
    const message = failureMessage(code)
    assert.equal(typeof message, 'string')
    assert.ok(message.length > 10, code)
    assert.equal(message, FAILURE_MESSAGES[code])
    assert.notEqual(message, code)
  }
  assert.ok(failureMessage('something_new').length > 0)
})

test('a failed run exposes its failure reason with a message', () => {
  const failed = run({
    status: 'failed',
    failureReason: { code: FAILURE_REASONS.QUOTA_EXHAUSTED, message: 'The weekly quota ran out' },
  })
  assert.deepEqual(describeRunFailure(failed), { code: 'quota_exhausted', message: 'The weekly quota ran out' })
  const noMessage = run({ status: 'failed', failureReason: { code: FAILURE_REASONS.TIMEOUT, message: '' } })
  assert.equal(describeRunFailure(noMessage).message, FAILURE_MESSAGES.timeout)
})

test('failed or interrupted runs without a reason still get a message, completed ones get none', () => {
  assert.equal(describeRunFailure(run()), null)
  assert.equal(describeRunFailure(run({ status: 'needs_input' })), null)
  const failed = describeRunFailure(run({ status: 'failed', failureReason: null }))
  assert.ok(failed.message.length > 0)
  const interrupted = describeRunFailure(run({ status: 'interrupted', failureReason: null }))
  assert.equal(interrupted.code, 'interrupted')
  assert.equal(interrupted.message, FAILURE_MESSAGES.interrupted)
})

test('reviewState reflects the idea state for the run', () => {
  const pending = reviewState(run(), idea())
  assert.equal(pending.decidable, true)
  assert.equal(pending.decided, false)
  assert.deepEqual(pending.actions, ['accepted', 'discarded', 'requeued'])

  const decided = reviewState(run(), idea({ status: 'archived', resultDecision: 'accepted' }))
  assert.equal(decided.decidable, false)
  assert.equal(decided.decided, true)
  assert.equal(decided.decision, 'accepted')
  assert.deepEqual(decided.actions, [])

  const failed = reviewState(run({ status: 'failed' }), idea({ status: 'failed' }))
  assert.deepEqual(failed.actions, ['discarded', 'requeued'])

  const missing = reviewState(run(), undefined)
  assert.equal(missing.decidable, false)
  assert.deepEqual(missing.actions, [])
})

test('a run superseded by a newer run of the same idea is not decidable', () => {
  const state = reviewState(run({ id: 'r1' }), idea({ lastRunId: 'r2', status: 'completed' }))
  assert.equal(state.decidable, false)
  assert.deepEqual(state.actions, [])
})

test('a re-queued idea that ran again shows the new run as pending, not decided', () => {
  const state = reviewState(run({ id: 'r2' }), idea({ lastRunId: 'r2', status: 'completed', resultDecision: 'requeued' }))
  assert.equal(state.decided, false)
  assert.equal(state.decidable, true)
})

test('sortRunsNewestFirst orders by start time without mutating', () => {
  const runs = [run({ id: 'a', startedAt: '2026-11-01T10:00:00.000Z' }), run({ id: 'b', startedAt: '2026-11-03T10:00:00.000Z' })]
  const sorted = sortRunsNewestFirst(runs)
  assert.deepEqual(sorted.map((r) => r.id), ['b', 'a'])
  assert.deepEqual(runs.map((r) => r.id), ['a', 'b'])
})

test('parseDiff classifies unified diff lines', () => {
  const lines = parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n ctx\n-old\n+new\n')
  assert.deepEqual(
    lines.map((l) => l.kind),
    ['meta', 'meta', 'meta', 'hunk', 'context', 'del', 'add'],
  )
  assert.equal(lines[6].text, '+new')
  assert.deepEqual(parseDiff(''), [])
  assert.deepEqual(parseDiff(null), [])
})
