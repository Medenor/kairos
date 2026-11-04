import test from 'node:test'
import assert from 'node:assert/strict'
import { LIMITS, PROVIDER_SCHEMA_VERSION, validateProvider, validateQuotaValue } from './schema.js'
import { sampleWeekly, samplePayg } from './fixtures/sampleProviders.js'

const TASK_IDS = ['coding_hard', 'coding_light', 'work_heavy', 'daily_chat', 'oneshot']
const check = (input, opts = {}) => validateProvider(input, { taskIds: TASK_IDS, ...opts })
const paths = (result) => result.errors.map((e) => e.path)
const withQuota = (patch, i = 0) => {
  const p = sampleWeekly()
  p.quotas = p.quotas.map((q, idx) => (idx === i ? { ...q, ...patch } : q))
  return p
}

test('schema version is 1 and valid samples pass', () => {
  assert.equal(PROVIDER_SCHEMA_VERSION, 1)
  assert.deepEqual(check(sampleWeekly()), { ok: true, errors: [] })
  assert.deepEqual(check(samplePayg()), { ok: true, errors: [] })
})

test('name: 1 to 60 chars trimmed', () => {
  assert.deepEqual(paths(check(sampleWeekly({ name: '' }))), ['name'])
  assert.deepEqual(paths(check(sampleWeekly({ name: '   ' }))), ['name'])
  assert.deepEqual(paths(check(sampleWeekly({ name: 'x'.repeat(61) }))), ['name'])
  assert.equal(check(sampleWeekly({ name: ' ' + 'x'.repeat(60) + ' ' })).ok, true)
})

test('name: unique among others after NFC, trim and case fold', () => {
  const result = check(sampleWeekly({ name: ' Café ' }), { existingNames: ['CAFÉ'] })
  assert.deepEqual(paths(result), ['name'])
  assert.equal(check(sampleWeekly({ name: 'Cafe' }), { existingNames: ['CAFÉ'] }).ok, true)
})

test('cost: null or amount >= 0 with a currency of 1 to 3 chars', () => {
  assert.equal(check(sampleWeekly({ cost: null })).ok, true)
  assert.deepEqual(paths(check(sampleWeekly({ cost: { amount: -1, currency: '€' } }))), ['cost.amount'])
  assert.deepEqual(paths(check(sampleWeekly({ cost: { amount: 1, currency: '' } }))), ['cost.currency'])
  assert.deepEqual(paths(check(sampleWeekly({ cost: { amount: 1, currency: 'EURO' } }))), ['cost.currency'])
  assert.deepEqual(paths(check(sampleWeekly({ cost: { amount: NaN, currency: '€' } }))), ['cost.amount'])
})

test('color: #rrggbb or null', () => {
  assert.equal(check(sampleWeekly({ color: null })).ok, true)
  assert.deepEqual(paths(check(sampleWeekly({ color: 'blue' }))), ['color'])
  assert.deepEqual(paths(check(sampleWeekly({ color: '#12345' }))), ['color'])
})

test('flags: at most 8 of at most 30 chars; note at most 500', () => {
  assert.deepEqual(paths(check(sampleWeekly({ flags: Array(9).fill('a') }))), ['flags'])
  assert.deepEqual(paths(check(sampleWeekly({ flags: ['x'.repeat(31)] }))), ['flags'])
  assert.equal(check(sampleWeekly({ flags: Array(8).fill('x'.repeat(30)) })).ok, true)
  assert.deepEqual(paths(check(sampleWeekly({ note: 'n'.repeat(501) }))), ['note'])
  assert.equal(check(sampleWeekly({ note: 'n'.repeat(500) })).ok, true)
})

test('schedule: weekly 7, monthly 30, custom 1 to 366, none null', () => {
  assert.equal(check(sampleWeekly({ schedule: { type: 'weekly', cycleDays: 7 } })).ok, true)
  assert.deepEqual(paths(check(sampleWeekly({ schedule: { type: 'weekly', cycleDays: 8 } }))), ['schedule.cycleDays'])
  assert.deepEqual(paths(check(sampleWeekly({ schedule: { type: 'monthly', cycleDays: 7 } }))), ['schedule.cycleDays'])
  assert.equal(check(sampleWeekly({ schedule: { type: 'custom', cycleDays: 10 } })).ok, true)
  assert.equal(check(sampleWeekly({ schedule: { type: 'custom', cycleDays: 366 } })).ok, true)
  for (const bad of [0, 367, 1.5, null, '5']) {
    assert.deepEqual(paths(check(sampleWeekly({ schedule: { type: 'custom', cycleDays: bad } }))), ['schedule.cycleDays'])
  }
  assert.equal(check(sampleWeekly({ schedule: { type: 'none', cycleDays: null } })).ok, true)
  assert.deepEqual(paths(check(sampleWeekly({ schedule: { type: 'none', cycleDays: 7 } }))), ['schedule.cycleDays'])
  assert.deepEqual(paths(check(sampleWeekly({ schedule: { type: 'daily', cycleDays: 1 } }))), ['schedule'])
  assert.deepEqual(paths(check(sampleWeekly({ schedule: null }))), ['schedule'])
})

