import test from 'node:test'
import assert from 'node:assert/strict'
import { createApiClient, ApiClientError, isVersionConflict, isDuplicateKey } from './api-client.js'
import { start } from './fixtures/fake-api.js'

async function withApi(fn, options) {
  const api = await start(options)
  try {
    await fn(api, createApiClient({ apiBase: api.url, workspaceId: api.workspaceId, timeoutMs: 2000 }))
  } finally {
    await api.close()
  }
}

test('create then list returns the record with version 1', () =>
  withApi(async (_api, client) => {
    const created = await client.createRecord({ logicalKey: 'idea:i-1', payload: { text: 'a' } })
    assert.equal(created.version, 1)
    assert.equal(created.record_type, 'routing_config')
    const { items } = await client.listRecords()
    assert.deepEqual(items.map((r) => r.logical_key), ['idea:i-1'])
    assert.deepEqual(items[0].payload, { text: 'a' })
  }))

test('update with the right expected_version bumps the version', () =>
  withApi(async (_api, client) => {
    const created = await client.createRecord({ logicalKey: 'run:r-1', payload: { status: 'running' } })
    const updated = await client.updateRecord(created.id, { expectedVersion: 1, payload: { status: 'completed' } })
    assert.equal(updated.version, 2)
    assert.equal(updated.payload.status, 'completed')
  }))

test('stale expected_version is a conflict that carries the server record', () =>
  withApi(async (api, client) => {
    const created = await client.createRecord({ logicalKey: 'idea:i-1', payload: { status: 'waiting' } })
    api.put('idea:i-1', { status: 'archived' })
    await assert.rejects(
      () => client.updateRecord(created.id, { expectedVersion: 1, payload: { status: 'running' } }),
      (error) => {
        assert.ok(error instanceof ApiClientError)
        assert.equal(error.kind, 'conflict')
        assert.equal(error.status, 409)
        assert.equal(isVersionConflict(error), true)
        assert.equal(error.serverRecord.version, 2)
        assert.equal(error.serverRecord.payload.status, 'archived')
        return true
      },
    )
    assert.equal(api.find('idea:i-1').payload.status, 'archived')
  }))

test('creating an existing logical key is a duplicate conflict', () =>
  withApi(async (_api, client) => {
    await client.createRecord({ logicalKey: 'runner-lease', payload: {} })
    await assert.rejects(
      () => client.createRecord({ logicalKey: 'runner-lease', payload: {} }),
      (error) => isDuplicateKey(error) && !isVersionConflict(error),
    )
  }))

test('pull returns only records changed after the cursor', () =>
  withApi(async (api, client) => {
    api.seed('idea:old', { n: 1 })
    const first = await client.pull()
    assert.equal(first.items.length, 1)
    assert.ok(first.next_cursor)
    api.put('idea:new', { n: 2 })
    const second = await client.pull({ cursor: first.next_cursor })
    assert.deepEqual(second.items.map((r) => r.logical_key), ['idea:new'])
    const listed = await client.listRecords({ since: first.next_cursor })
    assert.deepEqual(listed.items.map((r) => r.logical_key), ['idea:new'])
    const empty = await client.pull({ cursor: second.next_cursor })
    assert.deepEqual(empty.items, [])
  }))

test('getByKey finds a record or returns null; deleted records disappear', () =>
  withApi(async (_api, client) => {
    assert.equal(await client.getByKey('surplus-control'), null)
    const created = await client.createRecord({ logicalKey: 'surplus-control', payload: { autoRunEnabled: true } })
    assert.equal((await client.getByKey('surplus-control')).id, created.id)
    assert.equal(await client.deleteRecord(created.id), null)
    assert.equal(await client.getByKey('surplus-control'), null)
  }))

test('updating an unknown record is not_found', () =>
  withApi(async (_api, client) => {
    await assert.rejects(
      () => client.updateRecord('missing', { expectedVersion: 1, payload: {} }),
      (error) => error.kind === 'not_found' && error.status === 404,
    )
  }))

test('server errors surface as http errors with status and code', () =>
  withApi(async (api, client) => {
    api.failNext(503, { code: 'UNAVAILABLE', message: 'down' })
    await assert.rejects(
      () => client.listRecords(),
      (error) => error.kind === 'http' && error.status === 503 && error.code === 'UNAVAILABLE' && error.message === 'down',
    )
    assert.deepEqual((await client.listRecords()).items, [])
  }))

test('a slow server triggers the request timeout', async () => {
  const api = await start()
  try {
    api.setDelay(400)
    const client = createApiClient({ apiBase: api.url, workspaceId: api.workspaceId, timeoutMs: 50 })
    await assert.rejects(() => client.listRecords(), (error) => error.kind === 'timeout')
  } finally {
    api.setDelay(0)
    await api.close()
  }
})

test('an unreachable server is a network error', async () => {
  const api = await start()
  const { url, workspaceId } = api
  await api.close()
  const client = createApiClient({ apiBase: url, workspaceId, timeoutMs: 500 })
  await assert.rejects(() => client.listRecords(), (error) => error.kind === 'network')
})

test('no credentials are sent: no authorization, cookie or api key header', () =>
  withApi(async (api, client) => {
    await client.createRecord({ logicalKey: 'idea:i-1', payload: {} })
    await client.listRecords()
    await client.pull()
    assert.equal(api.requests.length, 3)
    for (const { headers } of api.requests) {
      for (const name of Object.keys(headers)) {
        assert.doesNotMatch(name, /^(authorization|cookie|proxy-authorization|x-api-key)$/i)
      }
    }
  }))

test('request bodies use the backend field names', () =>
  withApi(async (api, client) => {
    const created = await client.createRecord({ logicalKey: 'idea:i-1', payload: { a: 1 } })
    await client.updateRecord(created.id, { expectedVersion: 1, payload: { a: 2 } })
    assert.deepEqual(api.requests[0].body, { record_type: 'routing_config', logical_key: 'idea:i-1', payload: { a: 1 } })
    assert.deepEqual(api.requests[1].body, { expected_version: 1, payload: { a: 2 } })
    assert.equal(api.requests[1].method, 'PUT')
  }))

test('constructor validates its arguments', () => {
  assert.throws(() => createApiClient({ apiBase: 'not a url', workspaceId: 'w' }), TypeError)
  assert.throws(() => createApiClient({ apiBase: 'ftp://host/x', workspaceId: 'w' }), TypeError)
  assert.throws(() => createApiClient({ apiBase: 'http://host/api/v1', workspaceId: '' }), TypeError)
  assert.throws(() => createApiClient({ apiBase: 'http://host/api/v1', workspaceId: 'w', timeoutMs: 0 }), TypeError)
})
