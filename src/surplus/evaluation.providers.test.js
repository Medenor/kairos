// Replay of the 006 scenario on user-declared providers (FR-031 to FR-034, SC-005).
import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateSurplus } from './evaluation.js'
import { RULESET_VERSION } from './constants.js'
import { defaultPolicy, defaultProviderSurplus } from './policy.js'
import { toRuntimeServices } from '../providers/runtime.js'
import { addProvider } from '../providers/catalogue.js'
import { emptyCatalogue } from '../providers/records.js'
import { sampleInput, sequentialIds } from '../providers/fixtures/sampleProviders.js'

const NOW = new Date(2026, 10, 3, 12, 0)
const HOUR = 3600000
const ago = (hours) => new Date(NOW.getTime() - hours * HOUR).toISOString()
const pad = (n) => String(n).padStart(2, '0')
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const lastResetFor = (daysToReset) => localDate(new Date(2026, 10, 3 + daysToReset - 7))
const idea = { id: 'i1', text: 'Write the tests', context: '', workingFolder: null, priority: 'normal', size: 'medium', status: 'waiting', createdAt: '2026-11-01T08:00:00.000Z' }

// Declare providers the way a user would, then read them back through the runtime mapping.
function declare(inputs) {
  const newId = sequentialIds()
  let catalogue = emptyCatalogue()
  let state = {}
  for (const input of inputs) {
    const out = addProvider({ catalogue, state, input, now: NOW, newId })
    assert.ok(out.ok, JSON.stringify(out.errors))
    ;({ catalogue, state } = out)
  }
  return { catalogue, state, services: toRuntimeServices(catalogue), ids: catalogue.order }
}

const eligibleInput = (name, extra = {}) =>
  sampleInput({
    name,
    quotas: [
      { ref: 'week', label: 'Weekly', type: 'remaining_pct', value: 60 },
      { ref: 'session', label: 'Session', type: 'remaining_pct', value: 60 },
    ],
    surplus: { tool: 'claude', weeklyQuotaId: 'week', sessionQuotaId: 'session' },
    ...extra,
  })

function stateOf(setup, { daysToReset = 2, weeklyAgeH = 2, sessionAgeH = 2 } = {}) {
  const state = {}
  for (const service of setup.services) {
    const [weekly, session] = service.quotas
    state[service.id] = {
      [weekly.id]: 40, // remaining_pct quota: consumed value 40 reads as 60 % remaining? see below
      [session.id]: 40,
      __last_reset_date: lastResetFor(daysToReset),
      [`__ts_${weekly.id}`]: ago(weeklyAgeH),
      [`__ts_${session.id}`]: ago(sessionAgeH),
    }
  }
  return state
}

function policyFor(setup, ids = setup.ids) {
  const policy = defaultPolicy()
  for (const id of ids) policy.providers[id] = { ...defaultProviderSurplus(), surplusEnabled: true }
  return policy
}

const evaluate = (setup, over = {}) =>
  evaluateSurplus({ now: NOW, state: stateOf(setup), services: setup.services, policy: policyFor(setup), ideas: [idea], runs: [], folderChecks: null, mode: 'preview', ...over })

test('the surplus rule-set version is 2', () => assert.equal(RULESET_VERSION, 2))

