import test from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from '../helpers/test-app.js'

test('quickstart e2e: auth -> migrate -> sync -> backup/restore', async () => {
  const tctx = await startTestApp()
  try {
    const tokenA = await tctx.login()
    const tokenB = await tctx.login()

    const migrate = await fetch(
      `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/migrations/local-storage`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'content-type': 'application/json',
          'Idempotency-Key': 'quickstart-migrate-1',
        },
        body: JSON.stringify({
          source_device_id: 'device-a',
          exported_at: new Date().toISOString(),
          records: [
            {
              logical_key: 'quickstart-quota',
              record_type: 'quota_state',
              payload: { remaining: 7 },
            },
          ],
        }),
      }
    )
    assert.equal(migrate.status, 202)

    const sync = await fetch(`${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/sync/pull`, {
      headers: { authorization: `Bearer ${tokenB}` },
    })
    const syncBody = await sync.json()
    assert.ok(syncBody.items.some((it) => it.logical_key === 'quickstart-quota'))

    const backup = await fetch(`${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/backups`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenA}` },
    })
    assert.equal(backup.status, 202)
  } finally {
    await tctx.stop()
  }
})
