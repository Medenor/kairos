import { useEffect, useMemo, useState } from 'react'
import { SERVICES } from '../data/services'
import {
  createRecord,
  getDefaultWorkspace,
  getWorkspaceId,
  listRecords,
  setWorkspaceId,
  syncPull,
  updateRecord,
} from '../services/sharedStateApi'

const FALLBACK_STORAGE_KEY = 'kairos-ai-quota-router:state'
const FALLBACK_WORKSPACE_KEY = 'kairos:workspace-id'

function buildDefaultState() {
  const s = {}
  SERVICES.forEach((svc) => {
    s[svc.id] = {}
    svc.quotas.forEach((q) => {
      s[svc.id][q.id] = q.value
    })
  })
  return s
}

function logicalKeyToQuota(logicalKey) {
  const [serviceId, quotaId] = String(logicalKey).split(':')
  return { serviceId, quotaId }
}

function applyRecordToState(prev, record) {
  const { serviceId, quotaId } = logicalKeyToQuota(record.logical_key)
  if (!serviceId || !quotaId) return prev
  const value = record?.payload?.value
  if (value === undefined) return prev
  return {
    ...prev,
    [serviceId]: {
      ...(prev[serviceId] || {}),
      [quotaId]: value,
    },
  }
}

function loadFallback() {
  try {
    const raw = localStorage.getItem(FALLBACK_STORAGE_KEY)
    if (!raw) return buildDefaultState()
    const parsed = JSON.parse(raw)
    return { ...buildDefaultState(), ...parsed }
  } catch {
    return buildDefaultState()
  }
}

export function useSharedQuotaState() {
  const [state, setState] = useState(loadFallback)
  const [recordIndex, setRecordIndex] = useState({})
  const [workspaceId, setWorkspaceIdState] = useState(getWorkspaceId() || localStorage.getItem(FALLBACK_WORKSPACE_KEY) || '')
  const [syncStatus, setSyncStatus] = useState('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [syncCursor, setSyncCursor] = useState(null)

  useEffect(() => {
    let mounted = true
    async function bootstrap() {
      try {
        setSyncStatus('connecting')
        const storedWorkspace = workspaceId || localStorage.getItem(FALLBACK_WORKSPACE_KEY)
        const selectedWorkspace =
          storedWorkspace || (await getDefaultWorkspace().then((ws) => ws.id).catch(() => ''))
        if (!selectedWorkspace) {
          setSyncStatus('offline')
          setSyncMessage('Missing workspace id')
          return
        }
        setWorkspaceId(selectedWorkspace)
        setWorkspaceIdState(selectedWorkspace)
        const result = await listRecords(selectedWorkspace)
        if (!mounted) return
        const index = {}
        let nextState = buildDefaultState()
        for (const item of result.items || []) {
          nextState = applyRecordToState(nextState, item)
          index[item.logical_key] = item
        }
        setState(nextState)
        setRecordIndex(index)
        setSyncCursor(result.sync_cursor || null)
        setSyncStatus('ready')
        setSyncMessage('Connected')
      } catch (error) {
        if (!mounted) return
        setSyncStatus('offline')
        setSyncMessage(error.message)
      }
    }
    bootstrap()
    return () => {
      mounted = false
    }
  }, [workspaceId])

  useEffect(() => {
    localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const refreshSync = async () => {
    if (!workspaceId) return
    setSyncStatus('syncing')
    try {
      const result = await syncPull(workspaceId, syncCursor)
      let nextState = state
      const nextIndex = { ...recordIndex }
      for (const item of result.items || []) {
        nextState = applyRecordToState(nextState, item)
        nextIndex[item.logical_key] = item
      }
      setState(nextState)
      setRecordIndex(nextIndex)
      setSyncCursor(result.next_cursor || syncCursor)
      setSyncStatus('ready')
      setSyncMessage('Synced')
    } catch (error) {
      setSyncStatus('error')
      setSyncMessage(error.message)
    }
  }

  const updateQuota = async (serviceId, quotaId, value) => {
    const logicalKey = `${serviceId}:${quotaId}`
    setState((prev) => ({
      ...prev,
      [serviceId]: {
        ...(prev[serviceId] || {}),
        [quotaId]: value,
      },
    }))

    if (!workspaceId) return
    setSyncStatus('syncing')
    try {
      const existing = recordIndex[logicalKey]
      let saved = null
      if (!existing) {
        saved = await createRecord(workspaceId, {
          record_type: 'quota_state',
          logical_key: logicalKey,
          payload: { value },
        })
      } else {
        saved = await updateRecord(workspaceId, existing.id, {
          expected_version: existing.version,
          payload: { value },
        })
      }
      setRecordIndex((prev) => ({ ...prev, [logicalKey]: saved }))
      setSyncStatus('ready')
      setSyncMessage('Synced')
    } catch (error) {
      if (error.status === 409) {
        setSyncStatus('conflict')
        setSyncMessage('Conflict detected. Pull latest changes.')
      } else {
        setSyncStatus('error')
        setSyncMessage(error.message)
      }
    }
  }

  const resetAll = () => {
    setState(buildDefaultState())
    setSyncMessage('Local reset applied')
  }

  return useMemo(
    () => ({
      state,
      updateQuota,
      resetAll,
      refreshSync,
      syncStatus,
      syncMessage,
      workspaceId,
    }),
    [state, syncStatus, syncMessage, workspaceId]
  )
}
