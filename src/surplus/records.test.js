import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FAILURE_REASONS,
  RUN_STATUS,
  capOutput,
  cycleKeyOf,
  cycleRecordKey,
  ideaKey,
  isLeaseExpired,
  isSurplusKey,
  isoOrNull,
  keyForPolicy,
  keyForControl,
  keyForLease,
  parseRecordKey,
  runKey,
  validateControlPayload,
  validateCycleRecord,
  validateLeasePayload,
  validateRunRecord,
} from './records.js'

test('key builders produce the documented logical keys', () => {
  assert.equal(keyForPolicy(), 'surplus-policy')
  assert.equal(keyForControl(), 'surplus-control')
  assert.equal(keyForLease(), 'runner-lease')
  assert.equal(ideaKey('abc'), 'idea:abc')
  assert.equal(runKey('r-1'), 'run:r-1')
  assert.equal(cycleRecordKey('claude', '2026-11-10'), 'cycle:claude:2026-11-10')
  assert.equal(cycleKeyOf('claude', '2026-11-10'), 'claude:2026-11-10')
})

test('key builders reject invalid input', () => {
  assert.throws(() => ideaKey(''), /id/)
  assert.throws(() => runKey(undefined), /id/)
  assert.throws(() => cycleRecordKey('gemini', '2026-11-10'), /serviceId/)
  assert.throws(() => cycleRecordKey('claude', '10/11/2026'), /resetDate/)
  assert.throws(() => cycleKeyOf('claude', '2026-13-45'), /resetDate/)
})

test('parseRecordKey round-trips every namespace', () => {
  assert.deepEqual(parseRecordKey('surplus-policy'), { kind: 'policy' })
  assert.deepEqual(parseRecordKey('surplus-control'), { kind: 'control' })
  assert.deepEqual(parseRecordKey('runner-lease'), { kind: 'lease' })
  assert.deepEqual(parseRecordKey(ideaKey('x1')), { kind: 'idea', id: 'x1' })
  assert.deepEqual(parseRecordKey(runKey('r9')), { kind: 'run', id: 'r9' })
  assert.deepEqual(parseRecordKey(cycleRecordKey('chatgpt', '2026-12-01')), {
    kind: 'cycle',
    serviceId: 'chatgpt',
    resetDate: '2026-12-01',
  })
})

test('parseRecordKey keeps colons inside ids and returns null for foreign or malformed keys', () => {
  assert.deepEqual(parseRecordKey('idea:a:b'), { kind: 'idea', id: 'a:b' })
  for (const key of ['claude:weekly', 'idea:', 'run:', 'cycle:claude', 'cycle:claude:2026-1-1', 'cycle:gemini:2026-11-10', 'surplus-policy2', '', null, 4]) {
    assert.equal(parseRecordKey(key), null, String(key))
    assert.equal(isSurplusKey(key), false, String(key))
  }
  assert.equal(isSurplusKey('idea:abc'), true)
})

test('isoOrNull accepts ISO strings only', () => {
  assert.equal(isoOrNull('2026-11-03T10:00:00.000Z'), '2026-11-03T10:00:00.000Z')
  assert.equal(isoOrNull('nope'), null)
  assert.equal(isoOrNull(5), null)
})

function run(overrides = {}) {
  return {
    id: 'r1',
    ideaId: 'i1',
    serviceId: 'claude',
    ideaSnapshot: { text: 't', context: '', workingFolder: null, resolvedFolder: '/p/app', contentVersion: 1 },
    mode: 'auto',
    cycleKey: 'claude:2026-11-10',
    startedAt: '2026-11-08T10:00:00.000Z',
    endedAt: '2026-11-08T10:30:00.000Z',
    status: 'completed',
    failureReason: null,
    decisionInputs: { rulesetVersion: 1 },
    estimatedCostPct: 8,
    output: 'done',
    truncated: false,
    proposal: null,
    localRunDir: '/home/u/.kairos-runner/runs/r1',
    ...overrides,
  }
}

test('enums are exported with the documented values', () => {
  assert.deepEqual([...Object.values(RUN_STATUS)].sort(), ['completed', 'failed', 'interrupted', 'needs_input', 'running'])
  assert.deepEqual(
    [...Object.values(FAILURE_REASONS)].sort(),
    ['billing_guard', 'folder_error', 'interrupted', 'not_signed_in', 'protected_hours', 'quota_exhausted', 'reset_day', 'stopped_by_user', 'timeout', 'tool_missing'],
  )
})

