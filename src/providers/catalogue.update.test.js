import test from 'node:test'
import assert from 'node:assert/strict'
import { addProvider, updateProvider } from './catalogue.js'
import { emptyCatalogue } from './records.js'
import { surplusProblems } from './surplusProfile.js'
import { sampleInput, sequentialIds } from './fixtures/sampleProviders.js'

const T0 = new Date('2026-03-04T10:00:00.000Z')
const T1 = new Date('2026-03-05T11:00:00.000Z')

function setup(input = sampleInput()) {
  const newId = sequentialIds()
  const created = addProvider({ catalogue: emptyCatalogue(), state: {}, input, now: T0, newId })
  const [id] = Object.keys(created.catalogue.providers)
  return { ...created, id, newId }
}

const update = (ctx, patch, now = T1) => updateProvider({ catalogue: ctx.catalogue, state: ctx.state, id: ctx.id, patch, now, newId: ctx.newId })
const quotaPatch = (ctx, i, extra = {}) => ({ ...ctx.catalogue.providers[ctx.id].quotas[i], ...extra })

test('edits name, cost, colour, flags, note, fits and schedule; updatedAt moves, createdAt does not', () => {
  const ctx = setup()
  const out = update(ctx, {
    name: 'Renamed', cost: { amount: 25, currency: '$' }, color: '#abcdef', flags: ['x'], note: 'new note',
    fits: { oneshot: 'weak' }, schedule: { type: 'custom', cycleDays: 10 }, confirmSchedule: true,
  })
  assert.equal(out.ok, true)
  const p = out.catalogue.providers[ctx.id]
  assert.deepEqual([p.name, p.cost, p.color, p.flags, p.note, p.fits, p.schedule], ['Renamed', { amount: 25, currency: '$' }, '#abcdef', ['x'], 'new note', { oneshot: 'weak' }, { type: 'custom', cycleDays: 10 }])
  assert.equal(p.updatedAt, T1.toISOString())
  assert.equal(p.createdAt, T0.toISOString())
})

test('ids of the provider and of untouched quotas never change', () => {
  const ctx = setup()
  const before = ctx.catalogue.providers[ctx.id]
  const out = update(ctx, { name: 'Other' })
  const after = out.catalogue.providers[ctx.id]
  assert.equal(after.id, before.id)
  assert.deepEqual(after.quotas.map((q) => q.id), before.quotas.map((q) => q.id))
  assert.deepEqual(out.catalogue.order, ctx.catalogue.order)
})

test('the new name is unique among OTHER providers only', () => {
  const ctx = setup()
  const other = addProvider({ catalogue: ctx.catalogue, state: ctx.state, input: sampleInput({ name: 'Other' }), now: T0, newId: ctx.newId })
  const ctx2 = { ...ctx, catalogue: other.catalogue, state: other.state }
  assert.equal(update(ctx2, { name: ' DELTA weekly ' }).ok, true, 'keeping its own name, other case')
  const clash = update(ctx2, { name: 'other' })
  assert.equal(clash.ok, false)
  assert.deepEqual(clash.errors.map((e) => e.path), ['name'])
})

test('adding a quota needs and writes its first value with a stamp', () => {
  const ctx = setup()
  const quotas = [...ctx.catalogue.providers[ctx.id].quotas, { label: 'Extra', type: 'consumed_pct', value: 15 }]
  const out = update(ctx, { quotas })
  assert.equal(out.ok, true)
  const added = out.catalogue.providers[ctx.id].quotas[2]
  assert.equal(added.label, 'Extra')
  assert.equal(out.state[ctx.id][added.id], 15)
  assert.equal(out.state[ctx.id][`__ts_${added.id}`], T1.toISOString())
  const noValue = update(ctx, { quotas: [...ctx.catalogue.providers[ctx.id].quotas, { label: 'Extra', type: 'consumed_pct' }] })
  assert.deepEqual(noValue.errors.map((e) => e.path), ['quotas[2].value'])
})

test('removing a quota keeps at least one', () => {
  const ctx = setup()
  const [first, second] = ctx.catalogue.providers[ctx.id].quotas
  assert.equal(update(ctx, { quotas: [first], surplus: null }).ok, true)
  const none = update(ctx, { quotas: [] })
  assert.equal(none.ok, false)
  assert.deepEqual(none.errors.map((e) => e.path), ['quotas'])
  assert.ok(second)
})

