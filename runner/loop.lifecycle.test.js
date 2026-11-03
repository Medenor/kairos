// T046: what happens while a run is in progress: hard stop, stop watcher (5 s), quota watcher (60 s), output
// limits, folder exclusivity and the evaluation interval. Time is manual: tests advance a fake clock and scheduler,
// the tool is a real child process (fake CLI) that is killed for real.
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { keyForLease, validateRunRecord } from '../src/surplus/records.js'
import { localAt, until, withWorld, writeHangingTool } from './loop.testkit.js'
import { prepareWorkdir } from './workdir.js'

const MINUTE = 60000
const SLOW = { sleepMs: 600000 }
const QUIET_WATCHERS = { limits: { stopWatcherSeconds: 3600, quotaWatcherSeconds: 3600 } }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Start a tick that will run a long tool and wait until the tool is really running.
async function startRun(w, loop) {
  const done = loop.tick()
  const spawned = await w.events.waitFor('spawned')
  await w.waitForCli(w.cli[w.serviceId === 'claude' ? 'claude' : 'codex'])
  return { done, spawned }
}

test('the hard stop kills the run at now plus the maximum duration', () =>
  withWorld({ cli: { claude: SLOW }, policy: (p) => { p.thresholds.maxRunMinutes = 30 }, configPatch: QUIET_WATCHERS }, async (w) => {
    const loop = w.makeLoop()
    const { done, spawned } = await startRun(w, loop)
    assert.equal(spawned.hardStopAt, new Date(localAt(14, 30)).toISOString())
    assert.equal(spawned.hardStopReason, 'timeout')

    await w.clock.advance(30 * MINUTE - 1000)
    await loop.settled()
    assert.equal(loop.status().activeRun.stopping, false, 'still within the maximum duration')

    await w.clock.advance(1000)
    const result = await done
    assert.equal(result.run.status, 'interrupted')
    assert.equal(result.run.failureReason.code, 'timeout')
    assert.equal(result.run.endedAt, new Date(localAt(14, 30)).toISOString())
    assert.equal(w.idea().payload.status, 'failed', 'the idea is retriable')
    assert.equal(validateRunRecord(w.run('run-1')).valid, true)
  }))

test('the hard stop is the protected hours start when it comes first', () =>
  withWorld({ start: localAt(20, 30), policy: (p) => { p.thresholds.maxRunMinutes = 120 }, cli: { claude: SLOW }, configPatch: QUIET_WATCHERS }, async (w) => {
    // A slow copy: the tool only starts at 21:30, so 23:00 (protected hours) comes before 21:30 + 120 min.
    const loop = w.makeLoop({ deps: { prepareWorkdir: (options) => { w.clock.set(localAt(21, 30)); return prepareWorkdir(options) } } })
    const { done, spawned } = await startRun(w, loop)
    assert.equal(spawned.hardStopAt, new Date(localAt(23, 0)).toISOString())
    assert.equal(spawned.hardStopReason, 'protected_hours')
    await w.clock.advance(90 * MINUTE)
    const result = await done
    assert.equal(result.run.failureReason.code, 'protected_hours')
    assert.equal(result.run.status, 'interrupted')
  }))

