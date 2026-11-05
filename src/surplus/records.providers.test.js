import test from 'node:test'
import assert from 'node:assert/strict'
import { cycleKeyOf, cycleRecordKey, parseRecordKey, validateCycleRecord, validateRunRecord } from './records.js'
import { validateIdeaRecord } from './ideas.js'
import { LEGACY_CYCLE, LEGACY_IDEA_LAUNCHED, LEGACY_RUN } from '../providers/fixtures/legacyData.js'

const P = 'p_recordsaaaaa'
const run = (over = {}) => ({ ...LEGACY_RUN, serviceId: P, cycleKey: `${P}:2026-03-09`, ...over })

test('cycle keys accept provider ids and legacy ids and reject anything else', () => {
  assert.equal(cycleRecordKey(P, '2026-03-09'), `cycle:${P}:2026-03-09`)
  assert.equal(cycleKeyOf(P, '2026-03-09'), `${P}:2026-03-09`)
  assert.deepEqual(parseRecordKey(`cycle:${P}:2026-03-09`), { kind: 'cycle', serviceId: P, resetDate: '2026-03-09' })
  assert.deepEqual(parseRecordKey('cycle:claude:2026-03-09'), { kind: 'cycle', serviceId: 'claude', resetDate: '2026-03-09' })
  assert.equal(parseRecordKey('cycle:whoever:2026-03-09'), null)
  assert.throws(() => cycleRecordKey('whoever', '2026-03-09'))
})

test('a run record accepts a provider id, an optional providerName and a provider cycleKey', () => {
  assert.equal(validateRunRecord(run()).valid, true)
  assert.equal(validateRunRecord(run({ providerName: 'Alpha' })).valid, true)
  assert.equal(validateRunRecord(run({ providerName: 'x'.repeat(61) })).valid, false)
  assert.equal(validateRunRecord(run({ providerName: 5 })).valid, false)
  assert.equal(validateRunRecord(run({ serviceId: 'whoever', cycleKey: 'whoever:2026-03-09' })).valid, false)
  assert.equal(validateRunRecord(run({ cycleKey: 'p_otheraaaaaaa:2026-03-09' })).valid, false, 'cycleKey must name the run provider')
})

test('a cycle record accepts a provider id and an optional providerName', () => {
  const cycle = { ...LEGACY_CYCLE, serviceId: P }
  assert.equal(validateCycleRecord(cycle).valid, true)
  assert.equal(validateCycleRecord({ ...cycle, providerName: 'Alpha' }).valid, true)
  assert.equal(validateCycleRecord({ ...cycle, providerName: 'x'.repeat(61) }).valid, false)
  assert.equal(validateCycleRecord({ ...cycle, serviceId: 'whoever' }).valid, false)
})

test('records written by the previous version still validate unchanged (FR-036, SC-012)', () => {
  assert.equal(validateRunRecord(LEGACY_RUN).valid, true)
  assert.equal(validateCycleRecord(LEGACY_CYCLE).valid, true)
  assert.equal(validateIdeaRecord(LEGACY_IDEA_LAUNCHED).valid, true)
})

test('an idea launched on a provider keeps its serviceId field holding the provider id', () => {
  assert.equal(validateIdeaRecord({ ...LEGACY_IDEA_LAUNCHED, serviceId: P }).valid, true)
})

test('a run keeps the provider name it had when it started', () => {
  const started = run({ providerName: 'Name at start' })
  assert.equal(validateRunRecord(started).valid, true)
  assert.equal(started.providerName, 'Name at start')
})
