import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendStart, appendEnd, appendEvaluationSkipped, readJournal, unfinishedRuns } from './journal.js'
import { runnerPaths } from './config.js'

const TMP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-tmp')
const created = []
function tempBase() {
  mkdirSync(TMP_ROOT, { recursive: true })
  const dir = mkdtempSync(join(TMP_ROOT, 'journal-'))
  created.push(dir)
  return join(dir, '.kairos-runner')
}
test.after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

const start = (runId, at = '2026-11-03T10:00:00.000Z') => ({ runId, ideaId: `idea-${runId}`, serviceId: 'claude', at, tool: 'claude', cwd: '/w' })

test('an empty or missing journal has no entries and no unfinished runs', () => {
  const base = tempBase()
  assert.deepEqual(readJournal(base), [])
  assert.deepEqual(unfinishedRuns(base), [])
})

test('start and end entries are appended as JSON lines with mode 0600 in a 0700 directory', () => {
  const base = tempBase()
  appendStart(base, start('r1'))
  appendEnd(base, { runId: 'r1', status: 'completed', at: '2026-11-03T10:30:00.000Z' })
  const file = runnerPaths(base).journal
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n')
  assert.equal(lines.length, 2)
  assert.deepEqual(JSON.parse(lines[0]), { type: 'start', runId: 'r1', ideaId: 'idea-r1', serviceId: 'claude', at: '2026-11-03T10:00:00.000Z', tool: 'claude', cwd: '/w', pid: null })
  assert.deepEqual(JSON.parse(lines[1]), { type: 'end', runId: 'r1', status: 'completed', at: '2026-11-03T10:30:00.000Z', failureReason: null })
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.equal(statSync(base).mode & 0o777, 0o700)
})

test('appending never rewrites earlier entries', () => {
  const base = tempBase()
  appendStart(base, start('r1'))
  const before = readFileSync(runnerPaths(base).journal, 'utf8')
  appendStart(base, start('r2'))
  appendEnd(base, { runId: 'r1', status: 'failed', failureReason: 'timeout', at: '2026-11-03T11:00:00.000Z' })
  assert.ok(readFileSync(runnerPaths(base).journal, 'utf8').startsWith(before))
})

test('unfinishedRuns returns starts without an end, oldest first, including an interrupted one', () => {
  const base = tempBase()
  appendStart(base, start('r1', '2026-11-03T08:00:00.000Z'))
  appendEnd(base, { runId: 'r1', status: 'completed', at: '2026-11-03T08:30:00.000Z' })
  appendStart(base, start('r2', '2026-11-03T09:00:00.000Z'))
  appendStart(base, start('r3', '2026-11-03T10:00:00.000Z'))
  appendEvaluationSkipped(base, { at: '2026-11-03T10:15:00.000Z', reason: 'billing_guard' })
  assert.deepEqual(unfinishedRuns(base).map((e) => e.runId), ['r2', 'r3'])
  appendEnd(base, { runId: 'r2', status: 'interrupted', failureReason: 'interrupted', at: '2026-11-03T12:00:00.000Z' })
  assert.deepEqual(unfinishedRuns(base).map((e) => e.runId), ['r3'])
  assert.equal(unfinishedRuns(base)[0].ideaId, 'idea-r3')
})

test('evaluation-skipped lines record the reason and are not runs', () => {
  const base = tempBase()
  const entry = appendEvaluationSkipped(base, { at: '2026-11-03T10:15:00.000Z', reason: 'not_approved', ideaId: 'i-1', serviceId: 'claude' })
  assert.deepEqual(entry, { type: 'evaluation-skipped', at: '2026-11-03T10:15:00.000Z', reason: 'not_approved', ideaId: 'i-1', serviceId: 'claude' })
  assert.deepEqual(readJournal(base), [entry])
  assert.deepEqual(unfinishedRuns(base), [])
})

test('a truncated last line and foreign lines are ignored, later appends still work', () => {
  const base = tempBase()
  appendStart(base, start('r1'))
  appendFileSync(runnerPaths(base).journal, '{"type":"start","runId":"r2","idea')
  appendFileSync(runnerPaths(base).journal, '\n{"type":"other"}\n\n')
  assert.deepEqual(unfinishedRuns(base).map((e) => e.runId), ['r1'])
  appendEnd(base, { runId: 'r1', status: 'completed', at: '2026-11-03T10:30:00.000Z' })
  assert.deepEqual(unfinishedRuns(base), [])
})

test('entries without required fields are rejected and nothing is written', () => {
  const base = tempBase()
  assert.throws(() => appendStart(base, { runId: 'r1', ideaId: 'i', serviceId: 'claude' }), TypeError)
  assert.throws(() => appendEnd(base, { runId: 'r1', at: '2026-11-03T10:00:00.000Z' }), TypeError)
  assert.throws(() => appendEvaluationSkipped(base, { at: '2026-11-03T10:00:00.000Z' }), TypeError)
  assert.deepEqual(readJournal(base), [])
})
