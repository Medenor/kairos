import test from 'node:test'
import assert from 'node:assert/strict'
import { SUPPORTED_TOOLS, isSurplusEligible, surplusProblems } from './surplusProfile.js'
import { WEEKLY_Q_SESSION, WEEKLY_Q_WEEK, sampleWeekly, samplePayg } from './fixtures/sampleProviders.js'

const withSurplus = (patch) => sampleWeekly({ surplus: { ...sampleWeekly().surplus, ...patch } })

test('SUPPORTED_TOOLS lists the two runner adapters', () => {
  assert.deepEqual([...SUPPORTED_TOOLS], ['claude', 'codex'])
})

test('an eligible profile has no problem', () => {
  assert.deepEqual(surplusProblems(sampleWeekly()), [])
  assert.equal(isSurplusEligible(sampleWeekly()), true)
  assert.deepEqual(surplusProblems(withSurplus({ tool: 'codex' })), [])
})

test('no profile at all gives the single "no terminal tool declared" problem', () => {
  assert.deepEqual(surplusProblems(sampleWeekly({ surplus: null })), ['No terminal tool declared.'])
  assert.deepEqual(surplusProblems(samplePayg()), ['No terminal tool declared.'])
})

test('an unsupported tool is reported', () => {
  const problems = surplusProblems(withSurplus({ tool: 'bash' }))
  assert.equal(problems.length, 1)
  assert.match(problems[0], /supported tool/i)
})

test('a non-weekly schedule is reported', () => {
  for (const type of ['monthly', 'none']) {
    const problems = surplusProblems(sampleWeekly({ schedule: { type, cycleDays: type === 'monthly' ? 30 : null } }))
    assert.deepEqual(problems, ['Surplus use needs a weekly reset schedule.'])
  }
})

test('missing, unknown and non-percentage designations are reported per role', () => {
  assert.match(surplusProblems(withSurplus({ weeklyQuotaId: null }))[0], /Designate the weekly/)
  assert.match(surplusProblems(withSurplus({ sessionQuotaId: null }))[0], /Designate the session/)
  assert.match(surplusProblems(withSurplus({ weeklyQuotaId: 'q_gone2222' }))[0], /no longer exists/)
  const currency = sampleWeekly()
  currency.quotas = [{ ...currency.quotas[0], type: 'currency', currency: '$' }, currency.quotas[1]]
  assert.match(surplusProblems(currency)[0], /weekly quota must be a percentage/)
})

test('the same quota cannot be both weekly and session', () => {
  const problems = surplusProblems(withSurplus({ sessionQuotaId: WEEKLY_Q_WEEK }))
  assert.deepEqual(problems, ['The weekly and session window quotas must be two different quotas.'])
  assert.equal(isSurplusEligible(withSurplus({ weeklyQuotaId: WEEKLY_Q_SESSION, sessionQuotaId: WEEKLY_Q_WEEK })), true)
})
