import test from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from '../helpers/test-app.js'

test('contract: backup create/list/restore endpoints', async () => {
  const tctx = await startTestApp()
  try {
    const token = await tctx.login()
    const createResponse = await fetch(
      `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/backups`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }
    )
    assert.equal(createResponse.status, 202)
    const created = await createResponse.json()
    assert.ok(created.id)

    const listResponse = await fetch(`${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/backups`, {
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(listResponse.status, 200)
    const listed = await listResponse.json()
    assert.ok(Array.isArray(listed.items))
    assert.ok(listed.items.length >= 1)

    const restoreResponse = await fetch(
      `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/backups/${created.id}/restore`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }
    )
    assert.equal(restoreResponse.status, 202)
  } finally {
    await tctx.stop()
  }
})
