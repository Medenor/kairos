import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SERVICES } from '../data/services'
import {
  RESET_DATE_KEY,
  WEEKLY_HISTORY_LOGICAL_KEY_PREFIX,
  WEEKLY_HISTORY_STORAGE_KEY,
  adoptLocalSnapshots,
  createWeeklySnapshot,
  deriveServiceHistorySeries,
  loadWeeklyHistory,
  retainWeeklySnapshots,
  snapshotsEquivalent,
  upsertCurrentWeekSnapshot,
} from '../utils'
import {
  applyQuotaRecord,
  applyQuotaUpdate,
  applyServerRecords,
  buildDefaultState,
  recordCurrentWeek,
  scopeHistory,
} from '../stateTransitions'
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

function buildDefaultEntries() {
  const entries = []
  SERVICES.forEach((service) => {
    service.quotas.forEach((quota) => {
      entries.push({ logicalKey: `${service.id}:${quota.id}`, value: quota.value })
    })
    entries.push({ logicalKey: `${service.id}:${RESET_DATE_KEY}`, value: null })
  })
  return entries
}

function loadFallbackState() {
  try {
    const raw = localStorage.getItem(FALLBACK_STORAGE_KEY)
    if (!raw) return buildDefaultState()
    const parsed = JSON.parse(raw)
    const defaults = buildDefaultState()
    Object.keys(defaults).forEach((serviceId) => {
      if (!parsed[serviceId]) parsed[serviceId] = defaults[serviceId]
      else {
        Object.keys(defaults[serviceId]).forEach((quotaId) => {
          if (parsed[serviceId][quotaId] === undefined) {
            parsed[serviceId][quotaId] = defaults[serviceId][quotaId]
          }
        })
      }
    })
    return parsed
  } catch {
    return buildDefaultState()
  }
}

function loadFallbackHistory() {
  try {
    return loadWeeklyHistory(localStorage.getItem(WEEKLY_HISTORY_STORAGE_KEY))
  } catch {
    return []
  }
}

