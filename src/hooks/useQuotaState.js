import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SERVICES } from '../data/services'
import {
  WEEKLY_HISTORY_STORAGE_KEY,
  deriveServiceHistorySeries,
  loadWeeklyHistory,
} from '../utils'
import {
  LOCAL_WORKSPACE_ID,
  applyQuotaUpdate,
  buildDefaultState,
  confirmQuotas as confirmQuotasState,
  recordCurrentWeek,
  scopeHistory,
} from '../stateTransitions'

const STORAGE_KEY = 'kairos-ai-quota-router:state'

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
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

function loadHistory() {
  try {
    return loadWeeklyHistory(localStorage.getItem(WEEKLY_HISTORY_STORAGE_KEY))
  } catch {
    return []
  }
}

export function useQuotaState() {
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
        services: SERVICES,
        now: new Date(),
      })
    )
  }, [state])

  const updateQuota = useCallback((serviceId, quotaId, value) => {
    setState((prev) => applyQuotaUpdate(prev, serviceId, quotaId, value, new Date()))
  }, [])

  const confirmQuotas = useCallback((serviceId) => {
    setState((prev) => confirmQuotasState(prev, serviceId, new Date()))
  }, [])

  const resetAll = useCallback(() => {
    setState(buildDefaultState())
  }, [])

  const refreshWeeklyHistory = useCallback(() => {
    const persisted = loadWeeklyHistory(localStorage.getItem(WEEKLY_HISTORY_STORAGE_KEY))
    const next = recordCurrentWeek(persisted, {
      workspaceId: LOCAL_WORKSPACE_ID,
      state: stateRef.current,
      services: SERVICES,
      now: new Date(),
    })
    setWeeklyHistory(next)
    return next
  }, [])

  // Depends on `weeklyHistory` itself so the series is never one render stale.
  const getServiceHistory = useCallback(
    (serviceId, range = {}) =>
      deriveServiceHistorySeries({
        history: scopeHistory(weeklyHistory, LOCAL_WORKSPACE_ID),
        serviceId,
        services: SERVICES,
        fromWeekKey: range.fromWeekKey || undefined,
        toWeekKey: range.toWeekKey || undefined,
      }),
    [weeklyHistory]
  )

  return useMemo(
    () => ({
      state,
      updateQuota,
      confirmQuotas,
      resetAll,
      weeklyHistory,
      refreshWeeklyHistory,
      getServiceHistory,
    }),
    [state, updateQuota, confirmQuotas, resetAll, weeklyHistory, refreshWeeklyHistory, getServiceHistory]
  )
}