test('006 scenario on a user-declared provider: a suggestion with the same rules and reason structure', () => {
  const setup = declare([eligibleInput('Alpha')])
  const state = stateOf(setup)
  // remaining 60 % means a stored value of 60 for a remaining_pct quota
  for (const q of setup.services[0].quotas) state[setup.ids[0]][q.id] = 60
  const result = evaluate(setup, { state })
  assert.equal(result.rulesetVersion, 2)
  assert.equal(result.selected.serviceId, setup.ids[0])
  assert.equal(result.selected.ideaId, 'i1')
  const svc = result.services[0]
  assert.deepEqual(svc.rules.map((r) => [r.id, r.pass]), ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'].map((id) => [id, true]))
  assert.match(svc.reason, /Alpha: 60% remaining minus 20% reserve minus 8% cost leaves 32%; resets in 2d; all rules pass/)
})

test('the same state with the weekly reading 20 h old, or the reset due today: no suggestion with the stated reason (SC-005)', () => {
  const setup = declare([eligibleInput('Alpha')])
  const fresh = stateOf(setup)
  for (const q of setup.services[0].quotas) fresh[setup.ids[0]][q.id] = 60
  const stale = structuredClone(fresh)
  stale[setup.ids[0]][`__ts_${setup.services[0].quotas[0].id}`] = ago(20)
  const staleResult = evaluate(setup, { state: stale })
  assert.equal(staleResult.selected, null)
  assert.match(staleResult.reason, /older than 12 h/)
  const due = structuredClone(fresh)
  due[setup.ids[0]].__last_reset_date = lastResetFor(0)
  const dueResult = evaluate(setup, { state: due })
  assert.equal(dueResult.selected, null)
  assert.match(dueResult.reason, /reset due today/)
})

test('a provider without an eligible profile never appears in services, notice or suggestion', () => {
  const setup = declare([eligibleInput('Alpha'), sampleInput({ name: 'No tool', surplus: null }), sampleInput({ name: 'Monthly', schedule: { type: 'monthly' }, surplus: { tool: 'claude', weeklyQuotaId: 'week', sessionQuotaId: 'session' } })])
  const ids = setup.services.map((s) => s.id)
  const result = evaluate(setup, { state: stateOf(setup) })
  assert.deepEqual(result.services.map((s) => s.serviceId), [ids[0]], 'only the eligible provider is evaluated')
  assert.ok(!JSON.stringify(result).includes(ids[1]) && !JSON.stringify(result).includes(ids[2]))
})

test('two eligible providers with the same days to reset: the selection is the same for both input orders and names the tie-break', () => {
  const setup = declare([eligibleInput('Zeta'), eligibleInput('Alpha')])
  const state = stateOf(setup)
  for (const service of setup.services) for (const q of service.quotas) state[service.id][q.id] = 60
  const forward = evaluate(setup, { state })
  const backward = evaluate(setup, { state, services: [...setup.services].reverse() })
  const alpha = setup.services.find((s) => s.name === 'Alpha').id
  assert.equal(forward.selected.serviceId, alpha)
  assert.equal(backward.selected.serviceId, alpha)
  assert.match(forward.reason, /tie broken by name/)
  assert.deepEqual(forward.selected, backward.selected)
})

test('the soonest reset still wins before any name tie-break', () => {
  const setup = declare([eligibleInput('Alpha'), eligibleInput('Zeta')])
  const state = stateOf(setup)
  for (const service of setup.services) for (const q of service.quotas) state[service.id][q.id] = 60
  const zeta = setup.services.find((s) => s.name === 'Zeta').id
  state[zeta].__last_reset_date = lastResetFor(1)
  const result = evaluate(setup, { state })
  assert.equal(result.selected.serviceId, zeta)
  assert.doesNotMatch(result.reason, /tie broken by name/)
})

test('zero eligible providers: "no provider supports surplus use"', () => {
  const setup = declare([sampleInput({ name: 'No tool', surplus: null })])
  const result = evaluate(setup, { state: {} })
  assert.equal(result.selected, null)
  assert.match(result.reason, /no provider supports surplus use/)
  assert.deepEqual(result.services, [])
})

test('a policy without an entry for the provider fails R1 only (everything starts off)', () => {
  const setup = declare([eligibleInput('Alpha')])
  const state = stateOf(setup)
  for (const q of setup.services[0].quotas) state[setup.ids[0]][q.id] = 60
  const result = evaluate(setup, { state, policy: defaultPolicy() })
  assert.deepEqual(result.services[0].rules.filter((r) => !r.pass).map((r) => r.id), ['R1'])
})