test('quotas: 1 to 8 items', () => {
  assert.deepEqual(paths(check(sampleWeekly({ quotas: [] }))), ['quotas'])
  const q = (i) => ({ id: `q_aaaaaaa${i}`.slice(0, 10), label: `Q${i}`, type: 'consumed_pct', currency: null, lowBalance: null, gates: null, subnote: null })
  const nine = Array.from({ length: 9 }, (_, i) => ({ ...q(i), id: `q_aaaaaa${'abcdefghi'[i]}a` }))
  assert.deepEqual(paths(check(sampleWeekly({ quotas: nine, surplus: null }))), ['quotas'])
  assert.equal(check(sampleWeekly({ quotas: nine.slice(0, 8), surplus: null })).ok, true)
})

test('quota label, type, currency and lowBalance', () => {
  assert.deepEqual(paths(check(withQuota({ label: '' }))), ['quotas[0].label'])
  assert.deepEqual(paths(check(withQuota({ label: 'x'.repeat(41) }))), ['quotas[0].label'])
  assert.deepEqual(paths(check(withQuota({ type: 'weird' }))), ['quotas[0].type'])
  assert.deepEqual(paths(check(withQuota({ currency: '$' }))), ['quotas[0].currency'])
  const payg = (patch) => ({ ...samplePayg(), quotas: [{ ...samplePayg().quotas[0], ...patch }] })
  assert.deepEqual(paths(check(payg({ currency: null }))), ['quotas[0].currency'])
  assert.deepEqual(paths(check(payg({ currency: 'DOLL' }))), ['quotas[0].currency'])
  assert.equal(check(payg({ lowBalance: 20 })).ok, true)
  assert.deepEqual(paths(check(payg({ lowBalance: 0 }))), ['quotas[0].lowBalance'])
  assert.deepEqual(paths(check(payg({ lowBalance: -2 }))), ['quotas[0].lowBalance'])
  assert.deepEqual(paths(check(withQuota({ lowBalance: 5 }))), ['quotas[0].lowBalance'])
})

test('quota gates: null or a non-empty list of known tasks', () => {
  assert.equal(check(withQuota({ gates: ['coding_hard'] })).ok, true)
  assert.deepEqual(paths(check(withQuota({ gates: [] }))), ['quotas[0].gates'])
  assert.deepEqual(paths(check(withQuota({ gates: ['nope'] }))), ['quotas[0].gates'])
  assert.deepEqual(paths(check(withQuota({ subnote: 's'.repeat(61) }))), ['quotas[0].subnote'])
})

test('quota values: percentages 0 to 100, balances >= 0, finite only', () => {
  assert.equal(validateQuotaValue({ type: 'consumed_pct' }, 0).ok, true)
  assert.equal(validateQuotaValue({ type: 'remaining_pct' }, 100).ok, true)
  for (const bad of [-1, 101, 140, NaN, Infinity, 'abc', null, undefined]) {
    assert.equal(validateQuotaValue({ type: 'consumed_pct' }, bad).ok, false, String(bad))
  }
  assert.equal(validateQuotaValue({ type: 'currency' }, 0).ok, true)
  assert.equal(validateQuotaValue({ type: 'currency' }, 1234.5).ok, true)
  assert.equal(validateQuotaValue({ type: 'currency' }, -0.01).ok, false)
  assert.deepEqual(paths(check(withQuota({ value: 140 }))), ['quotas[0].value'])
  assert.deepEqual(paths(check(withQuota({ value: 'abc' }, 1))), ['quotas[1].value'])
  assert.deepEqual(paths(check(withQuota({}), { requireValues: true })), ['quotas[0].value', 'quotas[1].value'])
})

test('fits: keys within the task ids, levels strong|acceptable|weak|none', () => {
  assert.equal(check(sampleWeekly({ fits: {} })).ok, true)
  assert.deepEqual(paths(check(sampleWeekly({ fits: { telepathy: 'strong' } }))), ['fits.telepathy'])
  assert.deepEqual(paths(check(sampleWeekly({ fits: { coding_hard: 'great' } }))), ['fits.coding_hard'])
})

test('limits are exported', () => {
  assert.equal(LIMITS.NAME_MAX, 60)
  assert.equal(LIMITS.QUOTAS_MAX, 8)
  assert.ok(Object.isFrozen(LIMITS))
})
