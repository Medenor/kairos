// Test-only in-memory stand-in for the shared-state backend: versions, 409 with the server record,
// soft delete, duplicate logical keys, and a pull that never returns deleted records.
export function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  }
}

export function fakeServer({ failWith = null } = {}) {
  const records = new Map()
  let seq = 0
  let tickMs = 0
  const calls = []
  const control = { failWith }
  const stamp = () => new Date(Date.parse('2026-11-03T09:00:00.000Z') + (tickMs += 1000)).toISOString()
  const err = (status, message, details) => Object.assign(new Error(message), { status, details })
  const guard = () => {
    if (control.failWith) throw control.failWith
  }
  const api = {
    async createRecord(ws, body) {
      guard()
      calls.push(['create', body.logical_key])
      if ([...records.values()].some((r) => r.logical_key === body.logical_key)) throw err(409, 'dup')
      seq += 1
      const rec = { id: `rec-${seq}`, workspace_id: ws, record_type: body.record_type, logical_key: body.logical_key, payload: body.payload, version: 1, updated_at: stamp(), deleted_at: null }
      records.set(rec.id, rec)
      return structuredClone(rec)
    },
    async updateRecord(ws, id, body) {
      guard()
      calls.push(['update', records.get(id)?.logical_key, body.expected_version])
      const rec = records.get(id)
      if (!rec || rec.deleted_at) throw err(404, 'not found')
      if (rec.version !== body.expected_version) throw err(409, 'conflict', { server_record: structuredClone(rec) })
      Object.assign(rec, { payload: body.payload, version: rec.version + 1, updated_at: stamp() })
      return structuredClone(rec)
    },
    async deleteRecord(ws, id) {
      guard()
      calls.push(['delete', records.get(id)?.logical_key])
      records.get(id).deleted_at = stamp()
    },
    async syncPull(ws, cursor) {
      guard()
      calls.push(['pull', cursor])
      const items = [...records.values()].filter((r) => !r.deleted_at && (!cursor || r.updated_at > cursor))
      return { items: structuredClone(items), next_cursor: items.length ? items[items.length - 1].updated_at : cursor }
    },
  }
  const put = (logicalKey, payload, extra = {}) => {
    seq += 1
    const rec = { id: `rec-${seq}`, workspace_id: 'ws', record_type: 'routing_config', logical_key: logicalKey, payload, version: 1, updated_at: stamp(), deleted_at: null, ...extra }
    records.set(rec.id, rec)
    return rec
  }
  return { api, records, calls, put, control, byKey: (k) => [...records.values()].find((r) => r.logical_key === k) }
}

// Manual timers: collect scheduled callbacks so a test fires the debounce deterministically.
export function manualTimers() {
  const timers = []
  return {
    timers,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length
    },
    clearTimer: (handle) => {
      if (timers[handle - 1]) timers[handle - 1].fn = null
    },
    fire() {
      for (const t of timers) if (t.fn) { const fn = t.fn; t.fn = null; fn() }
    },
  }
}
