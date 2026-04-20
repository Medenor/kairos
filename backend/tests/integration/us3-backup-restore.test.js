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
