import test from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from '../helpers/test-app.js'

test('us3: denies access without valid session', async () => {
  const tctx = await startTestApp()
  try {
    const response = await fetch(`${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/records`)
    assert.equal(response.status, 401)
  } finally {
    await tctx.stop()
  }
})
