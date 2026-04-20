import test from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from '../helpers/test-app.js'

test('us2: migration idempotency key returns same job and avoids duplicates', async () => {
  const tctx = await startTestApp()
  try {
    const token = await tctx.login()
    const key = 'idem-001'
    const payload = {
      source_device_id: 'device-a',
      exported_at: new Date().toISOString(),
      records: [
        { logical_key: 'quota.gemini', record_type: 'quota_state', payload: { remaining: 50 } },
        { record_type: 'quota_state', payload: { bad: true } },
      ],
    }

    const first = await fetch(
      `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/migrations/local-storage`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(payload),
      }
    )
    const firstJob = await first.json()

    const second = await fetch(
      `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/migrations/local-storage`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(payload),
      }
    )
    const secondJob = await second.json()

    assert.equal(firstJob.id, secondJob.id)

    const list = await fetch(`${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/records`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const listBody = await list.json()
    const matching = listBody.items.filter((it) => it.logical_key === 'quota.gemini')
    assert.equal(matching.length, 1)
  } finally {
    await tctx.stop()
  }
})