test('removing a quota that surplus designated keeps the tool, clears the designation and the form says what is missing', () => {
  const ctx = setup()
  const out = update(ctx, { quotas: [ctx.catalogue.providers[ctx.id].quotas[0]] })
  assert.equal(out.ok, true)
  const profile = out.catalogue.providers[ctx.id].surplus
  assert.equal(profile.tool, 'claude')
  assert.equal(profile.weeklyQuotaId, ctx.catalogue.providers[ctx.id].quotas[0].id)
  assert.equal(profile.sessionQuotaId, null)
  assert.match(surplusProblems(out.catalogue.providers[ctx.id])[0], /Designate the session window quota/)
})

test('changing a quota type without a new value is refused and never reinterprets the stored number (FR-007)', () => {
  const ctx = setup()
  const quotas = [quotaPatch(ctx, 0, { type: 'remaining_pct' }), quotaPatch(ctx, 1)]
  const refused = update(ctx, { quotas })
  assert.equal(refused.ok, false)
  assert.deepEqual(refused.errors.map((e) => e.path), ['quotas[0].value'])
  assert.match(refused.errors[0].message, /Confirm or re-enter/)
  assert.equal(refused.catalogue, ctx.catalogue)
  assert.equal(refused.state, ctx.state)

  const accepted = update(ctx, { quotas: [quotaPatch(ctx, 0, { type: 'remaining_pct', value: 80 }), quotaPatch(ctx, 1)] })
  assert.equal(accepted.ok, true)
  const q = accepted.catalogue.providers[ctx.id].quotas[0]
  assert.equal(q.type, 'remaining_pct')
  assert.equal(accepted.state[ctx.id][q.id], 80)
  assert.equal(accepted.state[ctx.id][`__ts_${q.id}`], T1.toISOString())
})

test('changing the schedule while a reset date is recorded asks for confirmation and applies nothing', () => {
  const ctx = setup()
  const withReset = { ...ctx.state, [ctx.id]: { ...ctx.state[ctx.id], __last_reset_date: '2026-03-02' } }
  const base = { ...ctx, state: withReset }
  const ask = update(base, { schedule: { type: 'monthly' } })
  assert.equal(ask.ok, false)
  assert.deepEqual(ask.needsConfirmation, { kind: 'schedule', lastResetDate: '2026-03-02' })
  assert.equal(ask.catalogue, ctx.catalogue)
  assert.equal(ask.state, withReset)

  const confirmed = update(base, { schedule: { type: 'monthly' }, confirmSchedule: true })
  assert.equal(confirmed.ok, true)
  assert.equal(confirmed.catalogue.providers[ctx.id].schedule.cycleDays, 30)
  assert.equal(confirmed.state[ctx.id].__last_reset_date, '2026-03-02')

  const corrected = update(base, { schedule: { type: 'monthly' }, confirmSchedule: true, lastResetDate: '2026-03-01' })
  assert.equal(corrected.state[ctx.id].__last_reset_date, '2026-03-01')

  const cleared = update(base, { schedule: { type: 'none' }, confirmSchedule: true, lastResetDate: null })
  assert.equal(cleared.state[ctx.id].__last_reset_date, null)
})

test('a schedule change without a recorded reset date needs no confirmation', () => {
  const ctx = setup()
  assert.equal(update(ctx, { schedule: { type: 'monthly' } }).ok, true)
})

test('a refused patch returns the same references (FR-021)', () => {
  const ctx = setup()
  for (const patch of [{ name: '' }, { color: 'red' }, { quotas: [] }, { schedule: { type: 'custom', cycleDays: 0 } }]) {
    const out = update(ctx, patch)
    assert.equal(out.ok, false)
    assert.equal(out.catalogue, ctx.catalogue)
    assert.equal(out.state, ctx.state)
  }
  const unknown = updateProvider({ catalogue: ctx.catalogue, state: ctx.state, id: 'p_unknownzzzzz', patch: { name: 'x' }, now: T1 })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.catalogue, ctx.catalogue)
})

test('an edit that changes nothing returns the same references and no effects', () => {
  const ctx = setup()
  const out = update(ctx, {})
  assert.equal(out.ok, true)
  assert.equal(out.catalogue, ctx.catalogue)
  assert.deepEqual(out.effects.stateWrites, [])
})

test('the input catalogue and state are never mutated', () => {
  const ctx = setup()
  const frozen = JSON.stringify([ctx.catalogue, ctx.state])
  update(ctx, { name: 'Changed', quotas: [...ctx.catalogue.providers[ctx.id].quotas, { label: 'E', type: 'consumed_pct', value: 1 }] })
  assert.equal(JSON.stringify([ctx.catalogue, ctx.state]), frozen)
})
