import test from 'node:test'
import assert from 'node:assert/strict'
import { LEGACY_SERVICES as SERVICES } from './providers/fixtures/legacyServices.js'
import {
  adoptLocalSnapshots,
  createWeeklySnapshot,
  deriveProviderHistorySeries,
  getLocalWeekKey,
  loadWeeklyHistory,
  recordWeeklySnapshot,
  retainWeeklySnapshots,
  snapshotsEquivalent,
  upsertCurrentWeekSnapshot,
} from './utils.js'

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

function makeSnapshot({ weekDate, workspaceId = 'workspace-1', stateOverrides = {}, providers = SERVICES }) {
  return createWeeklySnapshot({
    workspaceId,
    state: makeState(stateOverrides),
    providers,
    now: weekDate,
  })
}

test('getLocalWeekKey uses a Monday-start local week across month and year boundaries', () => {
  const crossMonth = getLocalWeekKey(new Date('2026-04-30T12:00:00'))
  assert.equal(crossMonth.weekStartDate, '2026-04-27')
  assert.equal(crossMonth.weekEndDate, '2026-05-03')

  const crossYear = getLocalWeekKey(new Date('2026-01-01T12:00:00'))
  assert.equal(crossYear.weekKey, '2026-W01')
  assert.equal(crossYear.weekStartDate, '2025-12-29')
  assert.equal(crossYear.weekEndDate, '2026-01-04')
})

test('createWeeklySnapshot deep-copies quota state and reset metadata', () => {
  const now = new Date('2026-04-24T12:00:00')
  const state = makeState({
    claude: { weekly: 71, slot5h: 58, __last_reset_date: '2026-04-21' },
    chatgpt: { codex_remaining: 64, codex_5h: 52, __last_reset_date: '2026-04-22' },
  })

  const snapshot = createWeeklySnapshot({
    workspaceId: 'workspace-1',
    state,
    providers: SERVICES,
    now,
  })

  assert.equal(snapshot.workspaceId, 'workspace-1')
  assert.equal(snapshot.weekKey, getLocalWeekKey(now).weekKey)
  assert.equal(snapshot.providers.claude.lastResetDate, '2026-04-21')
  assert.equal(snapshot.providers.claude.quotas.weekly.value, 71)
  assert.equal(snapshot.providers.chatgpt.quotas.codex_remaining.value, 64)

  state.claude.weekly = 5
  state.claude.__last_reset_date = '2026-04-01'
  state.chatgpt.codex_remaining = 12

  assert.equal(snapshot.providers.claude.quotas.weekly.value, 71)
  assert.equal(snapshot.providers.claude.lastResetDate, '2026-04-21')
  assert.equal(snapshot.providers.chatgpt.quotas.codex_remaining.value, 64)
})

test('upsertCurrentWeekSnapshot replaces the matching workspace week without mutating input history', () => {
  const weekDate = new Date('2026-04-24T12:00:00')
  const original = makeSnapshot({ weekDate, stateOverrides: { claude: { weekly: 70 } } })
  const replacement = makeSnapshot({ weekDate, stateOverrides: { claude: { weekly: 92 } } })
  const otherWeek = makeSnapshot({
    weekDate: shiftLocalDays(weekDate, -7),
    stateOverrides: { claude: { weekly: 33 } },
  })
  const history = [original, otherWeek]

  const updated = upsertCurrentWeekSnapshot(history, replacement)

  assert.equal(history[0].providers.claude.quotas.weekly.value, 70)
  assert.equal(updated.length, 2)
  assert.equal(updated[0].providers.claude.quotas.weekly.value, 92)
  assert.equal(updated[1].providers.claude.quotas.weekly.value, 33)
})

test('retainWeeklySnapshots keeps the current week plus 52 completed weeks', () => {
  const currentWeek = new Date('2026-04-24T12:00:00')
  const history = Array.from({ length: 61 }, (_, index) => {
    const weekDate = shiftLocalDays(currentWeek, -7 * index)
    return makeSnapshot({
      weekDate,
      stateOverrides: { claude: { weekly: 40 + index } },
    })
  })

  const retained = retainWeeklySnapshots(history, { now: currentWeek })
  const currentWeekKey = getLocalWeekKey(currentWeek).weekKey
  const keptKeys = retained.map((item) => item.weekKey)

  assert.equal(retained.length, 53)
  assert.ok(keptKeys.includes(currentWeekKey))
  assert.ok(keptKeys.includes(getLocalWeekKey(shiftLocalDays(currentWeek, -52 * 7)).weekKey))
  assert.ok(!keptKeys.includes(getLocalWeekKey(shiftLocalDays(currentWeek, -53 * 7)).weekKey))
})

