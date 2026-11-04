// Before/after reference scenarios (Constitution III: a routing change needs a demonstrated before/after).
// The former fixed rules (test fixture legacyRules.js) and the generic engine run over the same grid of
// quota states; every provider is declared the way a user would (fixtures/legacyProviders.js).
// Wherever both agree the primary must match. Every divergence must appear in INTENDED_DIFFERENCES with
// its cause, and every row of the table must be exercised: a surprise or a stale row fails the test.
import test from 'node:test'
import assert from 'node:assert/strict'
import { RULES } from './fixtures/legacyRules.js'
import { ID, QUOTA, legacyProviders } from './fixtures/legacyProviders.js'
import { toRuntimeServices } from '../providers/runtime.js'
import { getResetInfo } from '../utils.js'
import { recommend } from './engine.js'

const BANDS = 'D5/D7: generic score (fit minus pressure band) and fixed pressure buckets replace the per-provider thresholds of the former table'
const CUTOFF = 'D8: the USD > 1 cut-off and the named fallback are dropped; a declared pay-as-you-go balance stays eligible while it is above zero'

// Divergence rows: task, the legacy pick, the generic pick, why, and what the user sees.
export const INTENDED_DIFFERENCES = [
  { task: 'coding_hard', from: 'chatgpt', to: 'claude', cause: `${BANDS}: at 85 % or more the former rule always redirected; the generic ranking keeps the provider with the best remaining score`, userEffect: 'A nearly used-up top provider is still recommended when every other option is as loaded or worse.' },
  { task: 'coding_hard', from: 'chatgpt', to: 'copilot', cause: `${BANDS}: a lighter-loaded declared provider outranks the named redirect`, userEffect: 'The least loaded suitable provider is preferred over a fixed fallback.' },
  { task: 'coding_hard', from: 'claude', to: 'chatgpt', cause: `${BANDS}: 60 % pressure costs one point, so an acceptable fit at low load outranks a strong fit under pressure`, userEffect: 'Moves off a provider earlier or later than before depending on its declared fit.' },
  { task: 'coding_hard', from: 'copilot', to: 'chatgpt', cause: `${BANDS}: the former "keep coding on Copilot" fallback is replaced by the lowest pressure bucket`, userEffect: 'The less loaded fallback wins instead of the named one.' },
  { task: 'coding_hard', from: 'copilot', to: 'claude', cause: `${BANDS}`, userEffect: 'A recovering provider is preferred over a fixed fallback.' },
  { task: 'coding_light', from: 'chatgpt', to: 'claude', cause: `${BANDS}`, userEffect: 'The best declared fit at acceptable load wins.' },
  { task: 'coding_light', from: 'chatgpt', to: 'copilot', cause: `${BANDS}: a strong fit at moderate load outranks a weak fit`, userEffect: 'A weak-fit provider is no longer chosen just because the others are loaded.' },
  { task: 'coding_light', from: 'claude', to: 'chatgpt', cause: `${BANDS}`, userEffect: 'Pressure bands decide instead of the 50 % rule of the former table.' },
  { task: 'coding_light', from: 'claude', to: 'copilot', cause: `${BANDS}`, userEffect: 'The strong declared fit wins at comparable load.' },
  { task: 'daily_chat', from: 'claude', to: 'chatgpt', cause: 'D8: the daily_chat redirect and its 40 % threshold are dropped; the declared fit decides, and a provider whose quota does not gate chat has no pressure', userEffect: 'Daily chat goes to the provider declared best for it, with no hard-coded preservation of another provider quota.' },
  { task: 'oneshot', from: 'copilot', to: 'kilocode', cause: CUTOFF, userEffect: 'A low pay-as-you-go balance is still recommended (marked under pressure) instead of falling back to a subscription.' },
  { task: 'oneshot', from: 'kilocode', to: 'openrouter', cause: `${BANDS}; D6: a balance below its low-balance level counts as pressure`, userEffect: 'A healthier balance wins over one near its low-balance level.' },
  { task: 'work_heavy', from: 'claude', to: 'chatgpt', cause: `${BANDS}: the former "work tasks justify the quota spend" override is dropped`, userEffect: 'Intensive work moves to the other declared provider once the top one passes the pressure bands.' },
]

const pad = (n) => String(n).padStart(2, '0')
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const NOW = new Date(2026, 2, 4, 12, 0, 0)
const TASKS = ['coding_hard', 'coding_light', 'work_heavy', 'daily_chat', 'oneshot']
const NAME_OF = Object.fromEntries(Object.entries(ID).map(([name, id]) => [id, name]))

function lastReset(cycleDays, left) {
  if (left === 'unset') return null
  const daysLeft = left === 'overdue' ? -3 : left
  return localDate(new Date(2026, 2, 4 - (cycleDays - daysLeft)))
}