test('validateRunRecord accepts a finalised run, a claimed run and a failed run', () => {
  assert.deepEqual(validateRunRecord(run()), { valid: true, errors: [] })
  assert.equal(validateRunRecord(run({ status: 'running', endedAt: null })).valid, true)
  const failed = run({ status: 'failed', failureReason: { code: 'timeout', message: 'Stopped after 60 min' } })
  assert.equal(validateRunRecord(failed).valid, true)
  const withProposal = run({ proposal: { diff: 'diff --git', truncated: false, files: 2 } })
  assert.equal(validateRunRecord(withProposal).valid, true)
})

test('validateRunRecord rejects bad enums, shapes and cycle keys', () => {
  const bad = [
    [run({ status: 'done' }), 'status'],
    [run({ mode: 'manual' }), 'mode'],
    [run({ failureReason: { code: 'oops', message: 'x' } }), 'failureReason'],
    [run({ failureReason: 'timeout' }), 'failureReason'],
    [run({ failureReason: { code: 'timeout' } }), 'failureReason'],
    [run({ serviceId: 'gemini' }), 'serviceId'],
    [run({ cycleKey: 'chatgpt:2026-11-10' }), 'cycleKey'],
    [run({ cycleKey: 'claude:soon' }), 'cycleKey'],
    [run({ id: '' }), 'id'],
    [run({ ideaId: null }), 'ideaId'],
    [run({ startedAt: 'x' }), 'startedAt'],
    [run({ endedAt: 'x' }), 'endedAt'],
    [run({ estimatedCostPct: -1 }), 'estimatedCostPct'],
    [run({ estimatedCostPct: '8' }), 'estimatedCostPct'],
    [run({ ideaSnapshot: null }), 'ideaSnapshot'],
    [run({ ideaSnapshot: { text: 't' } }), 'ideaSnapshot'],
    [run({ decisionInputs: 'x' }), 'decisionInputs'],
    [run({ output: 5 }), 'output'],
    [run({ truncated: 'no' }), 'truncated'],
    [run({ proposal: { diff: 'd', files: 1 } }), 'proposal'],
    [run({ localRunDir: 3 }), 'localRunDir'],
    [null, 'record'],
  ]
  for (const [record, field] of bad) {
    const result = validateRunRecord(record)
    assert.equal(result.valid, false, `${field} should be invalid`)
    assert.ok(result.errors.some((e) => e.field === field), `error for ${field}: ${JSON.stringify(result.errors)}`)
  }
})

test('validateRunRecord caps output and diff at 256 KB measured in bytes', () => {
  const cap = 256 * 1024
  assert.equal(validateRunRecord(run({ output: 'a'.repeat(cap), truncated: true })).valid, true)
  const tooBig = validateRunRecord(run({ output: 'a'.repeat(cap + 1), truncated: true }))
  assert.equal(tooBig.valid, false)
  assert.ok(tooBig.errors.some((e) => e.field === 'output'))
  // 3 bytes per character: 90,000 characters is 270,000 bytes, over the cap
  assert.equal(validateRunRecord(run({ output: '€'.repeat(90000) })).valid, false)
  const bigDiff = run({ proposal: { diff: 'd'.repeat(cap + 1), truncated: true, files: 1 } })
  assert.ok(validateRunRecord(bigDiff).errors.some((e) => e.field === 'proposal'))
})

test('capOutput leaves short text alone and truncates on a character boundary', () => {
  assert.deepEqual(capOutput('hello', 100), { text: 'hello', truncated: false })
  const capped = capOutput('€€€€', 7)
  assert.equal(capped.truncated, true)
  assert.equal(capped.text, '€€')
  assert.ok(new TextEncoder().encode(capped.text).length <= 7)
  const dflt = capOutput('a'.repeat(256 * 1024 + 10))
  assert.equal(dflt.text.length, 256 * 1024)
  assert.equal(dflt.truncated, true)
})

function cycle(overrides = {}) {
  return { serviceId: 'claude', resetDate: '2026-11-10', lastWeeklyRemainingPct: 42, readAt: '2026-11-09T18:00:00.000Z', ...overrides }
}

