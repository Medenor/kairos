// T045: the loop starts exactly one run when every condition holds, and nothing when any single guardrail fails.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cycleRecordKey, ideaKey, keyForLease, validateRunRecord } from '../src/surplus/records.js'
import { CLAUDE_ID, localAt, withWorld } from './loop.testkit.js'
import { prepareWorkdir } from './workdir.js'

const KEY_LEASE = keyForLease()

test('exactly one run starts when every condition holds and its outcome is recorded', () =>
  withWorld({}, async (w) => {
    const loop = w.makeLoop()
    const result = await loop.tick()

    assert.equal(result.started, true)
    assert.equal(result.run.status, 'completed')
    assert.equal(w.cli.claude.calls().length, 1, 'the tool started once')
    const [call] = w.cli.claude.calls()
    assert.ok(call.cwd.startsWith(join(w.baseDir, 'runs', 'run-1')), 'the tool ran in the disposable copy')
    assert.equal(readFileSync(join(w.projectsDir, 'proj-a', 'README.md'), 'utf8'), 'hello\n')

    const runs = w.runs()
    assert.equal(runs.length, 1)
    assert.equal(validateRunRecord(runs[0]).valid, true)
    assert.equal(runs[0].output, 'Draft result')
    assert.equal(runs[0].truncated, false)
    assert.equal(runs[0].mode, 'auto')
    assert.equal(runs[0].cycleKey, `${w.serviceId}:2026-11-04`)
    assert.equal(runs[0].ideaSnapshot.resolvedFolder, join(w.projectsDir, 'proj-a'))
    assert.equal(runs[0].estimatedCostPct, 8)
    assert.equal(runs[0].decisionInputs.selected.ideaId, 'idea-a')

    const idea = w.idea().payload
    assert.equal(idea.status, 'completed')
    assert.equal(idea.lastRunId, 'run-1')
    assert.equal(idea.serviceId, w.serviceId)

    assert.equal(w.cycle('2026-11-04').payload.lastWeeklyRemainingPct, 60)
    assert.deepEqual(w.journal().map((e) => `${e.type}:${e.runId}`), ['start:run-1', 'end:run-1'])

    const again = await loop.tick()
    assert.equal(again.started, false, 'a completed idea is not started again')
    assert.equal(w.cli.claude.calls().length, 1)
    assert.equal(w.runs().length, 1)
  }))

test('the tool is started with the allowlisted environment only', () =>
  withWorld({ env: { SECRET_TOKEN: 'do-not-forward' } }, async (w) => {
    await w.makeLoop().tick()
    const [call] = w.cli.claude.calls()
    assert.equal(call.env.SECRET_TOKEN, undefined)
    assert.equal(call.env.HOME, w.homeDir)
  }))