test('the hard stop is the start of the reset day when it comes first', () =>
  withWorld({
    start: localAt(22, 30),
    policy: (p) => { p.protectedHours = [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:30', end: '06:00' }] },
    cli: { claude: SLOW },
    configPatch: QUIET_WATCHERS,
  }, async (w) => {
    const loop = w.makeLoop({ deps: { prepareWorkdir: (options) => { w.clock.set(localAt(23, 10)); return prepareWorkdir(options) } } })
    const { done, spawned } = await startRun(w, loop)
    assert.equal(spawned.hardStopAt, new Date(localAt(0, 0, 1)).toISOString())
    assert.equal(spawned.hardStopReason, 'reset_day')
    await w.clock.advance(50 * MINUTE)
    const result = await done
    assert.equal(result.run.failureReason.code, 'reset_day')
  }))

test('SIGTERM first, SIGKILL ten seconds later for a tool that ignores SIGTERM', () =>
  withWorld({ cli: { claude: { ...SLOW, ignoreSigterm: true } }, policy: (p) => { p.thresholds.maxRunMinutes = 30 }, configPatch: QUIET_WATCHERS }, async (w) => {
    const loop = w.makeLoop()
    const { done, spawned } = await startRun(w, loop)
    let finished = false
    done.then(() => { finished = true })

    await w.clock.advance(30 * MINUTE) // SIGTERM is sent here
    await delay(300)
    assert.equal(alive(spawned.pid), true, 'the tool survived SIGTERM')
    assert.equal(finished, false)
    assert.ok(w.clock.pendingDelays().includes(10000), 'the kill timer is armed')

    await w.clock.advance(9999)
    await delay(100)
    assert.equal(alive(spawned.pid), true, 'still alive one millisecond before the grace period ends')

    await w.clock.advance(1)
    const result = await done
    assert.equal(alive(spawned.pid), false)
    assert.equal(result.run.status, 'interrupted')
    assert.equal(result.run.failureReason.code, 'timeout')
  }))

test('the stop watcher (5 s) and the quota watcher (60 s) are separate timers next to the hard stop', () =>
  withWorld({ cli: { claude: SLOW } }, async (w) => {
    assert.equal(w.config.limits.stopWatcherSeconds, 5)
    assert.equal(w.config.limits.quotaWatcherSeconds, 60)
    assert.equal(w.config.limits.killGraceSeconds, 10)
    const loop = w.makeLoop()
    const { done } = await startRun(w, loop)
    assert.deepEqual(w.clock.pendingDelays(), [5000, 60000, 60 * MINUTE])
    await loop.stop()
    await done
  }))

test('a global stop written to the control record ends the run within 5 s (SC-007)', () =>
  withWorld({ cli: { claude: { ...SLOW, ignoreSigterm: false } } }, async (w) => {
    const loop = w.makeLoop()
    const { done } = await startRun(w, loop)
    w.setControl(false)

    await w.clock.advance(4999)
    await loop.settled()
    assert.equal(loop.status().activeRun.stopping, false, 'the watcher has not fired yet')

    await w.clock.advance(1)
    const result = await done
    assert.equal(result.run.status, 'interrupted')
    assert.equal(result.run.failureReason.code, 'stopped_by_user')
    assert.ok(Date.parse(result.run.endedAt) - Date.parse(result.run.startedAt) <= 5000)
    assert.equal(w.idea().payload.status, 'failed')

    const next = await loop.tick()
    assert.equal(next.started, false)
    assert.equal(next.reason, 'global_stop', 'no new run until automatic runs are re-enabled')
    assert.equal(w.runs().length, 1)
  }))

test('a STOP file ends the run within 5 s', () =>
  withWorld({ cli: { claude: SLOW } }, async (w) => {
    const loop = w.makeLoop()
    const { done } = await startRun(w, loop)
    writeFileSync(w.paths.stop, '')
    await w.clock.advance(5000)
    const result = await done
    assert.equal(result.run.failureReason.code, 'stopped_by_user')
    assert.match(result.run.failureReason.message, /STOP/)
  }))

test('the stop watcher does not touch the lease or the quota rule; the quota watcher does, every 60 s', () =>
  withWorld({ cli: { claude: SLOW } }, async (w) => {
    const loop = w.makeLoop()
    const { done } = await startRun(w, loop)
    const leasePuts = () => w.putsTo(keyForLease()).length
    const before = leasePuts()
    await w.setWeeklyRemaining(15) // at the 20% reserve: only the quota watcher may act on it

    for (let seconds = 5; seconds < 60; seconds += 5) {
      await w.clock.advance(5000)
      await loop.settled()
    }
    assert.equal(loop.status().activeRun.stopping, false, 'the stop watcher ignores the quota')
    assert.equal(leasePuts(), before, 'no heartbeat from the 5 s watcher')

    await w.clock.advance(5000) // t = 60 s: the quota watcher fires
    const result = await done
    assert.equal(result.run.failureReason.code, 'quota_exhausted')
    assert.equal(leasePuts(), before + 1, 'heartbeat from the quota watcher')
  }))

test('quota at the reserve during a run stops it and keeps the partial output', () =>
  withWorld({}, async (w) => {
    const hanging = writeHangingTool(w.binDir, 'hanging-claude', 'partial draft')
    const loop = w.makeLoop({ config: { ...w.config, tools: { ...w.config.tools, claude: hanging } } })
    const done = loop.tick()
    await w.events.waitFor('spawned')
    await delay(300) // let the tool print before it is stopped
    await w.setWeeklyRemaining(20)
    await w.clock.advance(60000)
    const result = await done
    assert.equal(result.run.status, 'interrupted')
    assert.equal(result.run.failureReason.code, 'quota_exhausted')
    assert.equal(result.run.output, 'partial draft')
    assert.equal(validateRunRecord(w.run('run-1')).valid, true)
    assert.equal(w.idea().payload.status, 'failed')
  }))

test('losing the designation during a run stops it and exits with code 3', () =>
  withWorld({ cli: { claude: SLOW } }, async (w) => {
    const loop = w.makeLoop()
    const { done } = await startRun(w, loop)
    const current = w.fakeApi.find(keyForLease())
    w.putRouting(keyForLease(), { ...current.payload, designatedDeviceId: 'dev-b', designatedDeviceName: 'Desktop' })
    await w.clock.advance(60000)
    const result = await done
    assert.equal(result.terminal, true)
    assert.equal(result.exitCode, 3)
    assert.equal(result.run.status, 'interrupted')
    assert.equal(w.runs().length, 1)
  }))

test('output over 256 KB is truncated with truncated: true', () =>
  withWorld({ cli: { claude: { stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'é'.repeat(200000) }) } } }, async (w) => {
    const result = await w.makeLoop().tick()
    const run = w.run('run-1')
    assert.equal(result.run.status, 'completed')
    assert.equal(run.truncated, true)
    assert.ok(Buffer.byteLength(run.output) <= 256 * 1024)
    assert.ok(run.output.length > 100000)
    assert.equal(validateRunRecord(run).valid, true)
  }))

