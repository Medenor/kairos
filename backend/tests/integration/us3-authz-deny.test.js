import test from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from '../helpers/test-app.js'

test('us3: local-trust mode allows workspace reads without session token', async () => {
  const tctx = await startTestApp()
  try {
    const response = await fetch(`${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/records`)
    assert.equal(response.status, 200)
  } finally {
    await tctx.stop()
  }
})
