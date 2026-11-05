import test from 'node:test'
import assert from 'node:assert/strict'
import { mapLocalStorageImport } from '../../backend/src/services/localstorage-import-mapper.js'
import { RESET_DATE_KEY } from '../utils.js'
import { exportLocalStateForMigration } from './localExport.js'
import { PROVIDERS_STORAGE_KEY } from '../providers/storage.js'
import { sampleCatalogue, sampleServices, WEEKLY_ID, WEEKLY_Q_SESSION, WEEKLY_Q_WEEK } from '../providers/fixtures/sampleProviders.js'
import { LEGACY_STATE } from '../providers/fixtures/legacyData.js'

const STORAGE_KEY = 'kairos-ai-quota-router:state'
const STAMP = '2026-11-02T08:00:00.000Z'
const SERVICES = sampleServices()

function withBrowserStubs(stored, fn, { catalogue = sampleCatalogue() } = {}) {
  const store = new Map()
  if (stored) store.set(STORAGE_KEY, JSON.stringify(stored))
  if (catalogue) store.set(PROVIDERS_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, providers: catalogue.providers, order: catalogue.order }))
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key) => store.get(key) ?? null },
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { platform: 'test', language: 'en' },
  })
  try {
    return fn()
  } finally {
    for (const [name, descriptor] of [
      ['localStorage', previousStorage],
      ['navigator', previousNavigator],
    ]) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
}

test('migration export carries a stamp entry for every quota, like the reset date', () => {
  const payload = withBrowserStubs({ [WEEKLY_ID]: { [WEEKLY_Q_WEEK]: 12, [`__ts_${WEEKLY_Q_WEEK}`]: STAMP } }, () =>
    exportLocalStateForMigration('ws-1')
  )
  const byKey = new Map(payload.records.map((record) => [record.logical_key, record]))

  for (const service of SERVICES) {
    assert.ok(byKey.has(`${service.id}:${RESET_DATE_KEY}`))
    for (const quota of service.quotas) {
      const record = byKey.get(`${service.id}:__ts_${quota.id}`)
      assert.ok(record, `missing stamp record for ${service.id}:${quota.id}`)
      assert.equal(record.record_type, 'quota_state')
    }
  }
  assert.equal(byKey.get(`${WEEKLY_ID}:__ts_${WEEKLY_Q_WEEK}`).payload.value, STAMP)
  assert.equal(byKey.get(`${WEEKLY_ID}:__ts_${WEEKLY_Q_WEEK}`).source_fingerprint, `${WEEKLY_ID}:__ts_${WEEKLY_Q_WEEK}:${STAMP}`)
  assert.equal(byKey.get(`${WEEKLY_ID}:__ts_${WEEKLY_Q_SESSION}`).payload.value, null)
})

test('only readings that exist are exported as values', () => {
  const payload = withBrowserStubs({ [WEEKLY_ID]: { [WEEKLY_Q_WEEK]: 12 } }, () => exportLocalStateForMigration('ws-1'))
  const keys = payload.records.map((record) => record.logical_key)
  assert.ok(keys.includes(`${WEEKLY_ID}:${WEEKLY_Q_WEEK}`))
  assert.ok(!keys.includes(`${WEEKLY_ID}:${WEEKLY_Q_SESSION}`), 'an unread quota has no value record')
})

test('migration export without stored state yields null stamps', () => {
  const payload = withBrowserStubs(null, () => exportLocalStateForMigration('ws-1'))
  const stamp = payload.records.find((record) => record.logical_key === `${WEEKLY_ID}:__ts_${WEEKLY_Q_SESSION}`)
  assert.equal(stamp.payload.value, null)
})

test('with no provider declared nothing is exported, and legacy entries are never exported (FR-020)', () => {
  const payload = withBrowserStubs(LEGACY_STATE, () => exportLocalStateForMigration('ws-1'), { catalogue: null })
  assert.deepEqual(payload.records.filter((r) => r.record_type === 'quota_state'), [])
})

test('the backend import mapper accepts the stamp logical keys unchanged', () => {
  const payload = withBrowserStubs({ [WEEKLY_ID]: { [`__ts_${WEEKLY_Q_WEEK}`]: STAMP } }, () =>
    exportLocalStateForMigration('ws-1')
  )
  const { records, errors } = mapLocalStorageImport(payload)
  assert.deepEqual(errors, [])
  const mapped = records.find((record) => record.logicalKey === `${WEEKLY_ID}:__ts_${WEEKLY_Q_WEEK}`)
  assert.equal(mapped.recordType, 'quota_state')
  assert.deepEqual(mapped.payload, { value: STAMP })
})
