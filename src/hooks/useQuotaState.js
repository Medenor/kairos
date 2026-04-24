import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SERVICES } from '../data/services'
import {
  RESET_DATE_KEY,
  WEEKLY_HISTORY_STORAGE_KEY,
  createWeeklySnapshot,
  deriveServiceHistorySeries,
  loadWeeklyHistory,
  recordWeeklySnapshot,
} from '../utils'

const STORAGE_KEY = 'kairos-ai-quota-router:state'
const LOCAL_WORKSPACE_ID = 'local'

function buildDefaultState() {
  const state = {}
  SERVICES.forEach((service) => {
    state[service.id] = {}
    service.quotas.forEach((quota) => {
      state[service.id][quota.id] = quota.value
    })
    state[service.id][RESET_DATE_KEY] = null
  })
  return state
}

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
  const weeklyHistoryRef = useRef(weeklyHistory)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    weeklyHistoryRef.current = weeklyHistory
  }, [weeklyHistory])

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
      recordWeeklySnapshot(prev, {
        workspaceId: LOCAL_WORKSPACE_ID,
        state,
        services: SERVICES,
        now: new Date(),
      })
    )
  }, [state])

  const updateQuota = useCallback((serviceId, quotaId, value) => {
    setState((prev) => ({
      ...prev,
      [serviceId]: {
        ...(prev[serviceId] || {}),
        [quotaId]: value,
      },
    }))
  }, [])

  const resetAll = useCallback(() => {
    setState(buildDefaultState())
  }, [])

  const refreshWeeklyHistory = useCallback(() => {
    const persisted = loadWeeklyHistory(localStorage.getItem(WEEKLY_HISTORY_STORAGE_KEY))
    const next = recordWeeklySnapshot(persisted, {
      workspaceId: LOCAL_WORKSPACE_ID,
      state: stateRef.current,
      services: SERVICES,
      now: new Date(),
    })
    setWeeklyHistory(next)
    return next
  }, [])

  const getServiceHistory = useCallback((serviceId, range = {}) => {
    const scopedHistory = weeklyHistoryRef.current.filter((item) => item.workspaceId === LOCAL_WORKSPACE_ID)
    return deriveServiceHistorySeries({
      history: scopedHistory,
      serviceId,
      services: SERVICES,
      fromWeekKey: range.fromWeekKey || undefined,
      toWeekKey: range.toWeekKey || undefined,
    })
  }, [])

  return useMemo(
    () => ({
      state,
      updateQuota,
      resetAll,
      weeklyHistory,
      refreshWeeklyHistory,
      getServiceHistory,
    }),
    [state, updateQuota, resetAll, weeklyHistory, refreshWeeklyHistory, getServiceHistory]
  )
}
