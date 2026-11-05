import test from 'node:test'
import assert from 'node:assert/strict'
import { activeRunFor, describeDeletion } from './activeRun.js'
import { WEEKLY_ID, MONTHLY_ID, sampleMonthly, sampleWeekly } from './fixtures/sampleProviders.js'

const run = (serviceId, status) => ({ id: `${serviceId}-${status}`, serviceId, status })

test('activeRunFor finds the running run of that provider only', () => {
  const runs = [run(WEEKLY_ID, 'completed'), run(MONTHLY_ID, 'running'), run(WEEKLY_ID, 'running')]
  assert.equal(activeRunFor(WEEKLY_ID, runs).id, `${WEEKLY_ID}-running`)
  assert.equal(activeRunFor(MONTHLY_ID, runs).id, `${MONTHLY_ID}-running`)
  assert.equal(activeRunFor('p_nobodyzzzzzz', runs), null)
  assert.equal(activeRunFor(WEEKLY_ID, [run(WEEKLY_ID, 'failed')]), null)
  assert.equal(activeRunFor(WEEKLY_ID, undefined), null)
})

test('describeDeletion lists what is removed and what is kept', () => {
  const out = describeDeletion(sampleWeekly(), [])
  assert.ok(out.willRemove.some((line) => /2 quotas/.test(line)))
  assert.ok(out.willRemove.some((line) => /reset date/.test(line)))
  assert.ok(out.willRemove.some((line) => /surplus settings/.test(line)))
  assert.ok(out.willKeep.some((line) => /weekly history/.test(line)))
  assert.ok(out.willKeep.some((line) => /run and cycle records/.test(line)))
  assert.equal(out.runWarning, null)
})

test('a provider without surplus or with one quota is described accordingly', () => {
  const out = describeDeletion(sampleMonthly(), [])
  assert.ok(out.willRemove.some((line) => /^1 quota with/.test(line)))
  assert.ok(!out.willRemove.some((line) => /surplus/.test(line)))
})

test('an active run adds a warning naming the provider (US3-4)', () => {
  const out = describeDeletion(sampleWeekly(), [run(WEEKLY_ID, 'running')])
  assert.match(out.runWarning, /run is in progress for Alpha Weekly/)
  assert.equal(describeDeletion(sampleWeekly(), [run(MONTHLY_ID, 'running')]).runWarning, null)
})
