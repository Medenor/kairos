import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  RESET_DATE_KEY,
  WEEKLY_HISTORY_LOGICAL_KEY_PREFIX,
  WEEKLY_HISTORY_STORAGE_KEY,
  adoptLocalSnapshots,
  deriveProviderHistorySeries,
  getLocalWeekKey,
  loadWeeklyHistory,
  quotaTimeKey,
  retainWeeklySnapshots,
  snapshotsEquivalent,
  upsertCurrentWeekSnapshot,
} from '../utils'
import {
  applyProviderStateEffects,
  applyQuotaRecord,
  applyQuotaUpdate,
  applyServerRecords,
  buildDefaultState,
  confirmQuotas as confirmQuotasState,
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
const NO_REMOVED = []

// Records that clear every reading of the given providers (a reading is unread when its value is null).
function buildDefaultEntries(providers) {
  const entries = []
  providers.forEach((provider) => {
    provider.quotas.forEach((quota) => {
      entries.push({ logicalKey: `${provider.id}:${quota.id}`, value: null })
      entries.push({ logicalKey: `${provider.id}:${quotaTimeKey(quota.id)}`, value: null })
    })
    entries.push({ logicalKey: `${provider.id}:${RESET_DATE_KEY}`, value: null })
  })
  return entries
}

// The stored state is returned as it is, including entries of ids no provider defines (data of the
// previous fixed-provider build): they are never read and are written back unchanged (FR-022).
function loadFallbackState() {
  try {
    const raw = localStorage.getItem(FALLBACK_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : buildDefaultState()
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

export function useSharedQuotaState(providers = [], { catalogue = null, removed = NO_REMOVED } = {}) {
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
  const [bootstrapped, setBootstrapped] = useState(false)
  const adoptedRef = useRef(false)
  const stateRef = useRef(state)
  const providersRef = useRef(providers)
  const removedRef = useRef(removed)
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
    providersRef.current = providers
    removedRef.current = removed
  }, [providers, removed])

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
            // Local readings stay as the base so legacy entries and unsynced values are not dropped;
            // shared records then overlay them.
            state: stateRef.current,
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
        setBootstrapped(true)
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
      recordCurrentWeek(prev, { workspaceId, state, providers, removed, now: new Date() })
    )
  }, [state, workspaceId, providers, removed])

  // The stored current-week snapshot (which keeps entries of removed providers) is what gets synced.
  useEffect(() => {
    if (!workspaceId) return undefined
    const { weekKey } = getLocalWeekKey(new Date())
    const snapshot = weeklyHistory.find((entry) => entry.workspaceId === workspaceId && entry.weekKey === weekKey)
    if (!snapshot) return undefined
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
  }, [weeklyHistory, workspaceId, persistWeeklySnapshot])

  const scheduleQuotaWrite = useCallback(
    (logicalKey, value) => {
      const existingTimer = writeTimersRef.current.get(logicalKey)
      if (existingTimer) clearTimeout(existingTimer)
      const timer = setTimeout(() => {
        persistQuota(logicalKey, value)
        writeTimersRef.current.delete(logicalKey)
      }, 220)
      writeTimersRef.current.set(logicalKey, timer)
    },
    [persistQuota]
  )

  // First contact with a workspace: readings of declared providers that exist only locally (entered
  // offline or before a workspace was set) are written to the store once, so they are not lost.
  useEffect(() => {
    if (!workspaceId || !bootstrapped || adoptedRef.current) return
    adoptedRef.current = true
    const current = stateRef.current
    for (const provider of providersRef.current) {
      const keys = [...provider.quotas.flatMap((q) => [q.id, quotaTimeKey(q.id)]), RESET_DATE_KEY]
      for (const key of keys) {
        const logicalKey = `${provider.id}:${key}`
        const value = current[provider.id]?.[key]
        if (value !== undefined && value !== null && !recordIndexRef.current[logicalKey]) scheduleQuotaWrite(logicalKey, value)
      }
    }
  }, [workspaceId, bootstrapped, scheduleQuotaWrite])

  const updateQuota = (serviceId, quotaId, value) => {
    const now = new Date()
    setState((prev) => applyQuotaUpdate(prev, serviceId, quotaId, value, now))
    if (!workspaceId) return

    scheduleQuotaWrite(`${serviceId}:${quotaId}`, value)
    // Metadata keys (reset date, stamps) carry no reading time of their own.
    if (!String(quotaId).startsWith('__')) {
      scheduleQuotaWrite(`${serviceId}:${quotaTimeKey(quotaId)}`, now.toISOString())
    }
  }

  const confirmQuotas = useCallback(
    (serviceId) => {
      const service = providers.find((item) => item.id === serviceId)
      if (!service) return
      const now = new Date()
      setState((prev) => confirmQuotasState(prev, serviceId, now, providers))
      if (!workspaceId) return

      service.quotas.forEach((quota) => {
        scheduleQuotaWrite(`${serviceId}:${quotaTimeKey(quota.id)}`, now.toISOString())
      })
    },
    [workspaceId, scheduleQuotaWrite, providers]
  )

  // Values arriving with a created provider: applied in one commit, then written like any reading.
  const applyStateEffects = useCallback(
    (effects) => {
      setState((prev) => applyProviderStateEffects(prev, effects))
      if (!workspaceId) return
      for (const write of effects?.stateWrites ?? []) scheduleQuotaWrite(write.logicalKey, write.value)
    },
    [workspaceId, scheduleQuotaWrite]
  )

  const resetAll = useCallback(async () => {
    for (const timer of writeTimersRef.current.values()) {
      clearTimeout(timer)
    }
    writeTimersRef.current.clear()

    const currentProviders = providersRef.current
    setState((prev) => ({ ...prev, ...buildDefaultState(currentProviders) }))

    if (!workspaceId) {
      setSyncMessage('Local reset applied')
      return
    }

    setSyncStatus('syncing')
    try {
      const nextIndex = { ...recordIndexRef.current }
      for (const entry of buildDefaultEntries(currentProviders)) {
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
      providers,
      removed,
      now: new Date(),
    })
    setWeeklyHistory(next)
    return next
  }, [workspaceId, providers, removed])

  // Depends on `weeklyHistory` itself (not a ref) so the derived series is never
  // one render behind the history it describes.
  const getProviderHistory = useCallback(
    (providerId, range = {}) =>
      deriveProviderHistorySeries({
        history: scopeHistory(weeklyHistory, workspaceId),
        providerId,
        providers,
        catalogue,
        fromWeekKey: range.fromWeekKey || undefined,
        toWeekKey: range.toWeekKey || undefined,
      }),
    [weeklyHistory, workspaceId, providers, catalogue]
  )

  return useMemo(
    () => ({
      state,
      updateQuota,
      confirmQuotas,
      applyStateEffects,
      resetAll,
      refreshSync,
      syncStatus,
      syncMessage,
      workspaceId,
      weeklyHistory,
      refreshWeeklyHistory,
      getProviderHistory,
    }),
    [
      state,
      updateQuota,
      confirmQuotas,
      applyStateEffects,
      resetAll,
      refreshSync,
      syncStatus,
      syncMessage,
      workspaceId,
      weeklyHistory,
      refreshWeeklyHistory,
      getProviderHistory,
    ]
  )
}
