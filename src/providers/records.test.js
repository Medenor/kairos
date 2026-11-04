import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ORDER_KEY, applyCatalogueRecords, emptyCatalogue, nameConflicts, parseCatalogueKey, providerKey,
  toTombstone, validateOrderPayload, validateProviderRecord,
} from './records.js'
import { MONTHLY_ID, WEEKLY_ID, sampleMonthly, sampleWeekly } from './fixtures/sampleProviders.js'

const rec = (key, payload, version = 1, extra = {}) => ({ record_type: 'routing_config', logical_key: key, payload, version, ...extra })
const tomb = (p, removedAt = '2026-03-05T00:00:00.000Z') => toTombstone(p, removedAt)

test('keys: providerKey builds provider:{id} and rejects non-provider ids', () => {
  assert.equal(providerKey(WEEKLY_ID), `provider:${WEEKLY_ID}`)
  assert.throws(() => providerKey('claude'), TypeError)
  assert.equal(ORDER_KEY, 'catalogue-order')
})

test('parseCatalogueKey recognises providers, the order record and nothing else', () => {
  assert.deepEqual(parseCatalogueKey(`provider:${WEEKLY_ID}`), { kind: 'provider', id: WEEKLY_ID })
  assert.deepEqual(parseCatalogueKey('catalogue-order'), { kind: 'order' })
  for (const other of ['provider:claude', 'idea:1', 'surplus-policy', 'cycle:p_a:2026-01-01', '', null, 4]) {
    assert.equal(parseCatalogueKey(other), null)
  }
})

test('validateProviderRecord accepts a definition and a tombstone', () => {
  assert.equal(validateProviderRecord(sampleWeekly(), providerKey(WEEKLY_ID)).ok, true)
  assert.equal(validateProviderRecord(tomb(sampleWeekly()), providerKey(WEEKLY_ID)).kind, 'tombstone')
  assert.equal(validateProviderRecord(tomb(sampleWeekly()), providerKey(WEEKLY_ID)).ok, true)
})

test('validateProviderRecord rejects id mismatch and every schema violation', () => {
  assert.equal(validateProviderRecord(sampleWeekly(), providerKey(MONTHLY_ID)).ok, false)
  assert.equal(validateProviderRecord({ ...sampleWeekly(), name: '' }).ok, false)
  assert.equal(validateProviderRecord({ ...sampleWeekly(), schemaVersion: 2 }).ok, false)
  assert.equal(validateProviderRecord({ ...sampleWeekly(), status: 'zombie' }).ok, false)
  assert.equal(validateProviderRecord({ ...sampleWeekly(), createdAt: 'yesterday' }).ok, false)
  assert.equal(validateProviderRecord({ ...sampleWeekly(), id: 'claude' }).ok, false)
  const badQuota = sampleWeekly()
  badQuota.quotas[0] = { ...badQuota.quotas[0], id: 'weekly' }
  assert.equal(validateProviderRecord(badQuota).ok, false)
  assert.equal(validateProviderRecord({ ...tomb(sampleWeekly()), removedAt: 'x' }).ok, false)
  assert.equal(validateProviderRecord({ ...tomb(sampleWeekly()), name: '' }).ok, false)
  assert.equal(validateProviderRecord(null).ok, false)
  assert.equal(validateProviderRecord({ ...sampleWeekly(), surplus: { tool: 'claude', weeklyQuotaId: 'weekly' } }).ok, false)
})

test('validateOrderPayload', () => {
  const ok = { schemaVersion: 1, ids: [WEEKLY_ID, MONTHLY_ID], updatedAt: '2026-03-05T00:00:00.000Z' }
  assert.equal(validateOrderPayload(ok).ok, true)
  assert.equal(validateOrderPayload({ ...ok, ids: [WEEKLY_ID, WEEKLY_ID] }).ok, false)
  assert.equal(validateOrderPayload({ ...ok, ids: ['claude'] }).ok, false)
  assert.equal(validateOrderPayload({ ...ok, updatedAt: 'x' }).ok, false)
  assert.equal(validateOrderPayload([]).ok, false)
})

test('applyCatalogueRecords applies valid records and the order, ignoring other namespaces and types', () => {
  const items = [
    rec(providerKey(WEEKLY_ID), sampleWeekly()),
    rec(providerKey(MONTHLY_ID), sampleMonthly()),
    rec(ORDER_KEY, { schemaVersion: 1, ids: [MONTHLY_ID, WEEKLY_ID], updatedAt: '2026-03-05T00:00:00.000Z' }),
    rec('idea:abc', { text: 'x' }),
    rec('surplus-policy', {}),
    { record_type: 'quota_state', logical_key: `${WEEKLY_ID}:q_weekly22`, payload: { value: 3 }, version: 1 },
  ]
  const out = applyCatalogueRecords(emptyCatalogue(), items)
  assert.deepEqual(Object.keys(out.providers).sort(), [MONTHLY_ID, WEEKLY_ID].sort())
  assert.deepEqual(out.order, [MONTHLY_ID, WEEKLY_ID])
  assert.deepEqual(out.invalid, [])
  assert.deepEqual(Object.keys(out.recordIndex).sort(), [ORDER_KEY, providerKey(MONTHLY_ID), providerKey(WEEKLY_ID)].sort())
})

