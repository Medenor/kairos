import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SERVICES } from './data/services.js'
import {
  LOCAL_WORKSPACE_ID,
  applyQuotaUpdate,
  applyServerRecords,
  applySnapshotRecord,
  buildDefaultState,
  recordCurrentWeek,
  scopeHistory,
} from './stateTransitions.js'
import {
  adoptLocalSnapshots,
  createWeeklySnapshot,
  getLocalWeekKey,
  loadWeeklyHistory,
} from './utils.js'

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

function shiftLocalDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

const STAMP_NOW = new Date('2026-04-20T08:00:00Z')
const MONDAY = new Date('2026-04-20T08:00:00')
const WEDNESDAY = new Date('2026-04-22T10:30:00')
const FRIDAY = new Date('2026-04-24T18:00:00')

function snapshotRecord({ workspaceId = 'ws-1', weekDate = FRIDAY, claudeWeekly = 77, recordWorkspace } = {}) {
  const state = applyQuotaUpdate(buildDefaultState(), 'claude', 'weekly', claudeWeekly, STAMP_NOW)
  const payload = createWeeklySnapshot({ workspaceId, state, services: SERVICES, now: weekDate })
  return {
    id: `rec-${payload.weekKey}`,
    version: 1,
    ...(recordWorkspace ? { workspace_id: recordWorkspace } : {}),
    record_type: 'snapshot',
    logical_key: `weekly-history:${payload.weekKey}`,
    payload,
  }
}

function quotaRecord(serviceId, quotaId, value) {
  return {
    id: `rec-${serviceId}-${quotaId}`,
    version: 1,
    record_type: 'quota_state',
    logical_key: `${serviceId}:${quotaId}`,
    payload: { value },
  }
}

// Regression for T040: bootstrap reassigned a `const`, which threw
// "Assignment to constant variable" whenever the server returned a quota_state
// record, so shared state and weekly history never loaded.
test('applyServerRecords folds quota_state and snapshot records without throwing', () => {
  const base = {
    state: buildDefaultState(),
    recordIndex: {},
    weeklyHistory: [],
    historyIndex: {},
  }
  const items = [quotaRecord('claude', 'weekly', 12), snapshotRecord({ workspaceId: 'ws-1' })]

  let next
  assert.doesNotThrow(() => {
    next = applyServerRecords(base, items, { now: FRIDAY })
  })

  assert.equal(next.state.claude.weekly, 12)
  assert.deepEqual(Object.keys(next.recordIndex), ['claude:weekly'])
  assert.equal(next.weeklyHistory.length, 1)
  assert.equal(next.weeklyHistory[0].services.claude.quotas.weekly.value, 77)
  assert.deepEqual(Object.keys(next.historyIndex), [items[1].logical_key])
})

