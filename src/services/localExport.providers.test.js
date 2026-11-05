import test from 'node:test'
import assert from 'node:assert/strict'
import { mapLocalStorageImport } from '../../backend/src/services/localstorage-import-mapper.js'
import { exportLocalStateForMigration } from './localExport.js'
import { PROVIDERS_STORAGE_KEY } from '../providers/storage.js'
import { toTombstone } from '../providers/records.js'
import { MONTHLY_ID, PAYG_ID, WEEKLY_ID, WEEKLY_Q_WEEK, sampleCatalogue, samplePayg } from '../providers/fixtures/sampleProviders.js'
import { LEGACY_STATE } from '../providers/fixtures/legacyData.js'

function exported({ catalogue, state = {}, history = null }) {
  const store = new Map([['kairos-ai-quota-router:state', JSON.stringify(state)]])
  if (catalogue) {
    store.set(PROVIDERS_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, providers: catalogue.providers, order: catalogue.order, orderUpdatedAt: '2026-03-04T10:00:00.000Z' }))
  }
  if (history) store.set('kairos:weekly-history', JSON.stringify(history))
  const previous = ['localStorage', 'navigator'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key) => store.get(key) ?? null } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { platform: 'test', language: 'en' } })
  try {
    return exportLocalStateForMigration('ws-1')
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
}

test('the export carries provider:{id} records for active providers and for tombstones, and the order as routing_config', () => {
  const catalogue = sampleCatalogue()
  catalogue.providers[PAYG_ID] = toTombstone(samplePayg(), '2026-03-05T00:00:00.000Z')
  catalogue.order = [MONTHLY_ID, WEEKLY_ID]
  const { records } = exported({ catalogue })
  const byKey = new Map(records.map((r) => [r.logical_key, r]))
  for (const id of [WEEKLY_ID, MONTHLY_ID, PAYG_ID]) {
    assert.equal(byKey.get(`provider:${id}`).record_type, 'routing_config', id)
  }
  assert.equal(byKey.get(`provider:${PAYG_ID}`).payload.status, 'removed')
  assert.equal(byKey.get('catalogue-order').record_type, 'routing_config')
  assert.deepEqual(byKey.get('catalogue-order').payload.ids, [MONTHLY_ID, WEEKLY_ID])
})

test('the export carries readings, stamps, reset dates and weekly history for active providers (US4-5)', () => {
  const state = { [WEEKLY_ID]: { [WEEKLY_Q_WEEK]: 12, [`__ts_${WEEKLY_Q_WEEK}`]: '2026-03-04T08:00:00.000Z', __last_reset_date: '2026-03-02' } }
  const history = [{ schemaVersion: 1, workspaceId: 'local', weekKey: '2026-W10', capturedAt: '2026-03-04T08:00:00.000Z', services: {} }]
  const { records } = exported({ catalogue: sampleCatalogue(), state, history })
  const keys = records.map((r) => r.logical_key)
  assert.ok(keys.includes(`${WEEKLY_ID}:${WEEKLY_Q_WEEK}`))
  assert.ok(keys.includes(`${WEEKLY_ID}:__last_reset_date`))
  assert.ok(keys.includes('weekly-history:2026-W10'))
})

test('no surplus record is exported (scope unchanged) and legacy state entries are not (FR-020)', () => {
  const { records } = exported({ catalogue: sampleCatalogue(), state: LEGACY_STATE })
  for (const record of records) {
    assert.ok(!/^(idea|run|cycle):/.test(record.logical_key) && !['surplus-policy', 'surplus-control', 'runner-lease'].includes(record.logical_key), record.logical_key)
  }
  for (const legacyId of Object.keys(LEGACY_STATE)) {
    assert.equal(records.some((r) => r.logical_key.startsWith(`${legacyId}:`)), false, legacyId)
  }
})

test('with no provider the export holds no definition and no order record', () => {
  const { records } = exported({ catalogue: null })
  assert.deepEqual(records.filter((r) => r.record_type === 'routing_config'), [])
})

test('the backend import mapper accepts the provider and order records unchanged', () => {
  const { records } = exported({ catalogue: sampleCatalogue() })
  const mapped = mapLocalStorageImport({ records })
  assert.deepEqual(mapped.errors, [])
  assert.ok(mapped.records.some((r) => r.logicalKey === `provider:${WEEKLY_ID}` && r.recordType === 'routing_config'))
})
