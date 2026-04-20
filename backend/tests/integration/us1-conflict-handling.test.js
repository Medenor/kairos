import test from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from '../helpers/test-app.js'

test('us1: update with stale expected_version returns 409', async () => {
  const tctx = await startTestApp()
  try {
    const token = await tctx.login()

    const create = await fetch(`${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/records`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        record_type: 'quota_state',
        logical_key: 'anthropic-credits',
        payload: { remaining: 20 },
      }),
    })
    const created = await create.json()

    const update1 = await fetch(
      `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/records/${created.id}`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          expected_version: 1,
          payload: { remaining: 10 },
        }),
      }
    )
    assert.equal(update1.status, 200)

    const updateConflict = await fetch(
      `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/records/${created.id}`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          expected_version: 1,
          payload: { remaining: 5 },
        }),
      }
    )
    assert.equal(updateConflict.status, 409)
    const conflictBody = await updateConflict.json()
    assert.equal(conflictBody.error.code, 'VERSION_CONFLICT')
  } finally {
    await tctx.stop()
  }
})
