import { useState, useEffect } from 'react'
import { SERVICES } from '../data/services'

const STORAGE_KEY = 'kairos-ai-quota-router:state'

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

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return buildDefaultState()
    const parsed = JSON.parse(raw)
    // Merge with defaults so new quotas added later still appear
    const defaults = buildDefaultState()
    Object.keys(defaults).forEach((svcId) => {
      if (!parsed[svcId]) parsed[svcId] = defaults[svcId]
      else {
        Object.keys(defaults[svcId]).forEach((qId) => {
          if (parsed[svcId][qId] === undefined) {
            parsed[svcId][qId] = defaults[svcId][qId]
          }
        })
      }
    })
    return parsed
  } catch {
    return buildDefaultState()
  }
}

export function useQuotaState() {
  const [state, setState] = useState(loadState)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Storage unavailable — silent fail
    }
  }, [state])

  const updateQuota = (serviceId, quotaId, value) => {
    setState((prev) => ({
      ...prev,
      [serviceId]: {
        ...prev[serviceId],
        [quotaId]: value,
      },
    }))
  }

  const resetAll = () => {
    setState(buildDefaultState())
  }

  return { state, updateQuota, resetAll }
}