const FAILURES = [
  { name: 'stale weekly data', opts: { quota: { weeklyAgeHours: 13 } }, reason: 'not_eligible', failedRules: ['R3'] },
  { name: 'stale session data', opts: { quota: { sessionAgeHours: 6 } }, reason: 'not_eligible', failedRules: ['R5'] },
  { name: 'protected hours would be reached', opts: { start: localAt(22, 30) }, reason: 'not_eligible', failedRules: ['R6'] },
  { name: 'weekly quota at the reserve', opts: { quota: { weeklyRemaining: 20 } }, reason: 'not_eligible', failedRules: ['R4'] },
  { name: 'reset date not set', opts: { quota: { lastReset: null } }, reason: 'not_eligible', failedRules: ['R2'] },
  { name: 'service surplus switched off', opts: { policy: (p) => { p.providers[CLAUDE_ID].surplusEnabled = false } }, reason: 'surplus_disabled' },
  { name: 'idea not approved on this runner', opts: { ideas: [{ approved: false }] }, reason: 'not_approved' },
  { name: 'idea words changed after approval', opts: { ideas: [{}] }, reason: 'not_approved', edit: true },
  { name: 'working folder missing', opts: { ideas: [{ folder: 'nowhere', makeFolder: false }] }, reason: 'folder_not_found' },
  { name: 'working folder refused (system location)', opts: { ideas: [{ workingFolder: '/usr/local' }] }, reason: 'folder_refused' },
  { name: 'relative folder without a projects base folder', opts: { configPatch: { projectsBaseFolder: null } }, reason: 'folder_missing_base' },
  { name: 'billing guard: API key in the environment', opts: { realPreflight: true, env: { ANTHROPIC_API_KEY: 'x' } }, reason: 'billing_guard' },
  { name: 'billing guard: tool signed in with an API key', opts: { realPreflight: true, cli: { claude: { auth: { mode: 'api_key' } } } }, reason: 'billing_guard' },
  { name: 'tool missing', opts: { realPreflight: true, configPatch: { tools: { claude: '/nonexistent/claude' } } }, reason: 'tool_missing' },
  { name: 'global stop through the control record', opts: { control: false }, reason: 'global_stop' },
  { name: 'no control record (automatic runs never enabled)', opts: { control: null }, reason: 'global_stop' },
  { name: 'STOP file', opts: { stopFile: true }, reason: 'stop_file' },
  { name: 'provider not in allowProviders', opts: { configPatch: { allowProviders: [] } }, reason: 'service_not_allowed' },
  { name: 'automatic runs off for the service', opts: { policy: (p) => { p.providers[CLAUDE_ID].autoRunEnabled = false } }, reason: 'auto_run_disabled' },
  { name: 'disclosuresAckAt missing', opts: { policy: (p) => { p.providers[CLAUDE_ID].disclosuresAckAt = null } }, reason: 'disclosures_missing' },
  { name: 'shared mode off (no policy in the workspace)', opts: { seedPolicy: false }, reason: 'no_shared_mode' },
]

for (const failure of FAILURES) {
  test(`one failing guardrail prevents any run and records the reason: ${failure.name}`, () =>
    withWorld(failure.opts, async (w) => {
      if (failure.edit) {
        const record = w.idea()
        w.putRouting(ideaKey('idea-a'), { ...record.payload, text: 'A different instruction', contentVersion: 2 })
      }
      const before = w.idea()?.version
      const result = await w.makeLoop().tick()

      assert.equal(result.started, false)
      assert.equal(result.reason, failure.reason, result.detail)
      if (failure.failedRules) assert.deepEqual(result.failedRules, failure.failedRules)
      assert.ok(result.detail.length > 0)
      assert.equal(w.runs().length, 0, 'no run record')
      assert.equal(w.cli.claude.calls().filter((c) => !c.argv.includes('--help') && c.argv[0] !== 'auth').length, 0, 'the tool never ran')
      assert.equal(w.journal().filter((e) => e.type === 'start').length, 0)
      assert.equal(w.skips().at(-1)?.reason, failure.reason, 'the reason is written to the journal')
      const idea = w.idea()
      assert.equal(idea.version, before, 'the idea record was not touched')
      assert.equal(idea.payload.status, 'waiting')
    }))
}

test('shared mode off in the runner config exits with code 2 and starts nothing', () =>
  withWorld({}, async (w) => {
    const result = await w.makeLoop({ config: { ...w.config, workspaceId: '' } }).tick()
    assert.equal(result.terminal, true)
    assert.equal(result.exitCode, 2)
    assert.equal(result.reason, 'no_shared_mode')
    assert.equal(w.runs().length, 0)
  }))

test('a device that is not the designated runner exits with code 3 and starts nothing', () =>
  withWorld({}, async (w) => {
    const now = w.clock.now().toISOString()
    w.putRouting(KEY_LEASE, {
      designatedDeviceId: 'dev-b', designatedDeviceName: 'Desktop', designatedAt: now,
      deviceId: 'dev-b', deviceName: 'Desktop', startedAt: now, heartbeatAt: new Date(0).toISOString(), leaseSeconds: 180, approved: {},
    })
    const result = await w.makeLoop().tick()
    assert.equal(result.terminal, true)
    assert.equal(result.exitCode, 3)
    assert.equal(result.reason, 'not_designated')
    assert.equal(w.runs().length, 0)
    assert.equal(w.idea().payload.status, 'waiting')
    assert.equal(w.putsTo(ideaKey('idea-a')).length, 0)
  }))

