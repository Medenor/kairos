import test from 'node:test'
import assert from 'node:assert/strict'
import { SERVICES } from '../data/services.js'
import { mapLocalStorageImport } from '../../backend/src/services/localstorage-import-mapper.js'
import { RESET_DATE_KEY } from '../utils.js'
import { exportLocalStateForMigration } from './localExport.js'

const STORAGE_KEY = 'kairos-ai-quota-router:state'
const STAMP = '2026-11-02T08:00:00.000Z'

function withBrowserStubs(stored, fn) {
  const store = new Map(stored ? [[STORAGE_KEY, JSON.stringify(stored)]] : [])
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
  const payload = withBrowserStubs({ claude: { weekly: 12, __ts_weekly: STAMP } }, () =>
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
  assert.equal(byKey.get('claude:__ts_weekly').payload.value, STAMP)
  assert.equal(byKey.get('claude:__ts_weekly').source_fingerprint, `claude:__ts_weekly:${STAMP}`)
  assert.equal(byKey.get('claude:__ts_slot5h').payload.value, null)
})

test('migration export without stored state yields null stamps', () => {
  const payload = withBrowserStubs(null, () => exportLocalStateForMigration('ws-1'))
  const stamp = payload.records.find((record) => record.logical_key === 'chatgpt:__ts_codex_5h')
  assert.equal(stamp.payload.value, null)
})

test('the backend import mapper accepts the stamp logical keys unchanged', () => {
  const payload = withBrowserStubs({ claude: { __ts_weekly: STAMP } }, () =>
    exportLocalStateForMigration('ws-1')
  )
  const { records, errors } = mapLocalStorageImport(payload)
  assert.deepEqual(errors, [])
  const mapped = records.find((record) => record.logicalKey === 'claude:__ts_weekly')
  assert.equal(mapped.recordType, 'quota_state')
  assert.deepEqual(mapped.payload, { value: STAMP })
})
