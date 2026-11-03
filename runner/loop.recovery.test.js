// T047: claim compare-and-set, one run per workspace, crash recovery from the journal, and the once-per-cycle retry rule.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { cycleRecordKey, ideaKey, keyForLease, runKey, validateRunRecord } from '../src/surplus/records.js'
import { appendStart, unfinishedRuns } from './journal.js'
import { withWorld } from './loop.testkit.js'

const SLOW = { sleepMs: 600000 }
const LEASE_SECONDS = 180

// A child that never exits: the runner "crashes" while it is running because nothing ever finalises the run.
function stuckSpawn() {
  return () => Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {}, pid: undefined })
}

// Leave the store as a runner that died mid-run would: run and idea `running`, journal start, live lease.
async function crashMidRun(w) {
  const first = w.makeLoop({ spawn: stuckSpawn() })
  first.tick() // never settles
  await w.events.waitFor('spawned')
  assert.equal(w.run('run-1').status, 'running')
  assert.equal(w.idea().payload.status, 'running')
  assert.deepEqual(unfinishedRuns(w.baseDir).map((e) => e.runId), ['run-1'])
  return first
}

const restartAfterLeaseExpiry = (w) => {
  w.clock.set(new Date(w.clock.now().getTime() + (LEASE_SECONDS + 1) * 1000))
  return w.makeLoop()
}

test('the claim is compare-and-set: a 409 starts nothing and a later tick can still run the idea', () =>
  withWorld({}, async (w) => {
    const record = w.idea()
    let bumped = false
    const racing = {
      ...w.client,
      updateRecord: async (id, options) => {
        if (!bumped && id === record.id) {
          bumped = true
          w.putRouting(ideaKey('idea-a'), { ...record.payload, priority: 'high' }) // another client wins the race
        }
        return w.client.updateRecord(id, options)
      },
    }
    const loop = w.makeLoop({ api: racing })
    const result = await loop.tick()
    assert.equal(result.started, false)
    assert.equal(result.reason, 'claim_conflict')
    assert.equal(w.runs().length, 0)
    assert.equal(w.postsTo(runKey('run-1')).length, 0)
    assert.equal(w.journal().filter((e) => e.type === 'start').length, 0)
    assert.equal(w.cli.claude.calls().length, 0)
    assert.equal(w.idea().payload.status, 'waiting')
    assert.equal(w.idea().payload.priority, 'high', 'the other client change is kept')

    const retry = await loop.tick()
    assert.equal(retry.started, true)
    assert.equal(w.runs().length, 1)
  }))

test('at most one run per workspace: a concurrent tick starts nothing', () =>
  withWorld({ cli: { claude: SLOW }, ideas: [{ id: 'a', folder: 'one' }, { id: 'b', folder: 'two' }] }, async (w) => {
    const loop = w.makeLoop()
    const done = loop.tick()
    await w.events.waitFor('spawned')
    const second = await loop.tick()
    assert.equal(second.started, false)
    assert.equal(second.reason, 'run_active')
    assert.equal(w.runs().filter((r) => r.status === 'running').length, 1)
    assert.equal(w.postsTo(runKey('run-2')).length, 0)
    await loop.stop()
    await done
  }))

test('at most one run per workspace: a second runner process of the same device exits with code 3', () =>
  withWorld({ cli: { claude: SLOW } }, async (w) => {
    const first = w.makeLoop()
    const done = first.tick()
    await w.events.waitFor('spawned')
    const second = await w.makeLoop().tick()
    assert.equal(second.terminal, true)
    assert.equal(second.exitCode, 3)
    assert.equal(second.reason, 'lease_held')
    assert.equal(w.runs().length, 1)
    await first.stop()
    await done
  }))

test('a heartbeat that finds another device designated ends the loop with code 3', () =>
  withWorld({ control: false }, async (w) => {
    const loop = w.makeLoop()
    assert.equal((await loop.tick()).reason, 'global_stop')
    const current = w.fakeApi.find(keyForLease())
    w.putRouting(keyForLease(), { ...current.payload, designatedDeviceId: 'dev-b' })
    const result = await loop.tick()
    assert.equal(result.terminal, true)
    assert.equal(result.exitCode, 3)
    assert.equal((await loop.tick()).terminal, true, 'the loop stays ended')
  }))