test('recordWeeklySnapshot creates the current week on load and replaces the same week in place', () => {
  const now = new Date('2026-04-24T12:00:00')
  const empty = loadWeeklyHistory(null)

  const first = recordWeeklySnapshot(empty, {
    workspaceId: 'workspace-1',
    state: makeState({
      claude: { weekly: 67, __last_reset_date: '2026-04-21' },
    }),
    providers: SERVICES,
    now,
  })

  assert.equal(first.length, 1)
  assert.equal(first[0].providers.claude.quotas.weekly.value, 67)
  assert.equal(first[0].providers.claude.lastResetDate, '2026-04-21')

  const second = recordWeeklySnapshot(first, {
    workspaceId: 'workspace-1',
    state: makeState({
      claude: { weekly: 91, __last_reset_date: '2026-04-23' },
    }),
    providers: SERVICES,
    now,
  })

  assert.equal(second.length, 1)
  assert.equal(second[0].providers.claude.quotas.weekly.value, 91)
  assert.equal(second[0].providers.claude.lastResetDate, '2026-04-23')
})

test('deriveProviderHistorySeries returns ordered recorded rows and quota values for a service', () => {
  const currentWeek = new Date('2026-04-24T12:00:00')
  const twoWeeksAgo = shiftLocalDays(currentWeek, -14)
  const oneWeekAgo = shiftLocalDays(currentWeek, -7)
  const history = [
    makeSnapshot({ weekDate: twoWeeksAgo, stateOverrides: { claude: { weekly: 78, slot5h: 61 } } }),
    makeSnapshot({ weekDate: currentWeek, stateOverrides: { claude: { weekly: 82, slot5h: 54 } } }),
  ]
  const fromWeekKey = getLocalWeekKey(twoWeeksAgo).weekKey
  const toWeekKey = getLocalWeekKey(currentWeek).weekKey

  const series = deriveProviderHistorySeries({
    history,
    providerId: 'claude',
    providers: SERVICES,
    fromWeekKey,
    toWeekKey,
  })

  assert.equal(series.displayName, 'Claude')
  assert.equal(series.recordedWeekCount, 2)
  assert.equal(series.hasEnoughHistoryForTrends, true)
  assert.deepEqual(series.entries.map((entry) => entry.status), ['recorded', 'missing_week', 'recorded'])
  assert.equal(series.entries[0].quotas.find((quota) => quota.quotaId === 'weekly').value, 78)
  assert.equal(series.entries[2].quotas.find((quota) => quota.quotaId === 'slot5h').value, 54)

  void oneWeekAgo
})

test('deriveProviderHistorySeries distinguishes missing weeks, missing services, and removed-service metadata', () => {
  const currentWeek = new Date('2026-04-24T12:00:00')
  const retiredWeek = shiftLocalDays(currentWeek, -14)

  const history = [
    {
      ...makeSnapshot({
        weekDate: retiredWeek,
        stateOverrides: { claude: { weekly: 81 } },
      }),
      providers: {},
      services: {
        archived_ai: {
          providerId: 'archived_ai',
          serviceName: 'Legacy Writer',
          capturedServiceMeta: {
            serviceName: 'Legacy Writer',
            color: '#666666',
            note: 'retired',
          },
          lastResetDate: '2026-04-10',
          quotas: {
            weekly: {
              quotaId: 'weekly',
              label: 'Weekly quota',
              type: 'consumed_pct',
              value: 81,
              currency: null,
              consumedPct: 81,
            },
          },
        },
      },
    },
    makeSnapshot({
      weekDate: currentWeek,
      stateOverrides: { claude: { weekly: 74 } },
    }),
  ]

  const retiredSeries = deriveProviderHistorySeries({
    history,
    providerId: 'archived_ai',
    providers: SERVICES,
    fromWeekKey: getLocalWeekKey(retiredWeek).weekKey,
    toWeekKey: getLocalWeekKey(currentWeek).weekKey,
  })

  assert.equal(retiredSeries.displayName, 'Legacy Writer')
  assert.equal(retiredSeries.recordedWeekCount, 1)
  assert.equal(retiredSeries.hasEnoughHistoryForTrends, false)
  assert.equal(retiredSeries.entries[0].status, 'recorded')
  assert.equal(retiredSeries.entries[1].status, 'missing_week')
  assert.equal(retiredSeries.entries[2].status, 'missing_service')

  const claudeSeries = deriveProviderHistorySeries({
    history,
    providerId: 'claude',
    providers: SERVICES,
    fromWeekKey: getLocalWeekKey(retiredWeek).weekKey,
    toWeekKey: getLocalWeekKey(currentWeek).weekKey,
  })

  assert.equal(claudeSeries.entries[0].status, 'missing_service')
  assert.equal(claudeSeries.entries[1].status, 'missing_week')
  assert.equal(claudeSeries.entries[2].status, 'recorded')
  assert.equal(claudeSeries.recordedWeekCount, 1)
})

