import test from 'node:test'
import assert from 'node:assert/strict'
import { addProvider, duplicateProvider } from './catalogue.js'
import { emptyCatalogue } from './records.js'
import { isProviderId, isQuotaId } from './ids.js'
import { surplusProblems } from './surplusProfile.js'
import { sampleInput, sequentialIds } from './fixtures/sampleProviders.js'

const T0 = new Date('2026-03-04T10:00:00.000Z')
const T1 = new Date('2026-03-06T09:00:00.000Z')

function setup(name = 'Original') {
  const newId = sequentialIds()
  const created = addProvider({ catalogue: emptyCatalogue(), state: {}, input: sampleInput({ name }), now: T0, newId })
  const [id] = created.catalogue.order
  const state = { ...created.state, [id]: { ...created.state[id], __last_reset_date: '2026-03-02' } }
  return { catalogue: created.catalogue, state, id, newId }
}
const copy = (ctx, now = T1) => duplicateProvider({ catalogue: ctx.catalogue, state: ctx.state, id: ctx.id, now, newId: ctx.newId })

test('a copy has a new provider id, new quota ids, "(copy)" in its name and the same settings', () => {
  const ctx = setup()
  const out = copy(ctx)
  assert.equal(out.ok, true)
  const original = ctx.catalogue.providers[ctx.id]
  const duplicateId = out.effects.providerId
  const duplicate = out.catalogue.providers[duplicateId]
  assert.ok(isProviderId(duplicateId))
  assert.notEqual(duplicateId, ctx.id)
  assert.equal(duplicate.name, 'Original (copy)')
  assert.ok(duplicate.quotas.every((q) => isQuotaId(q.id)))
  const originalQuotaIds = new Set(original.quotas.map((q) => q.id))
  assert.ok(duplicate.quotas.every((q) => !originalQuotaIds.has(q.id)), 'no quota id is shared')
  for (const key of ['cost', 'color', 'flags', 'note', 'schedule', 'fits']) assert.deepEqual(duplicate[key], original[key], key)
  assert.deepEqual(duplicate.quotas.map(({ id: _id, ...rest }) => rest), original.quotas.map(({ id: _id, ...rest }) => rest))
  assert.equal(duplicate.createdAt, T1.toISOString())
  assert.equal(duplicate.status, 'active')
  assert.deepEqual(out.catalogue.order, [ctx.id, duplicateId], 'the copy goes after the original')
})

test('the surplus designations are remapped to the new quota ids', () => {
  const ctx = setup()
  const out = copy(ctx)
  const duplicate = out.catalogue.providers[out.effects.providerId]
  assert.equal(duplicate.surplus.tool, 'claude')
  assert.equal(duplicate.surplus.weeklyQuotaId, duplicate.quotas[0].id)
  assert.equal(duplicate.surplus.sessionQuotaId, duplicate.quotas[1].id)
  assert.deepEqual(surplusProblems(duplicate), [])
})

test('the name is made unique with a numeric suffix when taken', () => {
  const ctx = setup()
  const first = copy(ctx)
  const second = duplicateProvider({ catalogue: first.catalogue, state: first.state, id: ctx.id, now: T1, newId: ctx.newId })
  const third = duplicateProvider({ catalogue: second.catalogue, state: second.state, id: ctx.id, now: T1, newId: ctx.newId })
  const names = Object.values(third.catalogue.providers).map((p) => p.name).sort()
  assert.deepEqual(names, ['Original', 'Original (copy 2)', 'Original (copy 3)', 'Original (copy)'])
})

test('a long name is shortened so the copy still fits the 60 character limit', () => {
  const ctx = setup('x'.repeat(60))
  const out = copy(ctx)
  assert.equal(out.ok, true)
  const name = out.catalogue.providers[out.effects.providerId].name
  assert.ok(name.length <= 60)
  assert.ok(name.endsWith('(copy)'))
})

test('quota values are copied with fresh stamps and the reset date is copied', () => {
  const ctx = setup()
  const out = copy(ctx)
  const duplicateId = out.effects.providerId
  const [q1, q2] = out.catalogue.providers[duplicateId].quotas
  const [o1, o2] = ctx.catalogue.providers[ctx.id].quotas
  assert.equal(out.state[duplicateId][q1.id], ctx.state[ctx.id][o1.id])
  assert.equal(out.state[duplicateId][q2.id], ctx.state[ctx.id][o2.id])
  assert.equal(out.state[duplicateId][`__ts_${q1.id}`], T1.toISOString())
  assert.equal(out.state[duplicateId].__last_reset_date, '2026-03-02')
  assert.deepEqual(out.state[ctx.id], ctx.state[ctx.id], 'the original state entry is untouched')
})

test('an unread quota stays unread in the copy', () => {
  const ctx = setup()
  const [o1] = ctx.catalogue.providers[ctx.id].quotas
  const state = { [ctx.id]: { ...ctx.state[ctx.id], [o1.id]: null } }
  const out = duplicateProvider({ catalogue: ctx.catalogue, state, id: ctx.id, now: T1, newId: ctx.newId })
  const [q1] = out.catalogue.providers[out.effects.providerId].quotas
  assert.equal(out.state[out.effects.providerId][q1.id] ?? null, null)
})

test('the copy gets no policy entry: surplus is off and the disclosures must be acknowledged again', () => {
  const ctx = setup()
  const out = copy(ctx)
  assert.equal(out.effects.policyPrune, undefined)
  assert.equal(out.effects.policyEntry, undefined, 'a duplicate never inherits per-provider surplus settings')
})

test('later edits to the copy never change the original and the reverse (FR-010)', () => {
  const ctx = setup()
  const out = copy(ctx)
  const original = out.catalogue.providers[ctx.id]
  const duplicate = out.catalogue.providers[out.effects.providerId]
  assert.equal(original, ctx.catalogue.providers[ctx.id], 'the original object is untouched')
  assert.notEqual(duplicate.flags, original.flags, 'arrays are not shared')
  assert.notEqual(duplicate.quotas, original.quotas)
  assert.notEqual(duplicate.fits, original.fits)
  duplicate.flags.push('changed')
  assert.equal(original.flags.includes('changed'), false)
})

test('an unknown or removed provider cannot be duplicated and nothing changes', () => {
  const ctx = setup()
  const out = duplicateProvider({ catalogue: ctx.catalogue, state: ctx.state, id: 'p_unknownzzzzz', now: T1, newId: ctx.newId })
  assert.equal(out.ok, false)
  assert.equal(out.catalogue, ctx.catalogue)
  assert.equal(out.state, ctx.state)
})
