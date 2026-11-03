function uniqueBases(items) {
  return Array.from(new Set(items.filter(Boolean).map((item) => item.replace(/\/$/, ''))))
}

function buildDefaultApiBases() {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const host = window.location.hostname
    // Prefer docker-compose published backend port first, then local direct backend default.
    return uniqueBases([
      `http://${host}:8888/api/v1`,
      `http://${host}:8080/api/v1`,
      'http://localhost:8888/api/v1',
      'http://localhost:8080/api/v1',
    ])
  }
  return ['http://localhost:8888/api/v1', 'http://localhost:8080/api/v1']
}

const API_BASES = (() => {
  const configured = import.meta.env.VITE_SHARED_API_BASE_URL
  if (configured) return uniqueBases([configured])
  return buildDefaultApiBases()
})()
const DEFAULT_WORKSPACE_ID_KEY = 'kairos:workspace-id'

export function getWorkspaceId() {
  return localStorage.getItem(DEFAULT_WORKSPACE_ID_KEY) || ''
}

export function setWorkspaceId(workspaceId) {
  localStorage.setItem(DEFAULT_WORKSPACE_ID_KEY, workspaceId)
}

async function request(path, { method = 'GET', body, idempotencyKey } = {}) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  let response = null
  let networkError = null
  for (const base of API_BASES) {
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      break
    } catch (error) {
      networkError = error
    }
  }

  if (!response) {
    const err = new Error('Request failed')
    err.cause = networkError || null
    throw err
  }

  if (response.status === 204) return null
  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (!response.ok) {
    const err = new Error(data?.error?.message || 'Request failed')
    err.status = response.status
    err.code = data?.error?.code
    err.details = data?.error?.details
    throw err
  }
  return data
}

export async function login(username, password) {
  void username
  void password
  return { session_token: 'local-trust-mode' }
}

export async function getDefaultWorkspace() {
  return request('/workspaces/default')
}

export async function logout() {
  return null
}

export async function listRecords(workspaceId, since = null) {
  const qs = since ? `?since=${encodeURIComponent(since)}` : ''
  return request(`/workspaces/${workspaceId}/records${qs}`)
}

export async function createRecord(workspaceId, payload) {
  return request(`/workspaces/${workspaceId}/records`, {
    method: 'POST',
    body: payload,
  })
}

export async function updateRecord(workspaceId, recordId, payload) {
  return request(`/workspaces/${workspaceId}/records/${recordId}`, {
    method: 'PUT',
    body: payload,
  })
}

export async function deleteRecord(workspaceId, recordId) {
  return request(`/workspaces/${workspaceId}/records/${recordId}`, { method: 'DELETE' })
}

export async function syncPull(workspaceId, cursor = null) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return request(`/workspaces/${workspaceId}/sync/pull${qs}`)
}

export async function runLocalStorageMigration(workspaceId, payload, idempotencyKey) {
  return request(`/workspaces/${workspaceId}/migrations/local-storage`, {
    method: 'POST',
    body: payload,
    idempotencyKey,
  })
}

export async function getMigrationStatus(workspaceId, jobId) {
  return request(`/workspaces/${workspaceId}/migrations/${jobId}`)
}

export async function createBackup(workspaceId) {
  return request(`/workspaces/${workspaceId}/backups`, { method: 'POST' })
}

export async function listBackups(workspaceId) {
  return request(`/workspaces/${workspaceId}/backups`)
}

export async function restoreBackup(workspaceId, backupId) {
  return request(`/workspaces/${workspaceId}/backups/${backupId}/restore`, { method: 'POST' })
}