test('empty output is recorded as such', () =>
  withWorld({ cli: { claude: { stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '' }) } } }, async (w) => {
    await w.makeLoop().tick()
    const run = w.run('run-1')
    assert.equal(run.status, 'completed')
    assert.equal(run.output, '')
    assert.equal(run.truncated, false)
    assert.equal(run.proposal, null)
    assert.equal(validateRunRecord(run).valid, true)
  }))

test('a failing tool without output records a human-readable reason and leaves the idea retriable', () =>
  withWorld({ cli: { claude: { stdout: '', exitCode: 1 } } }, async (w) => {
    await w.makeLoop().tick()
    const run = w.run('run-1')
    assert.equal(run.status, 'failed')
    assert.match(run.failureReason.message, /exit code 1/)
    assert.equal(run.output, '')
    assert.equal(w.idea().payload.status, 'failed')
  }))

test('changes made in the copy are stored as a proposal and the original stays untouched', () =>
  withWorld({ cli: { claude: { writeFiles: { 'notes.md': 'new file\n' } } } }, async (w) => {
    await w.makeLoop().tick()
    const run = w.run('run-1')
    assert.equal(run.proposal.files, 1)
    assert.match(run.proposal.diff, /notes\.md/)
    assert.equal(run.localRunDir, `${w.baseDir}/runs/run-1`)
    await assert.rejects(() => import('node:fs/promises').then((fs) => fs.access(`${w.projectsDir}/proj-a/notes.md`)))
  }))

test('two ideas on the same folder never run concurrently, each with its own copy', () =>
  withWorld({ cli: { claude: SLOW }, ideas: [{ id: 'a', folder: 'shared' }, { id: 'b', folder: 'shared', makeFolder: false }] }, async (w) => {
    const loop = w.makeLoop()
    const { done } = await startRun(w, loop)
    const second = await loop.tick()
    assert.equal(second.started, false)
    assert.equal(second.reason, 'run_active')
    assert.equal(w.cli.claude.calls().length, 1)
    assert.deepEqual([w.idea('a').payload.status, w.idea('b').payload.status], ['running', 'waiting'])

    await loop.stop() // stops the first run and releases the lease
    const first = await done
    assert.equal(first.run.failureReason.code, 'stopped_by_user')

    w.cli.claude.setBehavior({ sleepMs: 0 })
    const next = w.makeLoop()
    const result = await next.tick()
    assert.equal(result.started, true)
    assert.equal(result.ideaId, 'b')
    assert.notEqual(w.run('run-1').localRunDir, w.run('run-2').localRunDir)
    assert.equal(w.runs().filter((r) => r.status === 'running').length, 0)
  }))

test('the evaluation interval defaults to 15 minutes and re-evaluates on that schedule (FR-033)', () =>
  withWorld({ control: false }, async (w) => {
    const loop = w.makeLoop()
    assert.equal(loop.intervalMs, 15 * MINUTE)
    const finished = loop.start()
    await w.events.waitFor('tick', 1)
    await until(() => w.clock.pendingDelays().includes(15 * MINUTE), { label: 'the interval timer' })

    await w.clock.advance(15 * MINUTE - 1)
    await delay(100)
    assert.equal(w.events.of('tick').length, 1)
    await w.clock.advance(1)
    await w.events.waitFor('tick', 2)

    const exit = await loop.stop()
    assert.equal(exit.exitCode, 0)
    assert.equal((await finished).reason, 'stopped')
  }))

test('the evaluation interval is configurable', () =>
  withWorld({ control: false, configPatch: { limits: { evalIntervalMinutes: 5 } } }, async (w) => {
    const loop = w.makeLoop()
    assert.equal(loop.intervalMs, 5 * MINUTE)
    const finished = loop.start()
    await w.events.waitFor('tick', 1)
    await until(() => w.clock.pendingDelays().includes(5 * MINUTE), { label: 'the interval timer' })
    assert.ok(!w.clock.pendingDelays().includes(15 * MINUTE))
    await w.clock.advance(5 * MINUTE)
    await w.events.waitFor('tick', 2)
    await loop.stop()
    await finished
  }))