test('a restart after a crash finalises the unfinished run as interrupted, once, and does not start the idea again', () =>
  withWorld({ cli: { claude: SLOW } }, async (w) => {
    await crashMidRun(w)
    const restarted = restartAfterLeaseExpiry(w)
    const result = await restarted.tick()

    const run = w.run('run-1')
    assert.equal(run.status, 'interrupted')
    assert.equal(run.failureReason.code, 'interrupted')
    assert.equal(run.endedAt, w.clock.now().toISOString())
    assert.equal(validateRunRecord(run).valid, true)
    assert.equal(w.putsTo(runKey('run-1')).length, 1, 'the run record is rewritten exactly once')
    assert.equal(w.idea().payload.status, 'failed', 'the idea is back in a retriable state')
    assert.equal(w.idea().payload.lastRunId, 'run-1')
    assert.deepEqual(unfinishedRuns(w.baseDir), [])
    const end = w.journal().find((e) => e.type === 'end')
    assert.deepEqual({ runId: end.runId, status: end.status, failureReason: end.failureReason }, { runId: 'run-1', status: 'interrupted', failureReason: 'interrupted' })

    assert.equal(result.started, false, 'the interrupted idea is not started again')
    assert.equal(w.runs().length, 1)
    assert.equal(w.cli.claude.calls().length, 0)

    // Another restart finds nothing to recover and writes nothing more.
    const again = restartAfterLeaseExpiry(w)
    await again.tick()
    assert.equal(w.putsTo(runKey('run-1')).length, 1)
    assert.equal(w.journal().filter((e) => e.type === 'end').length, 1)
  }))

test('a requeued interrupted idea is not retried automatically in the same reset cycle (FR-018)', () =>
  withWorld({ cli: { claude: SLOW } }, async (w) => {
    await crashMidRun(w)
    const restarted = restartAfterLeaseExpiry(w)
    await restarted.tick()
    w.putRouting(ideaKey('idea-a'), { ...w.idea().payload, status: 'waiting', serviceId: null })

    const result = await restarted.tick()
    assert.equal(result.started, false)
    assert.equal(result.reason, 'retry_used')
    assert.equal(w.runs().length, 1)
    assert.equal(w.cli.claude.calls().length, 0)
  }))

test('a failed idea is not retried twice in the same cycle but runs again in the next cycle (FR-018)', () =>
  withWorld({ cli: { claude: { stdout: 'boom', exitCode: 1 } } }, async (w) => {
    const loop = w.makeLoop()
    assert.equal((await loop.tick()).run.status, 'failed')
    const requeue = () => w.putRouting(ideaKey('idea-a'), { ...w.idea().payload, status: 'waiting', serviceId: null })

    requeue()
    const same = await loop.tick()
    assert.equal(same.started, false)
    assert.equal(same.reason, 'retry_used')
    assert.equal(w.cli.claude.calls().length, 1)

    // The reset date moves on (a new cycle): the idea may run again.
    w.fakeApi.records.forEach((record) => {
      if (record.logical_key === 'claude:__last_reset_date') {
        record.payload = { value: '2026-10-29' }
        record.version += 1
        record.updated_at = new Date(Date.now() + 1000).toISOString()
      }
    })
    const next = await loop.tick()
    assert.equal(next.started, true)
    assert.equal(w.run('run-2').cycleKey, 'claude:2026-11-05')
  }))

test('a crash between the idea claim and the run record returns the idea to waiting', () =>
  withWorld({ ideas: [{ status: 'running' }] }, async (w) => {
    w.putRouting(ideaKey('idea-a'), { ...w.idea().payload, serviceId: 'claude', lastRunId: 'run-9' })
    const result = await w.makeLoop().tick()
    assert.equal(w.runs().length, result.started ? 1 : 0)
    assert.equal(result.started, true, 'nothing had started, so the idea is runnable again')
    assert.equal(w.run('run-1').ideaId, 'idea-a')
  }))

