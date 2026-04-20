import test from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from '../helpers/test-app.js'

test('us1: records propagate across clients via shared backend', async () => {
  const tctx = await startTestApp()
  try {
    const tokenA = await tctx.login()
    const tokenB = await tctx.login()

    const create = await fetch(`${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/records`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokenA}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        record_type: 'routing_config',
        logical_key: 'default-route',
        payload: { provider: 'openai' },
      }),
    })
    assert.equal(create.status, 201)

    const list = await fetch(`${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/records`, {
      headers: { authorization: `Bearer ${tokenB}` },
    })
    assert.equal(list.status, 200)
    const body = await list.json()
    assert.ok(body.items.some((it) => it.logical_key === 'default-route'))
  } finally {
    await tctx.stop()
  }
})
