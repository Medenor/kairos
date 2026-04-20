import test from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from '../helpers/test-app.js'

const payload = {
  source_device_id: 'device-a',
  exported_at: new Date().toISOString(),
  records: [
    {
      logical_key: 'openai.gpt5',
      record_type: 'quota_state',
      payload: { remaining: 12 },
    },
  ],
}

test('contract: migration start + status retrieval', async () => {
  const tctx = await startTestApp()
  try {
    const token = await tctx.login()
    const startResponse = await fetch(
      `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/migrations/local-storage`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'Idempotency-Key': 'migration-contract-1',
        },
        body: JSON.stringify(payload),
      }
    )
    assert.equal(startResponse.status, 202)
    const started = await startResponse.json()
    assert.ok(started.id)
    assert.ok(started.status)

    const statusResponse = await fetch(
      `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/migrations/${started.id}`,
      {
        headers: { authorization: `Bearer ${token}` },
      }
    )
    assert.equal(statusResponse.status, 200)
    const status = await statusResponse.json()
    assert.equal(status.id, started.id)
  } finally {
    await tctx.stop()
  }
})
