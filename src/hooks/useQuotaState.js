import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  WEEKLY_HISTORY_STORAGE_KEY,
  deriveServiceHistorySeries,
  loadWeeklyHistory,
} from '../utils'
import {
  LOCAL_WORKSPACE_ID,
  applyProviderStateEffects,
  applyQuotaUpdate,
  buildDefaultState,
  confirmQuotas as confirmQuotasState,
  recordCurrentWeek,
  scopeHistory,
} from '../stateTransitions'

const STORAGE_KEY = 'kairos-ai-quota-router:state'

// The stored state is returned as it is, including entries of ids no provider defines (data of the
// previous fixed-provider build): they are never read and are written back unchanged (FR-022).
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : buildDefaultState()
  } catch {
    return buildDefaultState()
  }
}

function loadHistory() {
  try {
    return loadWeeklyHistory(localStorage.getItem(WEEKLY_HISTORY_STORAGE_KEY))
  } catch {
    return []
  }
}

export function useQuotaState(providers = []) {
  const [state, setState] = useState(loadState)
  const [weeklyHistory, setWeeklyHistory] = useState(loadHistory)
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
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

  useEffect(() => {
    setWeeklyHistory((prev) =>
      recordCurrentWeek(prev, {
        workspaceId: LOCAL_WORKSPACE_ID,
        state,
        services: providers,
        now: new Date(),
      })
    )
  }, [state, providers])

  const updateQuota = useCallback((serviceId, quotaId, value) => {
    setState((prev) => applyQuotaUpdate(prev, serviceId, quotaId, value, new Date()))
  }, [])

  const confirmQuotas = useCallback((serviceId) => {
    setState((prev) => confirmQuotasState(prev, serviceId, new Date(), providers))
  }, [providers])

  // Values arriving with a created provider (readings and stamps entered in the form).
  const applyStateEffects = useCallback((effects) => {
    setState((prev) => applyProviderStateEffects(prev, effects))
  }, [])

  // Clears every reading of the declared providers; providers themselves are kept.
  const resetAll = useCallback(() => {
    setState((prev) => ({ ...prev, ...buildDefaultState(providers) }))
  }, [providers])

  const refreshWeeklyHistory = useCallback(() => {
    const persisted = loadWeeklyHistory(localStorage.getItem(WEEKLY_HISTORY_STORAGE_KEY))
    const next = recordCurrentWeek(persisted, {
      workspaceId: LOCAL_WORKSPACE_ID,
      state: stateRef.current,
      services: providers,
      now: new Date(),
    })
    setWeeklyHistory(next)
    return next
  }, [providers])

  // Depends on `weeklyHistory` itself so the series is never one render stale.
  const getServiceHistory = useCallback(
    (serviceId, range = {}) =>
      deriveServiceHistorySeries({
        history: scopeHistory(weeklyHistory, LOCAL_WORKSPACE_ID),
        serviceId,
        services: providers,
        fromWeekKey: range.fromWeekKey || undefined,
        toWeekKey: range.toWeekKey || undefined,
      }),
    [weeklyHistory, providers]
  )

  return useMemo(
    () => ({
      state,
      updateQuota,
      confirmQuotas,
      applyStateEffects,
      resetAll,
      weeklyHistory,
      refreshWeeklyHistory,
      getServiceHistory,
    }),
    [state, updateQuota, confirmQuotas, applyStateEffects, resetAll, weeklyHistory, refreshWeeklyHistory, getServiceHistory]
  )
}
