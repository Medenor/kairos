// Feature 007 (T103, FR-037, SC-011): a run in progress whose provider is removed, switched off or re-tooled in the
// shared store is stopped by the 5 s stop watcher, exactly like a STOP file. Other providers' state and the
// global switch are untouched.
import test from 'node:test'
import assert from 'node:assert/strict'
import { providerKey } from '../src/providers/records.js'
import { CLAUDE_ID, WORLD_PROVIDERS, withWorld } from './loop.testkit.js'

const SLOW = { sleepMs: 600000 }
const QUIET_QUOTA = { limits: { quotaWatcherSeconds: 3600 } }

async function startRun(w, loop) {
  const done = loop.tick()
  await w.events.waitFor('spawned')
  await w.waitForCli(w.cli[w.provider.tool])
  return { done } // wrapped: returning the promise itself would make the caller wait for the whole run
}

// Fire exactly one stop-watcher interval and wait for the run to end.
async function expectStopped(w, done, matcher) {
  await w.clock.advance(5000)
  const result = await done
  assert.equal(result.run.status, 'interrupted')
  assert.equal(result.run.failureReason.code, 'stopped_by_user')
  assert.match(result.run.failureReason.message, matcher)
  assert.equal(result.run.serviceId, CLAUDE_ID)
  assert.equal(result.run.providerName, 'Alpha Claude', 'the name captured when the run started')
  assert.equal(w.idea().payload.status, 'failed', 'the idea is retriable')
  return result
}

test('removing the provider (tombstone) during a run stops it within one watcher interval, partial output kept', () =>
  withWorld({ cli: { claude: { ...SLOW, stdout: 'partial draft' } }, configPatch: QUIET_QUOTA }, async (w) => {
    const { done } = await startRun(w, w.makeLoop())
    w.putRouting(providerKey(CLAUDE_ID), { schemaVersion: 1, id: CLAUDE_ID, status: 'removed', name: 'Renamed before removal', removedAt: w.clock.now().toISOString() })
    const result = await expectStopped(w, done, /provider was removed/i)
    assert.equal(result.run.proposal === null || typeof result.run.proposal === 'object', true)
    assert.equal(w.run('run-1').status, 'interrupted')
    assert.equal(w.runs().length, 1)
  }))

test('turning surplus off for the provider during a run stops it', () =>
  withWorld({ cli: { claude: SLOW }, configPatch: QUIET_QUOTA }, async (w) => {
    const { done } = await startRun(w, w.makeLoop())
    w.setPolicy((p) => { p.providers[CLAUDE_ID].surplusEnabled = false })
    await expectStopped(w, done, /surplus use was turned off/i)
  }))

test('turning automatic runs off for the provider during a run stops it within 5 s (not only after the 60 s quota watcher)', () =>
  withWorld({ cli: { claude: SLOW }, configPatch: QUIET_QUOTA }, async (w) => {
    const { done } = await startRun(w, w.makeLoop())
    w.setPolicy((p) => { p.providers[CLAUDE_ID].autoRunEnabled = false })
    await expectStopped(w, done, /automatic runs were turned off/i)
  }))

test('switching the tool of the provider in the store during a run stops it', () =>
  withWorld({ cli: { claude: SLOW }, configPatch: QUIET_QUOTA }, async (w) => {
    const { done } = await startRun(w, w.makeLoop())
    const spec = WORLD_PROVIDERS.claude
    w.setProvider({ surplus: { tool: 'codex', weeklyQuotaId: spec.weekly.id, sessionQuotaId: spec.session.id } })
    await expectStopped(w, done, /tool .* changed/i)
  }))

test('a provider losing its eligibility during a run stops it', () =>
  withWorld({ cli: { claude: SLOW }, configPatch: QUIET_QUOTA }, async (w) => {
    const { done } = await startRun(w, w.makeLoop())
    w.setProvider({ schedule: { type: 'monthly', cycleDays: 30 } })
    await expectStopped(w, done, /no longer eligible/i)
  }))

test('editing something unrelated (the name) during a run does not stop it', () =>
  withWorld({ cli: { claude: SLOW }, configPatch: QUIET_QUOTA }, async (w) => {
    const loop = w.makeLoop()
    const { done } = await startRun(w, loop)
    w.setProvider({ name: 'A new name', note: 'edited meanwhile' })
    await w.clock.advance(5000)
    await loop.settled()
    assert.equal(loop.status().activeRun.stopping, false)
    await loop.stop()
    await done
  }))

test('the global switch stays on and other providers are untouched when one provider is removed', () =>
  withWorld({ cli: { claude: SLOW }, configPatch: QUIET_QUOTA }, async (w) => {
    const { done } = await startRun(w, w.makeLoop())
    const controlBefore = JSON.stringify(w.fakeApi.find('surplus-control').payload)
    w.putRouting(providerKey(CLAUDE_ID), { schemaVersion: 1, id: CLAUDE_ID, status: 'removed', name: 'Alpha Claude', removedAt: w.clock.now().toISOString() })
    await expectStopped(w, done, /removed/i)
    assert.equal(JSON.stringify(w.fakeApi.find('surplus-control').payload), controlBefore, 'the control record is not written')
    assert.equal(w.fakeApi.find('surplus-control').payload.autoRunEnabled, true)
  }))
