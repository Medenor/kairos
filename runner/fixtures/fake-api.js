// Test fixture: an in-memory stand-in for the shared-state records API (T040).
//
// Mirrors the backend routes and error envelope the runner uses (backend/src/api/routes/record-routes.js,
// sync-routes.js, services/shared-record-service.js):
//   GET    /api/v1/workspaces/:ws/records[?since=]    -> 200 { items, sync_cursor }
//   POST   /api/v1/workspaces/:ws/records              -> 201 record | 409 DUPLICATE_LOGICAL_KEY | 400
//   PUT    /api/v1/workspaces/:ws/records/:id          -> 200 record | 404 | 409 VERSION_CONFLICT (details.server_record)
//   DELETE /api/v1/workspaces/:ws/records/:id          -> 204 (soft delete)
//   GET    /api/v1/workspaces/:ws/sync/pull[?cursor=]  -> 200 { items, next_cursor }
// Records have { id, workspace_id, record_type, logical_key, payload, version, updated_at, updated_by_user_id }.
// `updated_at` is strictly increasing so cursors never tie.

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const RECORD_TYPES = ['quota_state', 'routing_config', 'snapshot']

function envelope(status, code, message, details = null) {
  return { status, body: { error: { code, message, details } } }
}

/**
 * Start the fake API on an ephemeral 127.0.0.1 port.
 * Options: workspaceId (default 'ws-test'), records (seed: [{ logicalKey, payload, recordType? }]),
 * now (() => Date, default real clock; used for `updated_at`).
 * Returns { url, workspaceId, close(), records, requests, seed(), find(), put(), failNext(), setDelay() }:
 *  - url        API base including the prefix, e.g. http://127.0.0.1:41234/api/v1
 *  - records    live Map id -> record (soft-deleted records have `deleted_at`)
 *  - requests   array of { method, path, query, headers, body } in arrival order
 *  - seed(logicalKey, payload, recordType)  create a record directly (no request logged); returns it
 *  - find(logicalKey)  the live record for a logical key or null
 *  - put(logicalKey, payload)  bump (or create) a record as "another client" would; returns it
 *  - failNext(status, { code, message, times })  next request(s) answer this error instead
 *  - setDelay(ms)  hold every response for ms (for timeout tests)
 */