test('a tick that begins after the reset day started starts nothing and replays nothing', () =>
  withWorld({}, async (w) => {
    // The runner was down during the window; it comes back on the reset day (2026-11-04) and the days after.
    for (const when of [localAt(0, 5, 1), localAt(9, 0, 1), localAt(9, 0, 2)]) {
      w.clock.set(when)
      const loop = w.makeLoop()
      const result = await loop.tick()
      assert.equal(result.started, false)
      assert.equal(result.reason, 'not_eligible')
      assert.ok(result.failedRules.includes('R2'), `R2 fails at ${when.toISOString()}`)
    }
    assert.equal(w.runs().length, 0)
    assert.equal(w.cli.claude.calls().length, 0)
    assert.equal(w.idea().payload.status, 'waiting')
    assert.equal(w.records('cycle:').length, 0, 'no cycle record is written for a run that never happened')
  }))

test('evaluation inputs are recorded verbatim in the skip result for the status output', () =>
  withWorld({ quota: { weeklyAgeHours: 13 } }, async (w) => {
    const loop = w.makeLoop()
    const result = await loop.tick()
    assert.equal(result.evaluation.rulesetVersion, 2)
    assert.equal(loop.status().lastTick.reason, 'not_eligible')
    const status = JSON.parse(readFileSync(w.paths.baseDir + '/status.json', 'utf8'))
    assert.equal(status.lastTick.reason, 'not_eligible')
    assert.equal(status.activeRun, null)
  }))

test('the codex tool and the service keyed records are used for chatgpt', () =>
  withWorld({ serviceId: 'chatgpt', configPatch: { allowCodexAuto: true } }, async (w) => {
    const result = await w.makeLoop().tick()
    assert.equal(result.started, true)
    assert.equal(w.cli.codex.calls().length, 1)
    assert.equal(w.cli.claude.calls().length, 0)
    assert.equal(w.run('run-1').serviceId, w.serviceId)
    assert.ok(w.cycle('2026-11-04'), 'cycle record keyed by the service')
    assert.equal(cycleRecordKey(w.serviceId, '2026-11-04'), `cycle:${w.serviceId}:2026-11-04`)
  }))

test('codex automatic runs are skipped by default: reads are not contained', () =>
  withWorld({ serviceId: 'chatgpt' }, async (w) => {
    const result = await w.makeLoop().tick()
    assert.equal(result.started, false)
    assert.equal(result.reason, 'codex_reads_uncontained')
    assert.equal(w.cli.codex.calls().length, 0)
    assert.equal(w.idea().payload.status, 'waiting')
  }))

test('a STOP file written after a run ends later ticks without evaluating', () =>
  withWorld({}, async (w) => {
    const loop = w.makeLoop()
    assert.equal((await loop.tick()).started, true)
    writeFileSync(w.paths.stop, '')
    const result = await loop.tick()
    assert.equal(result.reason, 'stop_file')
    assert.equal(w.runs().length, 1)
  }))

for (const { name, duringCopy, failureReason } of [
  { name: 'a STOP file', duringCopy: (w) => writeFileSync(w.paths.stop, ''), failureReason: 'stopped_by_user' },
  { name: 'the global stop', duringCopy: (w) => w.setControl(false), failureReason: 'stopped_by_user' },
  { name: 'protected hours', duringCopy: (w) => w.setPolicy((policy) => { policy.protectedHours = [{ days: [0, 1, 2, 3, 4, 5, 6], start: '14:00', end: '15:00' }] }), failureReason: 'protected_hours' },
  { name: 'the reset day', duringCopy: (w) => w.clock.set(localAt(6, 1, 1)), failureReason: 'reset_day' },
]) {
  test(`a guardrail activated while copying prevents the tool from starting: ${name}`, () =>
    withWorld({}, async (w) => {
      const loop = w.makeLoop({
        deps: {
          prepareWorkdir: async (options) => {
            duringCopy(w)
            return prepareWorkdir(options)
          },
        },
      })
      const result = await loop.tick()

      assert.equal(result.started, true)
      assert.equal(result.run.status, 'interrupted')
      assert.equal(result.run.failureReason.code, failureReason)
      assert.equal(w.cli.claude.calls().length, 0, 'the tool was never spawned')
    }))
}