test('a crash after the run was finalised but before the idea update makes the idea follow its run', () =>
  withWorld({ cli: { claude: SLOW } }, async (w) => {
    await crashMidRun(w)
    const run = w.run('run-1')
    const record = w.fakeApi.find(runKey('run-1'))
    w.putRouting(runKey('run-1'), { ...run, status: 'completed', endedAt: w.clock.now().toISOString(), output: 'done' })
    assert.equal(record.id, w.fakeApi.find(runKey('run-1')).id)
    const restarted = restartAfterLeaseExpiry(w)
    await restarted.tick()
    assert.equal(w.run('run-1').status, 'completed', 'a finalised run is never rewritten')
    assert.equal(w.putsTo(runKey('run-1')).length, 0)
    assert.equal(w.idea().payload.status, 'completed')
    assert.deepEqual(unfinishedRuns(w.baseDir), [], 'the journal entry is closed')
  }))

test('a journal start with no run record (crash before the POST) is closed as interrupted', () =>
  withWorld({}, async (w) => {
    appendStart(w.baseDir, { runId: 'run-7', ideaId: 'idea-a', serviceId: 'claude', at: w.clock.now().toISOString(), tool: 'claude' })
    const result = await w.makeLoop({ lease: w.makeLease() }).tick()
    assert.deepEqual(unfinishedRuns(w.baseDir), [])
    assert.equal(w.journal().find((e) => e.type === 'end').status, 'interrupted')
    assert.equal(result.started, true)
  }))

test('the run record is written once as running and rewritten exactly once; idea, cycle and journal follow', () =>
  withWorld({}, async (w) => {
    const result = await w.makeLoop().tick()
    assert.equal(result.run.status, 'completed')

    const posts = w.postsTo(runKey('run-1'))
    assert.equal(posts.length, 1)
    assert.equal(posts[0].body.payload.status, 'running')
    assert.equal(posts[0].body.payload.endedAt, null)
    const puts = w.putsTo(runKey('run-1'))
    assert.equal(puts.length, 1)
    assert.equal(puts[0].body.payload.status, 'completed')
    assert.equal(puts[0].body.payload.output, 'Draft result')

    assert.deepEqual(w.putsTo(ideaKey('idea-a')).map((r) => r.body.payload.status), ['running', 'completed'])
    assert.equal(w.postsTo(cycleRecordKey('claude', '2026-11-04')).length, 1)
    assert.deepEqual(w.journal().map((e) => e.type), ['start', 'end'])
    assert.equal(w.journal()[1].status, 'completed')
  }))

test('a run that needs information ends as needs_input and flags the idea', () =>
  withWorld({ cli: { claude: { stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'NEEDS_INPUT: which audience?' }) } } }, async (w) => {
    await w.makeLoop().tick()
    const run = w.run('run-1')
    assert.equal(run.status, 'needs_input')
    assert.equal(run.failureReason, null)
    assert.equal(run.output, 'which audience?')
    assert.equal(w.idea().payload.status, 'needs_input')
  }))

test('a tool that cannot be started fails the run with tool_missing and finalises it once', () =>
  withWorld({ configPatch: { tools: { claude: '/nonexistent/claude' } } }, async (w) => {
    const result = await w.makeLoop().tick()
    assert.equal(result.started, true)
    const run = w.run('run-1')
    assert.equal(run.status, 'failed')
    assert.equal(run.failureReason.code, 'tool_missing')
    assert.equal(run.estimatedCostPct, 0)
    assert.equal(w.putsTo(runKey('run-1')).length, 1)
    assert.equal(w.idea().payload.status, 'failed')
  }))

test('a disposable copy that cannot be made fails the run with folder_error before any tool starts', () =>
  withWorld({}, async (w) => {
    const loop = w.makeLoop({ deps: { prepareWorkdir: async () => ({ ok: false, code: 'copy_failed' }) } })
    await loop.tick()
    const run = w.run('run-1')
    assert.equal(run.status, 'failed')
    assert.equal(run.failureReason.code, 'folder_error')
    assert.equal(run.localRunDir, null)
    assert.equal(w.cli.claude.calls().length, 0)
    assert.deepEqual(w.journal().map((e) => e.type), ['start', 'end'])
  }))