test('validateCycleRecord checks service, date, percentage and timestamp', () => {
  assert.deepEqual(validateCycleRecord(cycle()), { valid: true, errors: [] })
  assert.equal(validateCycleRecord(cycle({ lastWeeklyRemainingPct: 0 })).valid, true)
  assert.equal(validateCycleRecord(cycle({ lastWeeklyRemainingPct: 100 })).valid, true)
  const bad = [
    [cycle({ serviceId: 'gemini' }), 'serviceId'],
    [cycle({ resetDate: '2026-02-30' }), 'resetDate'],
    [cycle({ resetDate: 'later' }), 'resetDate'],
    [cycle({ lastWeeklyRemainingPct: 101 }), 'lastWeeklyRemainingPct'],
    [cycle({ lastWeeklyRemainingPct: -1 }), 'lastWeeklyRemainingPct'],
    [cycle({ lastWeeklyRemainingPct: NaN }), 'lastWeeklyRemainingPct'],
    [cycle({ readAt: 'x' }), 'readAt'],
    [undefined, 'record'],
  ]
  for (const [record, field] of bad) {
    const result = validateCycleRecord(record)
    assert.equal(result.valid, false, field)
    assert.ok(result.errors.some((e) => e.field === field), field)
  }
})

test('validateControlPayload requires a boolean and a timestamp', () => {
  assert.deepEqual(validateControlPayload({ autoRunEnabled: false, updatedAt: '2026-11-03T10:00:00.000Z' }), { valid: true, errors: [] })
  assert.equal(validateControlPayload({ autoRunEnabled: 'false', updatedAt: '2026-11-03T10:00:00.000Z' }).valid, false)
  assert.equal(validateControlPayload({ autoRunEnabled: true }).valid, false)
  assert.equal(validateControlPayload(null).valid, false)
})

function lease(overrides = {}) {
  return {
    designatedDeviceId: 'dev-1',
    designatedDeviceName: 'Desktop',
    designatedAt: '2026-11-01T09:00:00.000Z',
    deviceId: 'dev-1',
    deviceName: 'Desktop',
    startedAt: '2026-11-03T08:00:00.000Z',
    heartbeatAt: '2026-11-03T08:10:00.000Z',
    leaseSeconds: 180,
    approved: { i1: 2 },
    ...overrides,
  }
}

test('validateLeasePayload checks designatedDeviceId, heartbeat and the approved map', () => {
  assert.deepEqual(validateLeasePayload(lease()), { valid: true, errors: [] })
  assert.equal(validateLeasePayload(lease({ approved: {} })).valid, true)
  const bad = [
    [lease({ designatedDeviceId: '' }), 'designatedDeviceId'],
    [lease({ designatedDeviceId: undefined }), 'designatedDeviceId'],
    [lease({ designatedDeviceName: 4 }), 'designatedDeviceName'],
    [lease({ designatedAt: 'x' }), 'designatedAt'],
    [lease({ deviceId: '' }), 'deviceId'],
    [lease({ deviceName: null }), 'deviceName'],
    [lease({ startedAt: 'x' }), 'startedAt'],
    [lease({ heartbeatAt: null }), 'heartbeatAt'],
    [lease({ leaseSeconds: 0 }), 'leaseSeconds'],
    [lease({ leaseSeconds: '180' }), 'leaseSeconds'],
    [lease({ approved: [] }), 'approved'],
    [lease({ approved: { i1: 'v2' } }), 'approved'],
    [lease({ approved: { i1: 0 } }), 'approved'],
    [null, 'record'],
  ]
  for (const [payload, field] of bad) {
    const result = validateLeasePayload(payload)
    assert.equal(result.valid, false, field)
    assert.ok(result.errors.some((e) => e.field === field), field)
  }
})

test('isLeaseExpired is true only strictly after leaseSeconds without heartbeat', () => {
  const l = lease({ heartbeatAt: '2026-11-03T08:00:00.000Z', leaseSeconds: 180 })
  assert.equal(isLeaseExpired(l, new Date('2026-11-03T08:03:00.000Z')), false)
  assert.equal(isLeaseExpired(l, new Date('2026-11-03T08:03:00.001Z')), true)
  assert.equal(isLeaseExpired(lease({ heartbeatAt: 'garbage' }), new Date('2026-11-03T08:00:00.000Z')), true)
  assert.equal(isLeaseExpired(null, new Date('2026-11-03T08:00:00.000Z')), true)
})
