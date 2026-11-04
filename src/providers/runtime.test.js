import test from 'node:test'
import assert from 'node:assert/strict'
import { activeProviders, removedProviders, toRuntimeService, toRuntimeServices } from './runtime.js'
import { evaluateSurplus } from '../surplus/evaluation.js'
import { createWeeklySnapshot } from '../utils.js'
import {
  MONTHLY_ID, PAYG_ID, WEEKLY_ID,
  sampleCatalogue, sampleMonthly, samplePayg, sampleServices, sampleState, sampleWeekly,
} from './fixtures/sampleProviders.js'

test('schedule maps to reset type and cycle days', () => {
  const cases = [
    [{ type: 'weekly', cycleDays: 7 }, 'weekly', 7],
    [{ type: 'monthly', cycleDays: 30 }, 'monthly', 30],
    [{ type: 'custom', cycleDays: 10 }, 'custom', 10],
    [{ type: 'none', cycleDays: null }, 'none', null],
  ]
  for (const [schedule, resetType, resetCycleDays] of cases) {
    const svc = toRuntimeService(sampleWeekly({ schedule, surplus: null }))
    assert.equal(svc.resetType, resetType)
    assert.equal(svc.resetCycleDays, resetCycleDays)
  }
})

test('quotas carry id, label, type, currency, lowBalance, gates and subnote', () => {
  const p = samplePayg()
  p.quotas[0] = { ...p.quotas[0], lowBalance: 20, gates: ['oneshot'], subnote: 'api only' }
  assert.deepEqual(toRuntimeService(p).quotas, [
    { id: p.quotas[0].id, label: 'Remaining balance', type: 'currency', currency: '$', lowBalance: 20, gates: ['oneshot'], subnote: 'api only' },
  ])
})

test('surplus is present only when the profile is eligible', () => {
  assert.deepEqual(toRuntimeService(sampleWeekly()).surplus, sampleWeekly().surplus)
  assert.equal(toRuntimeService(sampleWeekly({ schedule: { type: 'monthly', cycleDays: 30 } })).surplus, null)
  assert.equal(toRuntimeService(sampleWeekly({ surplus: null })).surplus, null)
  assert.equal(toRuntimeService(sampleMonthly()).surplus, null)
})

test('tombstones are excluded and listed apart; order follows catalogue.order then name', () => {
  const cat = sampleCatalogue()
  cat.providers[MONTHLY_ID] = { schemaVersion: 1, id: MONTHLY_ID, status: 'removed', name: 'Beta Monthly', removedAt: '2026-03-03T00:00:00.000Z' }
  assert.deepEqual(toRuntimeServices(cat).map((s) => s.id), [WEEKLY_ID, PAYG_ID])
  assert.deepEqual(removedProviders(cat).map((p) => p.id), [MONTHLY_ID])
  cat.order = [PAYG_ID, WEEKLY_ID]
  assert.deepEqual(activeProviders(cat).map((p) => p.id), [PAYG_ID, WEEKLY_ID])
  cat.order = [PAYG_ID]
  assert.deepEqual(activeProviders(cat).map((p) => p.id), [PAYG_ID, WEEKLY_ID]) // unlisted: by name
  cat.order = []
  assert.deepEqual(activeProviders(cat).map((p) => p.name), ['Alpha Weekly', 'Gamma Credits'])
})

test('an empty or missing catalogue gives no service', () => {
  assert.deepEqual(toRuntimeServices({ providers: {}, order: [] }), [])
  assert.deepEqual(toRuntimeServices(undefined), [])
})

test('toRuntimeService(sample) deep-equals the hand-written sampleServices (keeps fixtures honest)', () => {
  assert.deepEqual(toRuntimeServices(sampleCatalogue()), sampleServices())
})

test('the result is accepted unchanged by evaluateSurplus and createWeeklySnapshot', () => {
  const services = toRuntimeServices(sampleCatalogue())
  const now = new Date('2026-03-04T10:00:00.000Z')
  const evaluation = evaluateSurplus({
    services, state: sampleState(), ideas: [], policy: undefined, now,
  })
  assert.ok(evaluation)
  const snap = createWeeklySnapshot({ workspaceId: 'local', state: sampleState(), services, now })
  assert.deepEqual(Object.keys(snap.services).sort(), [MONTHLY_ID, PAYG_ID, WEEKLY_ID].sort())
})
