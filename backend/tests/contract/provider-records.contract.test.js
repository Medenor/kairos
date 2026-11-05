import test from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from '../helpers/test-app.js'
import { ORDER_KEY, providerKey, toTombstone } from '../../../src/providers/records.js'
import { MONTHLY_ID, WEEKLY_ID, sampleMonthly, sampleWeekly } from '../../../src/providers/fixtures/sampleProviders.js'

// Characterisation of the existing shared-record API for the provider catalogue (feature 007): a provider
// is a `routing_config` record `provider:{id}` (a tombstone on deletion) and the display order is one
// `catalogue-order` record. No backend change is expected; these tests document behaviour that exists.

const ORDER_PAYLOAD = { schemaVersion: 1, ids: [WEEKLY_ID, MONTHLY_ID], updatedAt: '2026-03-04T10:00:00.000Z' }

function client(tctx, token) {
  const base = `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}`
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const json = async (response) => ({ status: response.status, body: response.status === 204 ? null : await response.json() })
  return {
    create: (recordType, logicalKey, payload) =>
      fetch(`${base}/records`, { method: 'POST', headers, body: JSON.stringify({ record_type: recordType, logical_key: logicalKey, payload }) }).then(json),
    update: (recordId, expectedVersion, payload) =>
      fetch(`${base}/records/${recordId}`, { method: 'PUT', headers, body: JSON.stringify({ expected_version: expectedVersion, payload }) }).then(json),
    list: () => fetch(`${base}/records`, { headers }).then(json),
    pull: (cursor) => fetch(`${base}/sync/pull${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { headers }).then(json),
    backup: () => fetch(`${base}/backups`, { method: 'POST', headers: { authorization: headers.authorization } }).then(json),
    restore: (id) => fetch(`${base}/backups/${id}/restore`, { method: 'POST', headers: { authorization: headers.authorization } }).then(json),
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('contract: provider and order records support create, versioned update, 409 and a tombstone PUT', async () => {
  const tctx = await startTestApp()
  try {
    const api = client(tctx, await tctx.login())
    const provider = sampleWeekly()

    const created = await api.create('routing_config', providerKey(WEEKLY_ID), provider)
    assert.equal(created.status, 201)
    assert.equal(created.body.record_type, 'routing_config')
    assert.equal(created.body.version, 1)
    assert.deepEqual(created.body.payload, provider)

    const order = await api.create('routing_config', ORDER_KEY, ORDER_PAYLOAD)
    assert.equal(order.status, 201)

    const edited = await api.update(created.body.id, 1, { ...provider, name: 'Renamed' })
    assert.equal(edited.status, 200)
    assert.equal(edited.body.version, 2)

    const stale = await api.update(created.body.id, 1, { ...provider, name: 'Stale' })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.error.code, 'VERSION_CONFLICT')
    assert.equal(stale.body.error.details.server_record.payload.name, 'Renamed')

    // Deletion is an ordinary versioned PUT of a tombstone: the record stays, so a stale device cannot resurrect it.
    const tombstone = toTombstone({ ...provider, name: 'Renamed' }, '2026-03-05T10:00:00.000Z')
    const removed = await api.update(created.body.id, 2, tombstone)
    assert.equal(removed.status, 200)
    assert.equal(removed.body.version, 3)
    assert.deepEqual(removed.body.payload, tombstone)
    const staleRevive = await api.update(created.body.id, 2, provider)
    assert.equal(staleRevive.status, 409)
    assert.equal(staleRevive.body.error.details.server_record.payload.status, 'removed')

    const listed = await api.list()
    assert.ok(listed.body.items.some((item) => item.logical_key === providerKey(WEEKLY_ID) && item.payload.status === 'removed'))
  } finally {
    await tctx.stop()
  }
})

test('contract: sync/pull lists provider records after a cursor', async () => {
  const tctx = await startTestApp()
  try {
    const api = client(tctx, await tctx.login())
    const first = await api.create('routing_config', providerKey(WEEKLY_ID), sampleWeekly())
    const initial = await api.pull()
    assert.ok(initial.body.items.some((item) => item.logical_key === providerKey(WEEKLY_ID)))
    await sleep(15)
    await api.create('routing_config', providerKey(MONTHLY_ID), sampleMonthly())
    const incremental = await api.pull(initial.body.next_cursor)
    assert.deepEqual(incremental.body.items.map((item) => item.logical_key), [providerKey(MONTHLY_ID)])
    assert.ok(first.body.id)
  } finally {
    await tctx.stop()
  }
})

test('contract: backup, mutate, restore returns the same provider records and leaves other record types untouched', async () => {
  const tctx = await startTestApp()
  try {
    const api = client(tctx, await tctx.login())
    const weekly = await api.create('routing_config', providerKey(WEEKLY_ID), sampleWeekly())
    await api.create('routing_config', providerKey(MONTHLY_ID), sampleMonthly())
    await api.create('routing_config', ORDER_KEY, ORDER_PAYLOAD)
    await api.create('quota_state', `${WEEKLY_ID}:q_weekly22`, { value: 40 })
    await api.create('snapshot', 'weekly-history:2026-W10', { schemaVersion: 2, workspaceId: tctx.workspaceId, weekKey: '2026-W10' })
    await api.create('routing_config', 'idea:i-1', { id: 'i-1', text: 'Refactor parser', status: 'waiting' })

    const before = (await api.list()).body.items
    const keyed = (items) => Object.fromEntries(items.map((item) => [item.logical_key, item.payload]))
    const expected = keyed(before)

    const backup = await api.backup()
    assert.ok(backup.body.id)

    await api.update(weekly.body.id, 1, toTombstone(sampleWeekly(), '2026-03-06T00:00:00.000Z'))
    const mutated = keyed((await api.list()).body.items)
    assert.equal(mutated[providerKey(WEEKLY_ID)].status, 'removed')

    const restored = await api.restore(backup.body.id)
    assert.equal(restored.status, 202)
    const after = keyed((await api.list()).body.items)
    assert.deepEqual(after[providerKey(WEEKLY_ID)], expected[providerKey(WEEKLY_ID)])
    assert.deepEqual(after[providerKey(MONTHLY_ID)], expected[providerKey(MONTHLY_ID)])
    assert.deepEqual(after[ORDER_KEY], expected[ORDER_KEY])
    for (const key of [`${WEEKLY_ID}:q_weekly22`, 'weekly-history:2026-W10', 'idea:i-1']) {
      assert.deepEqual(after[key], expected[key], `${key} is untouched`)
    }
  } finally {
    await tctx.stop()
  }
})