test('hooks route all server records through the tested applyServerRecords', () => {
  const source = readFileSync(new URL('./hooks/useSharedQuotaState.js', import.meta.url), 'utf8')
  assert.equal(source.match(/applyServerRecords\(/g)?.length, 2, 'bootstrap and refreshSync must both use it')
  assert.doesNotMatch(source, /const nextState\b/)
})

test('snapshot records never change live quota values (FR-010)', () => {
  const state = deepFreeze(buildDefaultState())
  const base = deepFreeze({ state, recordIndex: {}, weeklyHistory: [], historyIndex: {} })

  const next = applyServerRecords(base, [snapshotRecord({ claudeWeekly: 3 })], { now: FRIDAY })

  assert.equal(next.state, state)
  assert.equal(next.state.claude.weekly, buildDefaultState().claude.weekly)
})

test('a shared snapshot is scoped to the workspace of the record that stored it', () => {
  const record = snapshotRecord({ workspaceId: 'local', recordWorkspace: 'ws-1' })
  const history = applySnapshotRecord([], record, { now: FRIDAY })

  assert.equal(history[0].workspaceId, 'ws-1')
  assert.equal(scopeHistory(history, 'ws-1').length, 1)
  assert.equal(scopeHistory(history, 'ws-2').length, 0)
})

test('current week is recorded on load, updated in place, and reset records the defaults', () => {
  // Completed history from an earlier week must survive everything below.
  const lastWeek = createWeeklySnapshot({
    workspaceId: LOCAL_WORKSPACE_ID,
    state: applyQuotaUpdate(buildDefaultState(), 'claude', 'weekly', 33, STAMP_NOW),
    services: SERVICES,
    now: shiftLocalDays(MONDAY, -7),
  })
  const stored = JSON.stringify([lastWeek])

  // load
  let state = deepFreeze(applyQuotaUpdate(buildDefaultState(), 'claude', 'weekly', 55, STAMP_NOW))
  let history = recordCurrentWeek(loadWeeklyHistory(stored), {
    workspaceId: '',
    state,
    services: SERVICES,
    now: MONDAY,
  })
  assert.equal(history.length, 2)
  const currentKey = getLocalWeekKey(MONDAY).weekKey
  const current = () => history.find((entry) => entry.weekKey === currentKey)
  assert.equal(current().workspaceId, LOCAL_WORKSPACE_ID)
  assert.equal(current().services.claude.quotas.weekly.value, 55)
  const loadedAt = current().capturedAt

  // updateQuota later in the same week
  state = deepFreeze(applyQuotaUpdate(state, 'claude', 'weekly', 91, STAMP_NOW))
  history = recordCurrentWeek(history, { workspaceId: '', state, services: SERVICES, now: WEDNESDAY })
  assert.equal(history.length, 2, 'same-week update must not add a snapshot')
  assert.equal(current().services.claude.quotas.weekly.value, 91)
  assert.notEqual(current().capturedAt, loadedAt)

  // resetAll
  state = deepFreeze(buildDefaultState())
  history = recordCurrentWeek(history, { workspaceId: '', state, services: SERVICES, now: FRIDAY })
  assert.equal(history.length, 2)
  assert.equal(
    current().services.claude.quotas.weekly.value,
    SERVICES.find((service) => service.id === 'claude').quotas.find((quota) => quota.id === 'weekly').value
  )
  assert.equal(current().services.claude.lastResetDate, null)

  // completed history untouched
  const kept = history.find((entry) => entry.weekKey === lastWeek.weekKey)
  assert.equal(kept.services.claude.quotas.weekly.value, 33)
})

test('a new week creates a second snapshot and leaves the previous week intact', () => {
  const state = buildDefaultState()
  let history = recordCurrentWeek([], { workspaceId: 'ws-1', state, services: SERVICES, now: FRIDAY })
  history = recordCurrentWeek(history, {
    workspaceId: 'ws-1',
    state: applyQuotaUpdate(state, 'claude', 'weekly', 5, STAMP_NOW),
    services: SERVICES,
    now: shiftLocalDays(FRIDAY, 7),
  })

  assert.equal(history.length, 2)
  assert.notEqual(history[0].weekKey, history[1].weekKey)
  assert.equal(history[0].services.claude.quotas.weekly.value, state.claude.weekly)
  assert.equal(history[1].services.claude.quotas.weekly.value, 5)
})

test('history is recorded locally without a workspace, then follows the workspace once it resolves', () => {
  const offline = recordCurrentWeek([], {
    workspaceId: '',
    state: applyQuotaUpdate(buildDefaultState(), 'claude', 'weekly', 64, STAMP_NOW),
    services: SERVICES,
    now: FRIDAY,
  })
  assert.equal(offline.length, 1)
  assert.equal(scopeHistory(offline, '').length, 1, 'visible while no workspace is known')

  const adopted = adoptLocalSnapshots(offline, 'ws-1', { now: FRIDAY })
  assert.equal(scopeHistory(adopted, 'ws-1').length, 1, 'still visible after the workspace resolves')
  assert.equal(scopeHistory(adopted, 'ws-1')[0].services.claude.quotas.weekly.value, 64)
  assert.equal(scopeHistory(adopted, '').length, 0, 'moved, not duplicated')
})
