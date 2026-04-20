import test from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from '../helpers/test-app.js'

test('us2: migration imports valid records and reports counters', async () => {
  const tctx = await startTestApp()
  try {
    const token = await tctx.login()
    const response = await fetch(
      `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/migrations/local-storage`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'Idempotency-Key': 'migration-success-1',
        },
        body: JSON.stringify({
          source_device_id: 'device-a',
          exported_at: new Date().toISOString(),
          records: [
            { logical_key: 'quota.openai', record_type: 'quota_state', payload: { remaining: 20 } },
            { logical_key: 'routing.default', record_type: 'routing_config', payload: { provider: 'openai' } },
          ],
        }),
      }
    )
    assert.equal(response.status, 202)
    const job = await response.json()
    assert.equal(job.total_records, 2)
    assert.equal(job.migrated_records, 2)
    assert.equal(job.failed_records, 0)
  } finally {
    await tctx.stop()
  }
})