export function useSharedQuotaState() {
  const [state, setState] = useState(loadFallbackState)
  const [recordIndex, setRecordIndex] = useState({})
  const [weeklyHistory, setWeeklyHistory] = useState(loadFallbackHistory)
  const [historyIndex, setHistoryIndex] = useState({})
  const [workspaceId, setWorkspaceIdState] = useState(
    getWorkspaceId() || localStorage.getItem(FALLBACK_WORKSPACE_KEY) || ''
  )
  const [syncStatus, setSyncStatus] = useState('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [syncCursor, setSyncCursor] = useState(null)
  const stateRef = useRef(state)
  const recordIndexRef = useRef(recordIndex)
  const weeklyHistoryRef = useRef(weeklyHistory)
  const historyIndexRef = useRef(historyIndex)
  const syncCursorRef = useRef(syncCursor)
  const syncInFlightRef = useRef(false)
  const writeTimersRef = useRef(new Map())
  const historyWriteTimerRef = useRef(null)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    recordIndexRef.current = recordIndex
  }, [recordIndex])

  useEffect(() => {
    weeklyHistoryRef.current = weeklyHistory
  }, [weeklyHistory])

  useEffect(() => {
    historyIndexRef.current = historyIndex
  }, [historyIndex])

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

        // History recorded before a workspace was known moves into this workspace
        // once; server snapshots then override matching weeks.
        const next = applyServerRecords(
          {
            state: buildDefaultState(),
            recordIndex: {},
            weeklyHistory: adoptLocalSnapshots(loadFallbackHistory(), selectedWorkspace),
            historyIndex: {},
          },
          result.items || []
        )

        setState(next.state)
        setRecordIndex(next.recordIndex)
        setWeeklyHistory(next.weeklyHistory)
        setHistoryIndex(next.historyIndex)
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
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Storage unavailable — silent fail
    }
  }, [state])

  useEffect(() => {
    try {
      localStorage.setItem(WEEKLY_HISTORY_STORAGE_KEY, JSON.stringify(weeklyHistory))
    } catch {
      // Storage unavailable — silent fail
    }
  }, [weeklyHistory])

  const refreshSync = useCallback(
    async (silent = false) => {
      if (!workspaceId) return
      if (syncInFlightRef.current) return
      syncInFlightRef.current = true
      if (!silent) setSyncStatus('syncing')
      try {
        const result = await syncPull(workspaceId, syncCursorRef.current)
        const next = applyServerRecords(
          {
            state: stateRef.current,
            recordIndex: recordIndexRef.current,
            weeklyHistory: weeklyHistoryRef.current,
            historyIndex: historyIndexRef.current,
          },
          result.items || []
        )

        setState(next.state)
        setRecordIndex(next.recordIndex)
        setWeeklyHistory(next.weeklyHistory)
        setHistoryIndex(next.historyIndex)
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
    },
    [workspaceId]
  )

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
      if (historyWriteTimerRef.current) {
        clearTimeout(historyWriteTimerRef.current)
      }
    }
  }, [])

  const persistQuota = useCallback(
    async (logicalKey, value) => {
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
        setState((prev) => applyQuotaRecord(prev, saved))
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
    },
    [workspaceId, refreshSync]
  )

  const persistWeeklySnapshot = useCallback(
    async (snapshot) => {
      if (!workspaceId) return
      const logicalKey = `${WEEKLY_HISTORY_LOGICAL_KEY_PREFIX}${snapshot.weekKey}`
      const existing = historyIndexRef.current[logicalKey]
      if (existing?.payload && snapshotsEquivalent(existing.payload, snapshot)) {
        return
      }

      setSyncStatus('syncing')
      try {
        let saved = null
        if (!existing) {
          saved = await createRecord(workspaceId, {
            record_type: 'snapshot',
            logical_key: logicalKey,
            payload: snapshot,
          })
        } else {
          saved = await updateRecord(workspaceId, existing.id, {
            expected_version: existing.version,
            payload: snapshot,
          })
        }
        setHistoryIndex((prev) => ({ ...prev, [logicalKey]: saved }))
        setWeeklyHistory((prev) =>
          retainWeeklySnapshots(upsertCurrentWeekSnapshot(prev, saved.payload), {
            now: new Date(),
          })
        )
        setSyncStatus('ready')
        setSyncMessage('History synced')
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
    },
    [workspaceId, refreshSync]
  )

  // Local-first: the current week is recorded locally on load and on every state
  // change, whether or not a workspace or the backend is reachable.
  useEffect(() => {
    setWeeklyHistory((prev) =>
      recordCurrentWeek(prev, { workspaceId, state, services: SERVICES, now: new Date() })
    )
  }, [state, workspaceId])

  useEffect(() => {
    if (!workspaceId) return undefined
    const snapshot = createWeeklySnapshot({
      workspaceId,
      state,
      services: SERVICES,
      now: new Date(),
    })
    if (historyWriteTimerRef.current) {
      clearTimeout(historyWriteTimerRef.current)
    }
    historyWriteTimerRef.current = setTimeout(() => {
      persistWeeklySnapshot(snapshot)
      historyWriteTimerRef.current = null
    }, 220)
    return () => {
      if (historyWriteTimerRef.current) {
        clearTimeout(historyWriteTimerRef.current)
      }
    }
  }, [state, workspaceId, persistWeeklySnapshot])

  const updateQuota = (serviceId, quotaId, value) => {
    const logicalKey = `${serviceId}:${quotaId}`
    setState((prev) => applyQuotaUpdate(prev, serviceId, quotaId, value))
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

  const refreshWeeklyHistory = useCallback(() => {
    const persisted = adoptLocalSnapshots(
      loadWeeklyHistory(localStorage.getItem(WEEKLY_HISTORY_STORAGE_KEY)),
      workspaceId
    )
    const next = recordCurrentWeek(persisted, {
      workspaceId,
      state: stateRef.current,
      services: SERVICES,
      now: new Date(),
    })
    setWeeklyHistory(next)
    return next
  }, [workspaceId])

  // Depends on `weeklyHistory` itself (not a ref) so the derived series is never
  // one render behind the history it describes.
  const getServiceHistory = useCallback(
    (serviceId, range = {}) =>
      deriveServiceHistorySeries({
        history: scopeHistory(weeklyHistory, workspaceId),
        serviceId,
        services: SERVICES,
        fromWeekKey: range.fromWeekKey || undefined,
        toWeekKey: range.toWeekKey || undefined,
      }),
    [weeklyHistory, workspaceId]
  )

  return useMemo(
    () => ({
      state,
      updateQuota,
      resetAll,
      refreshSync,
      syncStatus,
      syncMessage,
      workspaceId,
      weeklyHistory,
      refreshWeeklyHistory,
      getServiceHistory,
    }),
    [
      state,
      updateQuota,
      resetAll,
      refreshSync,
      syncStatus,
      syncMessage,
      workspaceId,
      weeklyHistory,
      refreshWeeklyHistory,
      getServiceHistory,
    ]
  )
}
