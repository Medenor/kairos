import test from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from '../helpers/test-app.js'

// Characterisation of the existing shared-record API for the surplus-runner feature (006):
// every surplus kind is a `routing_config` record identified by a namespaced logical key.
// No backend change is expected; these tests document behaviour that already exists.

const NAMESPACE_KEYS = [
  ['surplus-policy', { schemaVersion: 1 }],
  ['surplus-control', { autoRunEnabled: true, updatedAt: '2026-11-03T10:00:00.000Z' }],
  ['idea:i-1', { id: 'i-1', text: 'Refactor parser', status: 'waiting' }],
  ['run:r-1', { id: 'r-1', ideaId: 'i-1', status: 'running' }],
  ['cycle:claude:2026-11-10', { serviceId: 'claude', resetDate: '2026-11-10', lastWeeklyRemainingPct: 40 }],
  ['runner-lease', { deviceId: 'd-1', heartbeatAt: '2026-11-03T10:00:00.000Z' }],
]

function client(tctx, token) {
  const base = `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}`
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const json = async (response) => ({
    status: response.status,
    body: response.status === 204 ? null : await response.json(),
  })
  return {
    create: (recordType, logicalKey, payload) =>
      fetch(`${base}/records`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ record_type: recordType, logical_key: logicalKey, payload }),
      }).then(json),
    update: (recordId, expectedVersion, payload) =>
      fetch(`${base}/records/${recordId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ expected_version: expectedVersion, payload }),
      }).then(json),
    remove: (recordId) => fetch(`${base}/records/${recordId}`, { method: 'DELETE', headers }).then(json),
    list: (since) =>
      fetch(`${base}/records${since ? `?since=${encodeURIComponent(since)}` : ''}`, { headers }).then(json),
    pull: (cursor) =>
      fetch(`${base}/sync/pull${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { headers }).then(json),
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

for (const [logicalKey, payload] of NAMESPACE_KEYS) {
  test(`contract: routing_config record "${logicalKey}" supports create, versioned update, 409 and soft-delete`, async () => {
    const tctx = await startTestApp()
    try {
      const api = client(tctx, await tctx.login())

      const created = await api.create('routing_config', logicalKey, payload)
      assert.equal(created.status, 201)
      assert.equal(created.body.record_type, 'routing_config')
      assert.equal(created.body.logical_key, logicalKey)
      assert.equal(created.body.version, 1)
      assert.deepEqual(created.body.payload, payload)

      const duplicate = await api.create('routing_config', logicalKey, payload)
      assert.equal(duplicate.status, 409)
      assert.equal(duplicate.body.error.code, 'DUPLICATE_LOGICAL_KEY')

      const updated = await api.update(created.body.id, 1, { ...payload, changed: true })
      assert.equal(updated.status, 200)
      assert.equal(updated.body.version, 2)
      assert.equal(updated.body.payload.changed, true)

      const stale = await api.update(created.body.id, 1, { ...payload, changed: 'stale' })
      assert.equal(stale.status, 409)
      assert.equal(stale.body.error.code, 'VERSION_CONFLICT')
      assert.equal(stale.body.error.details.server_record.version, 2)
      assert.equal(stale.body.error.details.server_record.payload.changed, true)

      const removed = await api.remove(created.body.id)
      assert.equal(removed.status, 204)
      const listed = await api.list()
      assert.equal(listed.body.items.some((item) => item.logical_key === logicalKey), false)
      const pulled = await api.pull()
      assert.equal(pulled.body.items.some((item) => item.logical_key === logicalKey), false)

      const afterDelete = await api.update(created.body.id, 2, payload)
      assert.equal(afterDelete.status, 404)
    } finally {
      await tctx.stop()
    }
  })
}

test('contract: list and sync pull with since/cursor return only newer routing_config records', async () => {
  const tctx = await startTestApp()
  try {
    const api = client(tctx, await tctx.login())

    const first = await api.create('routing_config', 'idea:a', { id: 'a' })
    assert.equal(first.status, 201)
    await sleep(15)
    const second = await api.create('routing_config', 'idea:b', { id: 'b' })
    assert.equal(second.status, 201)

    const all = await api.list()
    assert.deepEqual(all.body.items.map((item) => item.logical_key), ['idea:a', 'idea:b'])

    const since = await api.list(first.body.updated_at)
    assert.deepEqual(since.body.items.map((item) => item.logical_key), ['idea:b'])
    assert.equal(since.body.sync_cursor, second.body.updated_at)

    const pulled = await api.pull(first.body.updated_at)
    assert.deepEqual(pulled.body.items.map((item) => item.logical_key), ['idea:b'])
    assert.equal(pulled.body.next_cursor, second.body.updated_at)

    await sleep(15)
    const updated = await api.update(first.body.id, 1, { id: 'a', text: 'edited' })
    const nextPull = await api.pull(pulled.body.next_cursor)
    assert.deepEqual(nextPull.body.items.map((item) => item.logical_key), ['idea:a'])
    assert.equal(nextPull.body.items[0].version, updated.body.version)
  } finally {
    await tctx.stop()
  }
})

test('contract: surplus routing_config records leave quota_state and snapshot records untouched', async () => {
  const tctx = await startTestApp()
  try {
    const api = client(tctx, await tctx.login())

    const quota = await api.create('quota_state', 'claude:weekly', { value: 42 })
    const snapshot = await api.create('snapshot', 'weekly-history:2026-W44', { weekKey: '2026-W44', services: {} })
    assert.equal(quota.status, 201)
    assert.equal(snapshot.status, 201)

    // Same logical key in different record types never collides.
    const sameKeyOtherType = await api.create('routing_config', 'claude:weekly', { value: 'config' })
    assert.equal(sameKeyOtherType.status, 201)

    const surplus = []
    for (const [logicalKey, payload] of NAMESPACE_KEYS) {
      const created = await api.create('routing_config', logicalKey, payload)
      assert.equal(created.status, 201)
      surplus.push(created.body)
    }
    for (const record of surplus) {
      const updated = await api.update(record.id, 1, { ...record.payload, touched: true })
      assert.equal(updated.status, 200)
    }
    for (const record of surplus) {
      assert.equal((await api.remove(record.id)).status, 204)
    }

    const remaining = await api.list()
    const byKey = Object.fromEntries(remaining.body.items.map((item) => [`${item.record_type}/${item.logical_key}`, item]))
    assert.equal(byKey['quota_state/claude:weekly'].version, 1)
    assert.deepEqual(byKey['quota_state/claude:weekly'].payload, { value: 42 })
    assert.equal(byKey['snapshot/weekly-history:2026-W44'].version, 1)
    assert.deepEqual(byKey['snapshot/weekly-history:2026-W44'].payload, { weekKey: '2026-W44', services: {} })
    assert.deepEqual(byKey['routing_config/claude:weekly'].payload, { value: 'config' })
    assert.equal(
      remaining.body.items.some((item) => item.record_type === 'routing_config' && item.logical_key !== 'claude:weekly'),
      false
    )
    assert.equal(remaining.body.items.length, 3)
  } finally {
    await tctx.stop()
  }
})
