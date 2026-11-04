import test from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from '../helpers/test-app.js'

test('us3: backup then restore after destructive change', async () => {
  const tctx = await startTestApp()
  try {
    const token = await tctx.login()
    const createRecord = await fetch(`${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/records`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        record_type: 'snapshot',
        logical_key: 'restore-target',
        payload: { value: 1 },
      }),
    })
    assert.equal(createRecord.status, 201)

    const backup = await fetch(`${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/backups`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    const snapshot = await backup.json()

    // Destructive change: hard delete rows for test simulation.
    tctx.app.db.exec(`DELETE FROM shared_records WHERE workspace_id='${tctx.workspaceId}';`)

    const restore = await fetch(
      `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/backups/${snapshot.id}/restore`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }
    )
    assert.equal(restore.status, 202)

    const list = await fetch(`${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/records`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const body = await list.json()
    assert.ok(body.items.some((it) => it.logical_key === 'restore-target'))
  } finally {
    await tctx.stop()
  }
})

test('us3: provider definitions, readings and the weekly snapshot are backed up and restored together (feature 007, SC-008)', async () => {
  const tctx = await startTestApp()
  try {
    const token = await tctx.login()
    const base = `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}`
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const create = async (record_type, logical_key, payload) => {
      const response = await fetch(`${base}/records`, { method: 'POST', headers, body: JSON.stringify({ record_type, logical_key, payload }) })
      assert.equal(response.status, 201, logical_key)
    }
    const providerId = 'p_backupaaaaaa'
    const definition = { schemaVersion: 1, id: providerId, status: 'active', name: 'Backed up', quotas: [{ id: 'q_weekly22', label: 'Weekly', type: 'consumed_pct' }] }
    await create('routing_config', `provider:${providerId}`, definition)
    await create('routing_config', 'catalogue-order', { schemaVersion: 1, ids: [providerId], updatedAt: '2026-03-04T10:00:00.000Z' })
    await create('quota_state', `${providerId}:q_weekly22`, { value: 42 })
    await create('snapshot', 'weekly-history:2026-W10', { schemaVersion: 2, weekKey: '2026-W10', providers: { [providerId]: { providerId, name: 'Backed up' } } })

    const backup = await (await fetch(`${base}/backups`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })).json()
    tctx.app.db.exec(`DELETE FROM shared_records WHERE workspace_id='${tctx.workspaceId}';`)
    const restore = await fetch(`${base}/backups/${backup.id}/restore`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })
    assert.equal(restore.status, 202)

    const items = (await (await fetch(`${base}/records`, { headers })).json()).items
    const byKey = Object.fromEntries(items.map((item) => [item.logical_key, item.payload]))
    assert.deepEqual(byKey[`provider:${providerId}`], definition)
    assert.deepEqual(byKey['catalogue-order'].ids, [providerId])
    assert.deepEqual(byKey[`${providerId}:q_weekly22`], { value: 42 })
    assert.equal(byKey['weekly-history:2026-W10'].providers[providerId].name, 'Backed up')
  } finally {
    await tctx.stop()
  }
})
