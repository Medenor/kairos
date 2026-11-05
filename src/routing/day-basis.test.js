import test from 'node:test'
import assert from 'node:assert/strict'
import { recommend } from './engine.js'
import { evaluateSurplus } from '../surplus/evaluation.js'
import { getResetSignals } from '../utils.js'
import { lastResetFor, quota, service } from './routing.testkit.js'

// FR-038: one local-day basis for the dashboard, the recommendation and the surplus evaluation.
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

for (const tz of ['Pacific/Auckland', 'America/Los_Angeles']) {
  test(`${tz}: 23:59 and 00:01 local give the same days to reset in all three paths`, () => {
    withTz(tz, () => {
      const day = new Date(2026, 2, 4, 23, 59, 0)
      const later = new Date(2026, 2, 4, 0, 1, 0) // same local day, just after midnight
      const weekly = service('w', {
        fits: { coding_hard: 'strong' },
        quotas: [quota('week', { label: 'Weekly' }), quota('sess', { label: 'Session' })],
        surplus: { tool: 'claude', weeklyQuotaId: 'week', sessionQuotaId: 'sess' },
      })
      const state = { w: { week: 40, sess: 10, __last_reset_date: lastResetFor(7, 3, day), __ts_week: '2026-03-04T00:00:00.000Z', __ts_sess: '2026-03-04T00:00:00.000Z' } }
      const results = [day, later].map((now) => ({
        signals: getResetSignals(state, [weekly], now).w.daysRemaining,
        reco: recommend({ task: 'coding_hard', providers: [weekly], state, now }).primary.daysToReset,
        surplus: evaluateSurplus({ services: [weekly], state, ideas: [], policy: undefined, now }),
      }))
      assert.equal(results[0].signals, 3)
      assert.equal(results[1].signals, 3)
      assert.equal(results[0].reco, 3)
      assert.equal(results[1].reco, 3)
      for (const r of results) {
        assert.equal(r.surplus.services[0].inputs.daysToReset, 3)
      }
    })
  })
}
