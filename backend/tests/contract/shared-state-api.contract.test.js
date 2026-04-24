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

test('contract: snapshot records are accepted and remain separate from quota_state records', async () => {
  const tctx = await startTestApp()
  try {
    const token = await tctx.login()

    const snapshotResponse = await fetch(
      `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/records`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          record_type: 'snapshot',
          logical_key: 'weekly-history:2026-W17',
          payload: {
            schemaVersion: 1,
            workspaceId: tctx.workspaceId,
            weekKey: '2026-W17',
            weekStartDate: '2026-04-20',
            weekEndDate: '2026-04-26',
            capturedAt: '2026-04-24T12:00:00.000Z',
            services: {},
          },
        }),
      }
    )
    assert.equal(snapshotResponse.status, 201)
    const snapshot = await snapshotResponse.json()
    assert.equal(snapshot.record_type, 'snapshot')
    assert.equal(snapshot.logical_key, 'weekly-history:2026-W17')

    const pullResponse = await fetch(
      `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/sync/pull`,
      {
        headers: { authorization: `Bearer ${token}` },
      }
    )
    assert.equal(pullResponse.status, 200)
    const pullBody = await pullResponse.json()
    const snapshotItem = pullBody.items.find((item) => item.logical_key === 'weekly-history:2026-W17')
    assert.ok(snapshotItem)
    assert.equal(snapshotItem.record_type, 'snapshot')

    const listResponse = await fetch(
      `${tctx.baseUrl}/api/v1/workspaces/${tctx.workspaceId}/records`,
      {
        headers: { authorization: `Bearer ${token}` },
      }
    )
    assert.equal(listResponse.status, 200)
    const listBody = await listResponse.json()
    assert.ok(listBody.items.some((item) => item.record_type === 'snapshot'))
  } finally {
    await tctx.stop()
  }
})