test('an invalid record is listed with its errors and never applied', () => {
  const out = applyCatalogueRecords(emptyCatalogue(), [rec(providerKey(WEEKLY_ID), { ...sampleWeekly(), name: '' })])
  assert.deepEqual(out.providers, {})
  assert.equal(out.invalid.length, 1)
  assert.equal(out.invalid[0].key, providerKey(WEEKLY_ID))
  assert.equal(out.invalid[0].errors[0].path, 'name')
  const fixed = applyCatalogueRecords(out, [rec(providerKey(WEEKLY_ID), sampleWeekly(), 2)])
  assert.deepEqual(fixed.invalid, [])
  assert.ok(fixed.providers[WEEKLY_ID])
})

test('older versions are skipped; newer ones replace', () => {
  const base = applyCatalogueRecords(emptyCatalogue(), [rec(providerKey(WEEKLY_ID), sampleWeekly({ note: 'v3' }), 3)])
  const stale = applyCatalogueRecords(base, [rec(providerKey(WEEKLY_ID), sampleWeekly({ note: 'v2' }), 2)])
  assert.equal(stale.providers[WEEKLY_ID].note, 'v3')
  const fresh = applyCatalogueRecords(base, [rec(providerKey(WEEKLY_ID), sampleWeekly({ note: 'v4' }), 4)])
  assert.equal(fresh.providers[WEEKLY_ID].note, 'v4')
})

test('a tombstone wins over an older or equal definition and removes the id from the order', () => {
  const base = applyCatalogueRecords(emptyCatalogue(), [
    rec(providerKey(WEEKLY_ID), sampleWeekly(), 2),
    rec(ORDER_KEY, { schemaVersion: 1, ids: [WEEKLY_ID], updatedAt: '2026-03-05T00:00:00.000Z' }),
  ])
  const out = applyCatalogueRecords(base, [rec(providerKey(WEEKLY_ID), tomb(sampleWeekly()), 2)])
  assert.equal(out.providers[WEEKLY_ID].status, 'removed')
  assert.deepEqual(out.order, [])
})

test('a removed provider is never resurrected by a stale active record', () => {
  const base = applyCatalogueRecords(emptyCatalogue(), [rec(providerKey(WEEKLY_ID), tomb(sampleWeekly()), 3)])
  const byVersion = applyCatalogueRecords(base, [rec(providerKey(WEEKLY_ID), sampleWeekly(), 3)])
  assert.equal(byVersion.providers[WEEKLY_ID].status, 'removed')
  const olderVersion = applyCatalogueRecords(base, [rec(providerKey(WEEKLY_ID), sampleWeekly(), 1)])
  assert.equal(olderVersion.providers[WEEKLY_ID].status, 'removed')
  // Without a known version (fresh load), timestamps decide.
  const bare = { ...emptyCatalogue(), providers: { [WEEKLY_ID]: tomb(sampleWeekly(), '2026-03-05T00:00:00.000Z') } }
  const staleByTime = applyCatalogueRecords(bare, [rec(providerKey(WEEKLY_ID), sampleWeekly({ updatedAt: '2026-03-04T00:00:00.000Z' }), 2)])
  assert.equal(staleByTime.providers[WEEKLY_ID].status, 'removed')
})

test('a record deleted on the server turns a known provider into a tombstone', () => {
  const base = applyCatalogueRecords(emptyCatalogue(), [rec(providerKey(WEEKLY_ID), sampleWeekly())])
  const out = applyCatalogueRecords(base, [rec(providerKey(WEEKLY_ID), null, 2, { deleted_at: '2026-03-06T00:00:00.000Z' })])
  assert.equal(out.providers[WEEKLY_ID].status, 'removed')
  assert.equal(out.providers[WEEKLY_ID].name, 'Alpha Weekly')
  assert.equal(out.recordIndex[providerKey(WEEKLY_ID)], undefined)
})

test('the input catalogue is never mutated', () => {
  const base = emptyCatalogue()
  const frozen = JSON.stringify(base)
  applyCatalogueRecords(base, [rec(providerKey(WEEKLY_ID), sampleWeekly())])
  assert.equal(JSON.stringify(base), frozen)
})

test('nameConflicts lists the later-created duplicate of an active name', () => {
  const a = sampleWeekly({ name: 'Same', createdAt: '2026-03-01T00:00:00.000Z' })
  const b = sampleMonthly({ name: ' same ', createdAt: '2026-03-02T00:00:00.000Z' })
  const cat = { ...emptyCatalogue(), providers: { [a.id]: a, [b.id]: b } }
  assert.deepEqual(nameConflicts(cat), [b.id])
  cat.providers[a.id] = { ...a, createdAt: '2026-03-03T00:00:00.000Z' }
  assert.deepEqual(nameConflicts(cat), [a.id])
  const tie = { ...emptyCatalogue(), providers: { [a.id]: { ...a, createdAt: b.createdAt }, [b.id]: b } }
  assert.deepEqual(nameConflicts(tie), [b.id < a.id ? a.id : b.id])
  assert.deepEqual(nameConflicts({ ...cat, providers: { [a.id]: a, [b.id]: tomb(b) } }), [])
})