function buildScenario({ cw, sl, cop, cr, kc, orc, rd }) {
  const legacy = { claude: { weekly: cw, slot5h: sl }, copilot: { monthly: cop }, chatgpt: { codex_remaining: cr, codex_5h: 60 }, kilocode: { credits: kc }, openrouter: { credits: orc } }
  const state = {}
  for (const [path, [providerId, quotaId]] of Object.entries(QUOTA)) {
    const [service, quota] = path.split('.')
    state[providerId] ??= {}
    state[providerId][quotaId] = legacy[service][quota]
  }
  state[ID.claude].__last_reset_date = lastReset(7, rd)
  state[ID.chatgpt].__last_reset_date = lastReset(7, rd)
  state[ID.copilot].__last_reset_date = lastReset(30, rd)
  state[ID.openrouter].__last_reset_date = null
  state[ID.kilocode].__last_reset_date = null
  const signals = {
    claude: getResetInfo(state[ID.claude].__last_reset_date, 7, NOW),
    chatgpt: getResetInfo(state[ID.chatgpt].__last_reset_date, 7, NOW),
    copilot: getResetInfo(state[ID.copilot].__last_reset_date, 30, NOW),
    openrouter: getResetInfo(null, null, NOW),
    kilocode: getResetInfo(null, null, NOW),
  }
  return { legacy, state, signals }
}

function* grid() {
  for (const cw of [0, 30, 60, 70, 85, 100]) for (const sl of [40, 100]) for (const cop of [20, 60, 90])
    for (const cr of [75, 10, 0]) for (const kc of [0.5, 3, 8]) for (const orc of [0.5, 8])
      for (const rd of [0, 1, 2, 5, 'overdue', 'unset']) yield { cw, sl, cop, cr, kc, orc, rd }
}

const services = toRuntimeServices({ providers: Object.fromEntries(legacyProviders().map((p) => [p.id, p])), order: [] })

function runGrid() {
  let total = 0
  let agreed = 0
  const hits = new Map()
  const surprises = []
  for (const params of grid()) {
    const { legacy, state, signals } = buildScenario(params)
    for (const task of TASKS) {
      total += 1
      const before = RULES[task](legacy, signals).primary
      const result = recommend({ task, providers: services, state, now: NOW })
      const after = result.primary ? NAME_OF[result.primary.providerId] : null
      if (before === after) {
        agreed += 1
        continue
      }
      const row = INTENDED_DIFFERENCES.find((d) => d.task === task && d.from === before && d.to === after)
      if (!row) surprises.push({ task, before, after, params })
      else hits.set(row, (hits.get(row) ?? 0) + 1)
    }
  }
  return { total, agreed, hits, surprises }
}

test('every divergence from the former rules is in INTENDED_DIFFERENCES with a cause', () => {
  const { surprises } = runGrid()
  assert.deepEqual(surprises.slice(0, 5), [], `${surprises.length} divergence(s) not documented`)
})

test('every row of INTENDED_DIFFERENCES is exercised by the grid (no stale row)', () => {
  const { hits } = runGrid()
  const unused = INTENDED_DIFFERENCES.filter((row) => !hits.has(row))
  assert.deepEqual(unused.map((r) => `${r.task}: ${r.from} -> ${r.to}`), [])
  for (const row of INTENDED_DIFFERENCES) {
    assert.ok(row.cause.length > 20 && row.userEffect.length > 10)
  }
})

test('the generic engine and the former table agree on most of the grid', () => {
  const { total, agreed } = runGrid()
  assert.equal(total, 19440)
  assert.ok(agreed / total > 0.6, `agreement ${(agreed / total).toFixed(2)}`)
})

test('spot checks where both must agree', () => {
  const pick = (task, params) => {
    const { legacy, state, signals } = buildScenario({ cw: 0, sl: 40, cop: 20, cr: 75, kc: 8, orc: 0.5, rd: 'unset', ...params })
    const result = recommend({ task, providers: services, state, now: NOW })
    return { before: RULES[task](legacy, signals).primary, after: NAME_OF[result.primary?.providerId] }
  }
  for (const [task, params, expected] of [
    ['coding_hard', {}, 'claude'],
    ['coding_hard', { cw: 30 }, 'claude'],
    ['work_heavy', {}, 'claude'],
    ['coding_light', { cop: 20 }, 'copilot'],
    ['oneshot', { kc: 8 }, 'kilocode'],
  ]) {
    const { before, after } = pick(task, params)
    assert.equal(before, expected, `legacy ${task}`)
    assert.equal(after, expected, `generic ${task}`)
  }
})

test('both engines are reproducible: the same grid point gives the same primary twice', () => {
  const { state } = buildScenario({ cw: 70, sl: 40, cop: 60, cr: 10, kc: 3, orc: 8, rd: 2 })
  const a = recommend({ task: 'coding_hard', providers: services, state, now: NOW })
  const b = recommend({ task: 'coding_hard', providers: services, state, now: NOW })
  assert.deepEqual(a, b)
})
