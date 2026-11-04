// Feature 007 (T102): nothing read from the shared store can authorise a run. The provider catalogue is untrusted
// data: it can select and restrict, but only the local allowance (pinned to provider id AND tool) allows.
import test from 'node:test'
import assert from 'node:assert/strict'
import { providerKey } from '../src/providers/records.js'
import { validateRunRecord } from '../src/surplus/records.js'
import { defaultProviderSurplus } from '../src/surplus/policy.js'
import { CHATGPT_ID, CLAUDE_ID, WORLD_PROVIDERS, providerRecord, quotaSeeds, withWorld } from './loop.testkit.js'

const noRun = (w, result, reason) => {
  assert.equal(result.started, false)
  assert.equal(result.reason, reason, result.detail)
  assert.equal(w.cli.claude.calls().length + w.cli.codex.calls().length, 0, 'no tool was ever started')
  assert.equal(w.runs().length, 0)
  assert.equal(w.idea().payload.status, 'waiting')
}

test('a provider written straight into the store with surplus and auto on and an approved idea does not run', () =>
  withWorld({ configPatch: { allowCodexAuto: true } }, async (w) => {
    // The world's own provider (allowed) is switched off; another one is injected through the store alone.
    w.setPolicy((p) => {
      p.providers[CLAUDE_ID].surplusEnabled = false
      p.providers[CLAUDE_ID].autoRunEnabled = false
      p.providers[CHATGPT_ID] = { ...defaultProviderSurplus(), surplusEnabled: true, autoRunEnabled: true, disclosuresAckAt: w.clock.now().toISOString() }
    })
    w.putRouting(providerKey(CHATGPT_ID), providerRecord('chatgpt'))
    for (const [key, value] of quotaSeeds('chatgpt', {}, w.clock.now())) w.fakeApi.seed(key, { value }, 'quota_state')
    const result = await w.makeLoop().tick()
    noRun(w, result, 'service_not_allowed')
    assert.match(result.detail, new RegExp(CHATGPT_ID))
  }))

test('flipping autoRunEnabled in the shared policy without a local allowance does not run', () =>
  withWorld({ configPatch: { allowProviders: [] } }, async (w) => {
    noRun(w, await w.makeLoop().tick(), 'service_not_allowed')
  }))

test('an allowed provider whose catalogue tool is switched in the store does not run (tool_changed)', () =>
  withWorld({}, async (w) => {
    const spec = WORLD_PROVIDERS.claude
    w.setProvider({ surplus: { tool: 'codex', weeklyQuotaId: spec.weekly.id, sessionQuotaId: spec.session.id } })
    const result = await w.makeLoop({ config: { ...w.config, allowCodexAuto: true } }).tick()
    noRun(w, result, 'tool_changed')
    assert.match(result.detail, /allowed with the claude tool/)
  }))

test('an allowed provider that became a tombstone does not run (provider_not_eligible)', () =>
  withWorld({}, async (w) => {
    w.putRouting(providerKey(CLAUDE_ID), { schemaVersion: 1, id: CLAUDE_ID, status: 'removed', name: 'Alpha Claude', removedAt: w.clock.now().toISOString() })
    noRun(w, await w.makeLoop().tick(), 'provider_not_eligible')
  }))

test('an allowed provider that lost its weekly quota does not run (provider_not_eligible)', () =>
  withWorld({}, async (w) => {
    const spec = WORLD_PROVIDERS.claude
    w.setProvider({ surplus: { tool: 'claude', weeklyQuotaId: null, sessionQuotaId: spec.session.id } })
    const result = await w.makeLoop().tick()
    noRun(w, result, 'provider_not_eligible')
    assert.match(result.detail, /weekly/i)
  }))

test('the guard order is exactly the one of the contract: each fix reveals the next failure', () =>
  withWorld({ configPatch: { allowProviders: [] }, policy: (p) => { p.providers[CLAUDE_ID].autoRunEnabled = false; p.providers[CLAUDE_ID].disclosuresAckAt = null } }, async (w) => {
    const reasonNow = async (config) => {
      const loop = w.makeLoop({ config })
      const result = await loop.tick()
      await loop.stop() // releases the lease for the next loop
      return result.reason
    }
    const policyWith = (patch) => w.setPolicy((p) => { Object.assign(p.providers[CLAUDE_ID], { autoRunEnabled: false, disclosuresAckAt: null }, patch) })
    const pin = (tool) => ({ ...w.config, allowProviders: [{ providerId: CLAUDE_ID, tool, name: 'Alpha Claude', allowedAt: w.clock.now().toISOString() }] })

    assert.equal(await reasonNow(w.config), 'auto_run_disabled')
    policyWith({ autoRunEnabled: true })
    assert.equal(await reasonNow(w.config), 'disclosures_missing')
    policyWith({ autoRunEnabled: true, disclosuresAckAt: w.clock.now().toISOString() })
    assert.equal(await reasonNow(w.config), 'service_not_allowed')

    // ineligible catalogue record is reported before a tool mismatch
    w.setProvider({ schedule: { type: 'monthly', cycleDays: 30 } })
    assert.equal(await reasonNow(pin('codex')), 'provider_not_eligible')
    w.setProvider({})
    assert.equal(await reasonNow(pin('codex')), 'tool_changed')
    assert.equal(w.cli.claude.calls().length + w.cli.codex.calls().length, 0)

    const ok = await w.makeLoop({ config: pin('claude') }).tick()
    assert.equal(ok.started, true, ok.detail)
  }))

test('the run record written on a normal run carries providerName as captured at the claim (SC-011)', () =>
  withWorld({}, async (w) => {
    const result = await w.makeLoop().tick()
    assert.equal(result.started, true)
    const run = w.run('run-1')
    assert.equal(run.serviceId, CLAUDE_ID)
    assert.equal(run.providerName, 'Alpha Claude')
    assert.equal(validateRunRecord(run).valid, true)
    assert.equal(run.cycleKey.startsWith(`${CLAUDE_ID}:`), true)
    // renaming afterwards never rewrites the finished run
    w.setProvider({ name: 'Renamed later' })
    assert.equal(w.run('run-1').providerName, 'Alpha Claude')
  }))

test('a cycle record written after a run names the provider too', () =>
  withWorld({}, async (w) => {
    await w.makeLoop().tick()
    const cycle = w.cycle('2026-11-04')
    assert.ok(cycle, 'cycle record keyed by the provider id')
    assert.equal(cycle.payload.providerName, 'Alpha Claude')
  }))
