import test from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from '../helpers/test-app.js'

test('contract: login + records + sync pull', async () => {
  const tctx = await startTestApp()
  try {
    const token = await tctx.login()
    assert.ok(token)

    const createResponse = await fetch(
      `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/records`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          record_type: 'quota_state',
          logical_key: 'openai.gpt5',
          payload: { remaining: 42 },
        }),
      }
    )
    assert.equal(createResponse.status, 201)
    const created = await createResponse.json()
    assert.equal(created.logical_key, 'openai.gpt5')
    assert.equal(created.version, 1)

    const pullResponse = await fetch(
      `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/sync/pull`,
      {
        headers: { authorization: `Bearer ${token}` },
      }
    )
    assert.equal(pullResponse.status, 200)
    const pullBody = await pullResponse.json()
    assert.ok(Array.isArray(pullBody.items))
    assert.ok(pullBody.next_cursor)
  } finally {
    await tctx.stop()
  }
})
