import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SERVICES } from '../data/services'
import { RESET_DATE_KEY } from '../utils'
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
    s[svc.id][RESET_DATE_KEY] = null
  })
  return s
}

function buildDefaultEntries() {
  const entries = []
  SERVICES.forEach((svc) => {
    svc.quotas.forEach((q) => {
      entries.push({ logicalKey: `${svc.id}:${q.id}`, value: q.value })
    })
    entries.push({ logicalKey: `${svc.id}:${RESET_DATE_KEY}`, value: null })
  })
  return entries
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
    const defaults = buildDefaultState()
    Object.keys(defaults).forEach((svcId) => {
      if (!parsed[svcId]) parsed[svcId] = defaults[svcId]
      else {
        Object.keys(defaults[svcId]).forEach((stateKey) => {
          if (parsed[svcId][stateKey] === undefined) {
            parsed[svcId][stateKey] = defaults[svcId][stateKey]
          }
        })
      }
    })
    return parsed
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
  const stateRef = useRef(state)
  const recordIndexRef = useRef(recordIndex)
  const syncCursorRef = useRef(syncCursor)
  const syncInFlightRef = useRef(false)
  const writeTimersRef = useRef(new Map())

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    recordIndexRef.current = recordIndex
  }, [recordIndex])

  useEffect(() => {
    syncCursorRef.current = syncCursor
  }, [syncCursor])

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

  const refreshSync = useCallback(async (silent = false) => {
    if (!workspaceId) return
    if (syncInFlightRef.current) return
    syncInFlightRef.current = true
    if (!silent) setSyncStatus('syncing')
    try {
      const result = await syncPull(workspaceId, syncCursorRef.current)
      let nextState = stateRef.current
      const nextIndex = { ...recordIndexRef.current }
      for (const item of result.items || []) {
        nextState = applyRecordToState(nextState, item)
        nextIndex[item.logical_key] = item
      }
      setState(nextState)
      setRecordIndex(nextIndex)
      setSyncCursor(result.next_cursor || syncCursorRef.current)
      if (!silent) {
        setSyncStatus('ready')
        setSyncMessage('Synced')
      }
    } catch (error) {
      setSyncStatus('error')
      setSyncMessage(error.message)
    } finally {
      syncInFlightRef.current = false
    }
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return undefined
    const interval = setInterval(() => {
      refreshSync(true)
    }, 3000)
    return () => clearInterval(interval)
  }, [workspaceId, refreshSync])

  useEffect(() => {
    return () => {
      for (const timer of writeTimersRef.current.values()) {
        clearTimeout(timer)
      }
      writeTimersRef.current.clear()
    }
  }, [])

  const persistQuota = useCallback(async (logicalKey, value) => {
    if (!workspaceId) return
    setSyncStatus('syncing')
    try {
      const existing = recordIndexRef.current[logicalKey]
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
      setState((prev) => applyRecordToState(prev, saved))
      setRecordIndex((prev) => ({ ...prev, [logicalKey]: saved }))
      setSyncStatus('ready')
      setSyncMessage('Synced')
    } catch (error) {
      if (error.status === 409) {
        setSyncStatus('conflict')
        setSyncMessage('Conflict detected. Pulling latest changes.')
        await refreshSync(false)
      } else {
        setSyncStatus('error')
        setSyncMessage(error.message)
      }
    }
  }, [workspaceId, refreshSync])

  const updateQuota = (serviceId, quotaId, value) => {
    const logicalKey = `${serviceId}:${quotaId}`
    setState((prev) => ({
      ...prev,
      [serviceId]: {
        ...(prev[serviceId] || {}),
        [quotaId]: value,
      },
    }))
    if (!workspaceId) return

    const existingTimer = writeTimersRef.current.get(logicalKey)
    if (existingTimer) clearTimeout(existingTimer)
    const timer = setTimeout(() => {
      persistQuota(logicalKey, value)
      writeTimersRef.current.delete(logicalKey)
    }, 220)
    writeTimersRef.current.set(logicalKey, timer)
  }

  const resetAll = useCallback(async () => {
    for (const timer of writeTimersRef.current.values()) {
      clearTimeout(timer)
    }
    writeTimersRef.current.clear()

    const defaultState = buildDefaultState()
    setState(defaultState)

    if (!workspaceId) {
      setSyncMessage('Local reset applied')
      return
    }

    setSyncStatus('syncing')
    try {
      const nextIndex = { ...recordIndexRef.current }
      for (const entry of buildDefaultEntries()) {
        const existing = nextIndex[entry.logicalKey]
        let saved = null
        if (!existing) {
          saved = await createRecord(workspaceId, {
            record_type: 'quota_state',
            logical_key: entry.logicalKey,
            payload: { value: entry.value },
          })
        } else {
          saved = await updateRecord(workspaceId, existing.id, {
            expected_version: existing.version,
            payload: { value: entry.value },
          })
        }
        nextIndex[entry.logicalKey] = saved
      }
      setRecordIndex(nextIndex)
      setSyncStatus('ready')
      setSyncMessage('Reset synced')
    } catch (error) {
      if (error.status === 409) {
        setSyncStatus('conflict')
        setSyncMessage('Conflict detected. Pulling latest changes.')
        await refreshSync(false)
      } else {
        setSyncStatus('error')
        setSyncMessage(error.message)
      }
    }
  }, [workspaceId, refreshSync])

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
    [state, updateQuota, resetAll, syncStatus, syncMessage, workspaceId]
  )
}