export async function start({ workspaceId = 'ws-test', records: seedRecords = [], now = () => new Date() } = {}) {
  const records = new Map()
  const requests = []
  let lastStamp = 0
  let delayMs = 0
  let forced = null

  const stamp = () => {
    lastStamp = Math.max(now().getTime(), lastStamp + 1)
    return new Date(lastStamp).toISOString()
  }
  const live = () => [...records.values()].filter((r) => !r.deleted_at)
  const findLive = (logicalKey, recordType = 'routing_config') =>
    live().find((r) => r.logical_key === logicalKey && r.record_type === recordType) ?? null

  function insert(logicalKey, payload, recordType = 'routing_config') {
    const record = {
      id: randomUUID(),
      workspace_id: workspaceId,
      record_type: recordType,
      logical_key: logicalKey,
      payload,
      version: 1,
      updated_by_user_id: 'fake-user',
      updated_at: stamp(),
      deleted_at: null,
    }
    records.set(record.id, record)
    return record
  }
  const view = ({ deleted_at: _deleted, ...record }) => structuredClone(record)

  for (const seed of seedRecords) insert(seed.logicalKey, seed.payload, seed.recordType)

  function itemsSince(since) {
    return live()
      .filter((r) => !since || r.updated_at > since)
      .sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1))
      .map(view)
  }

  function route(method, segments, url, body) {
    // segments: ['api','v1','workspaces',ws,...]
    if (segments[0] !== 'api' || segments[1] !== 'v1' || segments[2] !== 'workspaces') {
      return envelope(404, 'NOT_FOUND', 'Route not found')
    }
    if (segments[3] !== workspaceId) return envelope(404, 'NOT_FOUND', 'Workspace not found')
    const [, , , , area, recordId, extra] = segments

    if (area === 'sync' && recordId === 'pull' && method === 'GET') {
      const items = itemsSince(url.searchParams.get('cursor'))
      return { status: 200, body: { items, next_cursor: items.length ? items[items.length - 1].updated_at : new Date().toISOString() } }
    }
    if (area !== 'records' || extra !== undefined) return envelope(404, 'NOT_FOUND', 'Route not found')

    if (method === 'GET' && recordId === undefined) {
      const items = itemsSince(url.searchParams.get('since'))
      return { status: 200, body: { items, sync_cursor: items.length ? items[items.length - 1].updated_at : new Date().toISOString() } }
    }
    if (method === 'POST' && recordId === undefined) {
      for (const field of ['record_type', 'logical_key', 'payload']) {
        if (body?.[field] === undefined || body[field] === null || body[field] === '') {
          return envelope(400, 'VALIDATION_ERROR', `Missing required field: ${field}`)
        }
      }
      if (!RECORD_TYPES.includes(body.record_type)) return envelope(400, 'VALIDATION_ERROR', 'Invalid record_type')
      if (findLive(body.logical_key, body.record_type)) {
        return envelope(409, 'DUPLICATE_LOGICAL_KEY', 'A record with this logical key already exists')
      }
      return { status: 201, body: view(insert(body.logical_key, body.payload, body.record_type)) }
    }
    if (method === 'PUT' && recordId !== undefined) {
      for (const field of ['expected_version', 'payload']) {
        if (body?.[field] === undefined || body[field] === null || body[field] === '') {
          return envelope(400, 'VALIDATION_ERROR', `Missing required field: ${field}`)
        }
      }
      const existing = records.get(recordId)
      if (!existing || existing.deleted_at) return envelope(404, 'NOT_FOUND', 'Record not found')
      if (Number(existing.version) !== Number(body.expected_version)) {
        return envelope(409, 'VERSION_CONFLICT', 'Record version mismatch', { server_record: view(existing) })
      }
      existing.payload = body.payload
      existing.version += 1
      existing.updated_at = stamp()
      return { status: 200, body: view(existing) }
    }
    if (method === 'DELETE' && recordId !== undefined) {
      const existing = records.get(recordId)
      if (existing) existing.deleted_at = stamp()
      return { status: 204, body: null }
    }
    return envelope(404, 'NOT_FOUND', 'Route not found')
  }

  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const url = new URL(req.url, 'http://fake.local')
      let body
      const raw = Buffer.concat(chunks).toString('utf8')
      let parseError = false
      if (raw) {
        try {
          body = JSON.parse(raw)
        } catch {
          parseError = true
        }
      }
      requests.push({
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: { ...req.headers },
        body,
      })

      const reply = () => {
        let out
        if (forced && forced.times > 0) {
          forced.times -= 1
          out = envelope(forced.status, forced.code, forced.message)
          if (forced.times === 0) forced = null
        } else if (parseError) {
          out = envelope(400, 'INVALID_JSON', 'Body must be valid JSON')
        } else {
          out = route(req.method, url.pathname.split('/').filter(Boolean), url, body)
        }
        if (out.body === null) {
          res.writeHead(out.status)
          res.end()
        } else {
          res.writeHead(out.status, { 'content-type': 'application/json' })
          res.end(JSON.stringify(out.body))
        }
      }
      if (delayMs > 0) setTimeout(reply, delayMs)
      else reply()
    })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  return {
    url: `http://127.0.0.1:${port}/api/v1`,
    workspaceId,
    records,
    requests,
    seed: (logicalKey, payload, recordType) => view(insert(logicalKey, payload, recordType)),
    find: (logicalKey, recordType) => {
      const record = findLive(logicalKey, recordType)
      return record ? view(record) : null
    },
    put(logicalKey, payload) {
      const existing = findLive(logicalKey)
      if (!existing) return view(insert(logicalKey, payload))
      existing.payload = payload
      existing.version += 1
      existing.updated_at = stamp()
      return view(existing)
    },
    failNext(status, { code = 'INTERNAL_ERROR', message = 'Injected failure', times = 1 } = {}) {
      forced = { status, code, message, times }
    },
    setDelay(ms) {
      delayMs = ms
    },
    close() {
      server.closeAllConnections?.()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}
