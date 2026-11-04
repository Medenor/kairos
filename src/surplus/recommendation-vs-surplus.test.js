// FR-038: a recommendation and a surplus notice about the same provider on the same `now` never contradict,
// including near local midnight.
import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateSurplus } from './evaluation.js'
import { defaultPolicy, defaultProviderSurplus } from './policy.js'
import { recommend } from '../routing/engine.js'
import { getResetInfo } from '../utils.js'
import { lastResetFor, quota, service } from '../routing/routing.testkit.js'

const IDEA = { id: 'i1', text: 'Write the tests', context: '', workingFolder: null, priority: 'normal', size: 'small', status: 'waiting', createdAt: '2026-03-01T08:00:00.000Z' }

function withTz(tz, fn) {
  const previous = process.env.TZ
  process.env.TZ = tz
  try {
    fn()
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
}

function scenario(now, daysLeft) {
  const provider = service('p_agreeaaaaaaa', {
    name: 'Agree',
    fits: { coding_hard: 'strong' },
    quotas: [quota('week', { type: 'remaining_pct', label: 'Weekly' }), quota('sess', { type: 'remaining_pct', label: 'Session' })],
    surplus: { tool: 'claude', weeklyQuotaId: 'week', sessionQuotaId: 'sess' },
  })
  const stamp = new Date(now.getTime() - 3600000).toISOString()
  const state = { [provider.id]: { week: 80, sess: 80, __last_reset_date: lastResetFor(7, daysLeft, now), __ts_week: stamp, __ts_sess: stamp } }
  const policy = defaultPolicy()
  policy.providers[provider.id] = { ...defaultProviderSurplus(), surplusEnabled: true }
  return { provider, state, policy }
}

for (const tz of ['Europe/Paris', 'Pacific/Auckland', 'America/Los_Angeles']) {
  for (const [label, at] of [['23:59', new Date(2026, 2, 4, 23, 59)], ['00:01', new Date(2026, 2, 4, 0, 1)]]) {
    test(`${tz} at ${label}: the notice and the recommendation agree on days and direction`, () => {
      withTz(tz, () => {
        const { provider, state, policy } = scenario(at, 2)
        const reco = recommend({ task: 'coding_hard', providers: [provider], state, now: at })
        const surplus = evaluateSurplus({ now: at, state, services: [provider], policy, ideas: [IDEA], runs: [], folderChecks: null, mode: 'preview' })
        const days = getResetInfo(state[provider.id].__last_reset_date, 7, at).daysRemaining
        assert.equal(days, 2)
        assert.equal(reco.primary.daysToReset, 2)
        assert.equal(surplus.services[0].inputs.daysToReset, 2)
        // direction: both say "spend before the reset" for a reset 2 days away
        assert.match(reco.reason, /Resets in 2d — spend it now/)
        assert.match(surplus.services[0].reason, /resets in 2d/)
        assert.equal(surplus.selected.serviceId, provider.id)
      })
    })
  }
}

test('a reset due today: the recommendation says so and the surplus is not offered', () => {
  const at = new Date(2026, 2, 4, 12)
  const { provider, state, policy } = scenario(at, 0)
  const reco = recommend({ task: 'coding_hard', providers: [provider], state, now: at })
  const surplus = evaluateSurplus({ now: at, state, services: [provider], policy, ideas: [IDEA], runs: [], folderChecks: null, mode: 'preview' })
  assert.match(reco.reason, /Reset due today/)
  assert.equal(surplus.selected, null)
  assert.match(surplus.reason, /reset due today/)
})