test('gap entries expose an empty quota array, never zero-valued quotas (data-model, FR-006)', () => {
  const currentWeek = new Date('2026-04-24T12:00:00')
  const twoWeeksAgo = shiftLocalDays(currentWeek, -14)
  const servicesWithoutCopilot = SERVICES.filter((service) => service.id !== 'copilot')
  const history = [
    makeSnapshot({ weekDate: twoWeeksAgo, providers: servicesWithoutCopilot }),
    makeSnapshot({ weekDate: currentWeek }),
  ]

  const series = deriveProviderHistorySeries({
    history,
    providerId: 'copilot',
    providers: SERVICES,
    fromWeekKey: getLocalWeekKey(twoWeeksAgo).weekKey,
    toWeekKey: getLocalWeekKey(currentWeek).weekKey,
  })

  assert.deepEqual(series.entries.map((entry) => entry.status), ['missing_service', 'missing_week', 'recorded'])
  assert.deepEqual(series.entries[0].quotas, [])
  assert.deepEqual(series.entries[1].quotas, [])
  assert.ok(Array.isArray(series.entries[2].quotas))
})

test('capturedAt is the real capture time and moves when a same-week snapshot is replaced', () => {
  const first = new Date('2026-04-24T09:15:00')
  const later = new Date('2026-04-24T17:40:30')

  const created = recordWeeklySnapshot([], {
    workspaceId: 'workspace-1',
    state: makeState({ claude: { weekly: 50 } }),
    providers: SERVICES,
    now: first,
  })
  assert.equal(created[0].capturedAt, first.toISOString())

  const updated = recordWeeklySnapshot(created, {
    workspaceId: 'workspace-1',
    state: makeState({ claude: { weekly: 51 } }),
    providers: SERVICES,
    now: later,
  })
  assert.equal(updated.length, 1)
  assert.equal(updated[0].capturedAt, later.toISOString())
})

test('recording unchanged state keeps the same history and capturedAt', () => {
  const first = new Date('2026-04-24T09:15:00')
  const later = new Date('2026-04-24T17:40:30')
  const input = {
    workspaceId: 'workspace-1',
    state: makeState({ claude: { weekly: 50 } }),
    providers: SERVICES,
  }

  const created = recordWeeklySnapshot([], { ...input, now: first })
  const again = recordWeeklySnapshot(created, { ...input, now: later })

  assert.equal(again, created)
  assert.equal(again[0].capturedAt, first.toISOString())
})

test('snapshotsEquivalent ignores capturedAt but not content', () => {
  const a = makeSnapshot({ weekDate: new Date('2026-04-24T12:00:00'), stateOverrides: { claude: { weekly: 10 } } })
  const sameContent = { ...a, capturedAt: '2030-01-01T00:00:00.000Z' }
  const changed = makeSnapshot({ weekDate: new Date('2026-04-24T12:00:00'), stateOverrides: { claude: { weekly: 11 } } })

  assert.equal(snapshotsEquivalent(a, sameContent), true)
  assert.equal(snapshotsEquivalent(a, changed), false)
  assert.equal(snapshotsEquivalent(a, null), false)
})

test('adoptLocalSnapshots moves local history into the workspace without overwriting its own weeks', () => {
  const currentWeek = new Date('2026-04-24T12:00:00')
  const lastWeek = shiftLocalDays(currentWeek, -7)
  const history = [
    makeSnapshot({ weekDate: lastWeek, workspaceId: 'local', stateOverrides: { claude: { weekly: 30 } } }),
    makeSnapshot({ weekDate: currentWeek, workspaceId: 'local', stateOverrides: { claude: { weekly: 40 } } }),
    makeSnapshot({ weekDate: currentWeek, workspaceId: 'workspace-1', stateOverrides: { claude: { weekly: 99 } } }),
    makeSnapshot({ weekDate: currentWeek, workspaceId: 'workspace-2', stateOverrides: { claude: { weekly: 5 } } }),
  ]
  const before = JSON.stringify(history)

  const adopted = adoptLocalSnapshots(history, 'workspace-1', { now: currentWeek })

  assert.equal(JSON.stringify(history), before)
  const mine = adopted.filter((entry) => entry.workspaceId === 'workspace-1')
  assert.deepEqual(mine.map((entry) => entry.weekKey), [
    getLocalWeekKey(lastWeek).weekKey,
    getLocalWeekKey(currentWeek).weekKey,
  ])
  assert.equal(mine[0].providers.claude.quotas.weekly.value, 30)
  assert.equal(mine[1].providers.claude.quotas.weekly.value, 99)
  assert.equal(adopted.filter((entry) => entry.workspaceId === 'local').length, 0)
  assert.equal(adopted.filter((entry) => entry.workspaceId === 'workspace-2').length, 1)
})
