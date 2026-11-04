import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeServer, setupDevice } from './engine.testkit.js'
import { applyQuotaRecord } from '../stateTransitions.js'
import { createWeeklySnapshot } from '../utils.js'
import { toRuntimeServices } from './runtime.js'
import { WEEKLY_ID, WEEKLY_Q_SESSION, WEEKLY_Q_WEEK, sampleWeekly, sampleMonthly } from './fixtures/sampleProviders.js'
import { recommend } from '../routing/engine.js'

const quotaRecord = (key, value) => ({ record_type: 'quota_state', logical_key: key, payload: { value }, version: 1 })

test('readings and a snapshot mentioning provider P arrive before provider:P: nothing creates P, and P appears unread once defined (US4-6, FR-030)', async () => {
  const server = fakeServer()
  const dev = setupDevice({ server })
  dev.engine.setWorkspace('ws')
  // readings and a snapshot of an unknown provider
  server.put(`${WEEKLY_ID}:${WEEKLY_Q_WEEK}`, { value: 40 }, { record_type: 'quota_state' })
  server.put('weekly-history:2026-W10', { schemaVersion: 2, workspaceId: 'ws', weekKey: '2026-W10', providers: { [WEEKLY_ID]: { providerId: WEEKLY_ID, name: 'Alpha Weekly' } } }, { record_type: 'snapshot' })
  await dev.engine.refresh({ full: true })
  assert.deepEqual(dev.snapshot().providers, [], 'no provider created by readings or snapshots')
  assert.deepEqual(Object.keys(dev.snapshot().catalogue.providers), [])

  // the readings never touch the catalogue; the state still receives them
  let state = {}
  state = applyQuotaRecord(state, quotaRecord(`${WEEKLY_ID}:${WEEKLY_Q_WEEK}`, 40))
  assert.equal(state[WEEKLY_ID][WEEKLY_Q_WEEK], 40)

  // now provider:P arrives
  server.put(`provider:${WEEKLY_ID}`, sampleWeekly())
  await dev.engine.refresh({ full: false })
  assert.deepEqual(dev.snapshot().providers.map((p) => p.id), [WEEKLY_ID])

  // its quotas without a reading show as unread: the other quota has no value at all
  const services = toRuntimeServices(dev.snapshot().catalogue)
  const reco = recommend({ task: 'coding_hard', providers: services, state, now: new Date(2026, 2, 4, 12) })
  assert.equal(reco.primary, null)
  assert.equal(reco.excluded[0].cause, 'unread')
  assert.match(reco.excluded[0].detail, /5h slot/)
  assert.equal(createWeeklySnapshot({ workspaceId: 'ws', state, services, now: new Date(2026, 2, 4, 12) }).services[WEEKLY_ID].serviceId, WEEKLY_ID)
  assert.equal(state[WEEKLY_ID][WEEKLY_Q_SESSION], undefined)
})

test('an invalid provider:* record is listed with its errors and never applied', async () => {
  const server = fakeServer()
  const dev = setupDevice({ server })
  dev.engine.setWorkspace('ws')
  server.put(`provider:${WEEKLY_ID}`, { ...sampleWeekly(), name: '' })
  await dev.engine.refresh({ full: true })
  assert.deepEqual(dev.snapshot().providers, [])
  assert.equal(dev.snapshot().invalid.length, 1)
  assert.equal(dev.snapshot().invalid[0].key, `provider:${WEEKLY_ID}`)
  assert.equal(dev.snapshot().invalid[0].errors[0].path, 'name')
})

test('two active providers with the same normalised name stay in the catalogue and in recommendations; nothing is renamed or deleted (FR-002)', async () => {
  const server = fakeServer()
  const dev = setupDevice({ server })
  dev.engine.setWorkspace('ws')
  const first = sampleWeekly({ name: 'Same', createdAt: '2026-03-01T00:00:00.000Z' })
  const second = sampleMonthly({ name: ' same ', createdAt: '2026-03-02T00:00:00.000Z', fits: { coding_hard: 'strong' } })
  server.put(`provider:${first.id}`, first)
  server.put(`provider:${second.id}`, second)
  await dev.engine.refresh({ full: true })
  const snap = dev.snapshot()
  assert.equal(snap.providers.length, 2)
  assert.deepEqual(snap.nameConflicts, [second.id], 'the later-created one is listed')
  assert.equal(snap.catalogue.providers[second.id].name, ' same ', 'nothing renamed')

  const state = {
    [first.id]: { [first.quotas[0].id]: 10, [first.quotas[1].id]: 10 },
    [second.id]: { [second.quotas[0].id]: 10 },
  }
  const a = recommend({ task: 'coding_hard', providers: toRuntimeServices(snap.catalogue), state, now: new Date(2026, 2, 4, 12) })
  const b = recommend({ task: 'coding_hard', providers: [...toRuntimeServices(snap.catalogue)].reverse(), state, now: new Date(2026, 2, 4, 12) })
  assert.deepEqual(a, b, 'deterministic whatever the order')
  assert.ok(a.primary)
  assert.equal(a.alternatives.length, 1)
})
