import test from 'node:test'
import assert from 'node:assert/strict'
import { SERVICES } from '../data/services.js'
import { applyServerRecords, buildDefaultState, scopeHistory } from '../stateTransitions.js'
import { createWeeklySnapshot } from '../utils.js'
import { buildWeeklyHistoryMigrationRecords } from './localExport.js'

function snapshot(workspaceId, isoDate, claudeWeekly = 50) {
  const state = buildDefaultState()
  state.claude.weekly = claudeWeekly
  return createWeeklySnapshot({ workspaceId, state, services: SERVICES, now: new Date(isoDate) })
}

test('local snapshots are re-scoped to the target workspace for migration', () => {
  const history = [snapshot('local', '2026-04-17T12:00:00'), snapshot('local', '2026-04-24T12:00:00')]

  const records = buildWeeklyHistoryMigrationRecords(history, 'ws-1')

  assert.equal(records.length, 2)
  for (const record of records) {
    assert.equal(record.record_type, 'snapshot')
    assert.equal(record.logical_key, `weekly-history:${record.payload.weekKey}`)
    assert.equal(record.payload.workspaceId, 'ws-1')
  }
  assert.equal(history[0].workspaceId, 'local', 'source history is not mutated')
})

test('snapshots owned by other workspaces are never exported', () => {
  const history = [
    snapshot('local', '2026-04-24T12:00:00'),
    snapshot('ws-other', '2026-04-17T12:00:00'),
    snapshot('ws-1', '2026-04-10T12:00:00'),
  ]

  const records = buildWeeklyHistoryMigrationRecords(history, 'ws-1')

  assert.equal(records.length, 2)
  assert.ok(records.every((record) => record.payload.workspaceId === 'ws-1'))
})

test('one record per week: the most recently captured snapshot wins', () => {
  const older = snapshot('local', '2026-04-24T09:00:00', 10)
  const newer = snapshot('ws-1', '2026-04-24T17:00:00', 20)

  const records = buildWeeklyHistoryMigrationRecords([newer, older], 'ws-1')

  assert.equal(records.length, 1)
  assert.equal(records[0].payload.services.claude.quotas.weekly.value, 20)
})

test('no workspace means nothing is exported', () => {
  assert.deepEqual(buildWeeklyHistoryMigrationRecords([snapshot('local', '2026-04-24T12:00:00')], ''), [])
})

test('migrated snapshots appear in the workspace-scoped history after sync', () => {
  const records = buildWeeklyHistoryMigrationRecords([snapshot('local', '2026-04-24T12:00:00', 42)], 'ws-1')
  const items = records.map((record, index) => ({ ...record, id: `r${index}`, version: 1, workspace_id: 'ws-1' }))

  const next = applyServerRecords(
    { state: buildDefaultState(), recordIndex: {}, weeklyHistory: [], historyIndex: {} },
    items,
    { now: new Date('2026-04-24T12:00:00') }
  )

  const visible = scopeHistory(next.weeklyHistory, 'ws-1')
  assert.equal(visible.length, 1)
  assert.equal(visible[0].services.claude.quotas.weekly.value, 42)
})
