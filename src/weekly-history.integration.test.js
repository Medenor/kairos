import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SERVICES } from './data/services.js'
import WeeklyHistoryPanel from './components/WeeklyHistoryPanel.js'
import { createWeeklySnapshot, getLocalWeekKey } from './utils.js'

function makeState(overrides = {}) {
  const state = {}
  for (const service of SERVICES) {
    state[service.id] = {}
    for (const quota of service.quotas) {
      state[service.id][quota.id] = quota.value
    }
    state[service.id].__last_reset_date = null
  }
  for (const [serviceId, serviceState] of Object.entries(overrides)) {
    state[serviceId] = {
      ...(state[serviceId] || {}),
      ...serviceState,
    }
  }
  return state
}

function shiftLocalDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

test('weekly history panel renders service comparison, gaps, and insufficient-history messaging', () => {
  const currentWeek = new Date('2026-04-24T12:00:00')
  const previousWeek = shiftLocalDays(currentWeek, -7)
  const history = [
    createWeeklySnapshot({
      workspaceId: 'workspace-1',
      state: makeState({
        claude: { weekly: 78, slot5h: 64, __last_reset_date: '2026-04-20' },
      }),
      services: SERVICES,
      now: previousWeek,
    }),
    createWeeklySnapshot({
      workspaceId: 'workspace-1',
      state: makeState({
        claude: { weekly: 84, slot5h: 52, __last_reset_date: '2026-04-22' },
      }),
      services: SERVICES,
      now: currentWeek,
    }),
  ]

  const markup = renderToStaticMarkup(
    React.createElement(WeeklyHistoryPanel, {
      services: SERVICES,
      weeklyHistory: history,
      selectedServiceId: 'claude',
      onSelectService: () => {},
      getServiceHistory: () => ({
        displayName: 'Claude',
        recordedWeekCount: 2,
        hasEnoughHistoryForTrends: true,
        entries: [
          {
            weekKey: getLocalWeekKey(previousWeek).weekKey,
            weekStartDate: '2026-04-13',
            status: 'recorded',
            quotas: [
              { quotaId: 'weekly', label: 'Weekly quota', value: 78, type: 'consumed_pct' },
              { quotaId: 'slot5h', label: '5h slot (current)', value: 64, type: 'consumed_pct' },
            ],
            message: '',
          },
          {
            weekKey: '2026-W17',
            weekStartDate: '2026-04-20',
            status: 'missing_week',
            quotas: {},
            message: 'No snapshot recorded for this week.',
          },
          {
            weekKey: getLocalWeekKey(currentWeek).weekKey,
            weekStartDate: '2026-04-20',
            status: 'recorded',
            quotas: [
              { quotaId: 'weekly', label: 'Weekly quota', value: 84, type: 'consumed_pct' },
              { quotaId: 'slot5h', label: '5h slot (current)', value: 52, type: 'consumed_pct' },
            ],
            message: '',
          },
        ],
      }),
    })
  )

  assert.match(markup, /Weekly history/i)
  assert.match(markup, /Claude/i)
  assert.match(markup, /No snapshot recorded for this week/i)
  assert.match(markup, /Weekly quota/i)
  assert.match(markup, /5h slot/i)
})
