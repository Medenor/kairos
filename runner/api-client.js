// Minimal client for the shared-state records API (T050). Node built-ins only (global fetch).
// Sends no credentials (no Authorization header, no cookies) and stores nothing: the backend is
// trusted-LAN and unauthenticated today, and the runner never handles tokens (FR-015).

export const DEFAULT_TIMEOUT_MS = 10_000
export const RECORD_TYPE = 'routing_config'

/**
 * Error thrown for every failed call.
 * kind: 'conflict' (409; `code` is VERSION_CONFLICT or DUPLICATE_LOGICAL_KEY; `serverRecord` is set for
 * VERSION_CONFLICT), 'not_found' (404), 'http' (any other non-2xx), 'timeout', 'network'.
 */
export class ApiClientError extends Error {
  constructor(kind, message, { status = null, code = null, details = null, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'ApiClientError'
    this.kind = kind
    this.status = status
    this.code = code
    this.details = details
    this.serverRecord = details?.server_record ?? null
  }
}

export const isVersionConflict = (error) => error instanceof ApiClientError && error.kind === 'conflict' && error.code === 'VERSION_CONFLICT'
export const isDuplicateKey = (error) => error instanceof ApiClientError && error.kind === 'conflict' && error.code === 'DUPLICATE_LOGICAL_KEY'

function normalizeBase(apiBase) {
  let url
  try {
    url = new URL(String(apiBase))
  } catch {
    throw new TypeError('apiBase must be an http(s) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('apiBase must be an http(s) URL')
  return url.toString().replace(/\/+$/, '')
}

/**
 * createApiClient({ apiBase, workspaceId, timeoutMs?, fetchImpl? }) -> client
 *
 * `apiBase` includes the prefix, e.g. `http://192.168.1.10:8888/api/v1`. All methods return the backend's
 * JSON (snake_case record fields: id, record_type, logical_key, payload, version, updated_at) and throw
 * ApiClientError on failure; none retries.
 *
 *   listRecords({ since? })                 -> { items, sync_cursor }
 *   pull({ cursor? })                       -> { items, next_cursor }      (sync/pull)
 *   createRecord({ logicalKey, payload, recordType? = 'routing_config' }) -> record   (409 DUPLICATE_LOGICAL_KEY)
 *   updateRecord(recordId, { expectedVersion, payload }) -> record          (409 VERSION_CONFLICT, error.serverRecord)
 *   deleteRecord(recordId)                  -> null
 *   getByKey(logicalKey)                    -> record | null               (list + filter; routing_config only)
 */
export function createApiClient({ apiBase, workspaceId, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  if (!workspaceId || typeof workspaceId !== 'string') throw new TypeError('workspaceId is required')
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive number')
  const base = normalizeBase(apiBase)
  const root = `${base}/workspaces/${encodeURIComponent(workspaceId)}`

  async function request(path, { method = 'GET', body } = {}) {
    const headers = { accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    let response
    try {
      response = await fetchImpl(`${root}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: 'omit',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new ApiClientError('timeout', `Request timed out after ${timeoutMs} ms`, { cause: error })
      }
      throw new ApiClientError('network', 'Request failed', { cause: error })
    }

    let data = null
    if (response.status !== 204) {
      try {
        data = await response.json()
      } catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
          throw new ApiClientError('timeout', `Request timed out after ${timeoutMs} ms`, { cause: error })
        }
        data = null
      }
    }
    if (!response.ok) {
      const info = data?.error ?? {}
      const kind = response.status === 409 ? 'conflict' : response.status === 404 ? 'not_found' : 'http'
      throw new ApiClientError(kind, info.message || `Request failed with status ${response.status}`, {
        status: response.status,
        code: info.code ?? null,
        details: info.details ?? null,
      })
    }
    return data
  }

  return {
    listRecords: ({ since = null } = {}) => request(`/records${since ? `?since=${encodeURIComponent(since)}` : ''}`),
    pull: ({ cursor = null } = {}) => request(`/sync/pull${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
    createRecord: ({ logicalKey, payload, recordType = RECORD_TYPE }) =>
      request('/records', { method: 'POST', body: { record_type: recordType, logical_key: logicalKey, payload } }),
    updateRecord: (recordId, { expectedVersion, payload }) =>
      request(`/records/${encodeURIComponent(recordId)}`, { method: 'PUT', body: { expected_version: expectedVersion, payload } }),
    deleteRecord: (recordId) => request(`/records/${encodeURIComponent(recordId)}`, { method: 'DELETE' }),
    async getByKey(logicalKey) {
      const { items } = await request('/records')
      return items.find((r) => r.record_type === RECORD_TYPE && r.logical_key === logicalKey) ?? null
    },
  }
}
