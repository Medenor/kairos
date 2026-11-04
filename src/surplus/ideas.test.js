import test from 'node:test'
import assert from 'node:assert/strict'
import { PRIORITY, SIZE, STATUS } from './constants.js'
import {
  CONTEXT_LIMIT_CHARS,
  createIdea,
  editIdea,
  reorderIdeas,
  transitionIdea,
  validateIdeaRecord,
  validateIdeaRecords,
} from './ideas.js'

const NOW = new Date('2026-11-03T10:00:00.000Z')
const LATER = new Date('2026-11-03T11:00:00.000Z')

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

function make(overrides = {}) {
  const result = createIdea({ id: 'i1', text: 'Refactor parser', now: NOW, ...overrides })
  assert.equal(result.ok, true)
  return result.idea
}

test('createIdea applies defaults and starts at contentVersion 1', () => {
  const idea = make()
  assert.deepEqual(idea, {
    id: 'i1',
    text: 'Refactor parser',
    context: '',
    workingFolder: null,
    priority: PRIORITY.NORMAL,
    size: SIZE.MEDIUM,
    approvalRequested: false,
    contentVersion: 1,
    status: STATUS.WAITING,
    order: 0,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    serviceId: null,
    resultDecision: null,
    lastRunId: null,
  })
})

test('createIdea keeps the working folder exactly as typed and accepts explicit fields', () => {
  const idea = make({
    workingFolder: '  ~/proj/../My App ',
    context: 'goal: faster',
    priority: PRIORITY.HIGH,
    size: SIZE.LARGE,
    approvalRequested: true,
    order: 4,
  })
  assert.equal(idea.workingFolder, '  ~/proj/../My App ')
  assert.equal(idea.context, 'goal: faster')
  assert.equal(idea.priority, 'high')
  assert.equal(idea.size, 'large')
  assert.equal(idea.approvalRequested, true)
  assert.equal(idea.order, 4)
})

test('createIdea turns an empty working folder into null', () => {
  assert.equal(make({ workingFolder: '' }).workingFolder, null)
})

test('createIdea rejects empty or blank text with a message', () => {
  for (const text of ['', '   ', undefined, 12]) {
    const result = createIdea({ id: 'i1', text, now: NOW })
    assert.equal(result.ok, false)
    assert.equal(result.error.field, 'text')
    assert.equal(result.error.code, 'text_required')
    assert.ok(result.error.message.length > 0)
  }
})

test('createIdea enforces the 10,000 character context limit', () => {
  assert.equal(CONTEXT_LIMIT_CHARS, 10000)
  assert.equal(createIdea({ id: 'i', text: 't', context: 'x'.repeat(10000), now: NOW }).ok, true)
  const result = createIdea({ id: 'i', text: 't', context: 'x'.repeat(10001), now: NOW })
  assert.equal(result.ok, false)
  assert.equal(result.error.field, 'context')
  assert.equal(result.error.code, 'context_too_long')
  assert.match(result.error.message, /10000|10,000/)
})

test('createIdea rejects invalid priority, size, id and now', () => {
  assert.equal(createIdea({ id: 'i', text: 't', priority: 'urgent', now: NOW }).error.field, 'priority')
  assert.equal(createIdea({ id: 'i', text: 't', size: 'huge', now: NOW }).error.field, 'size')
  assert.equal(createIdea({ id: '', text: 't', now: NOW }).error.field, 'id')
  assert.throws(() => createIdea({ id: 'i', text: 't' }), /now/)
})

test('editIdea bumps contentVersion and withdraws approval when text, context or folder changes', () => {
  const idea = deepFreeze(make({ approvalRequested: true }))
  for (const changes of [{ text: 'New text' }, { context: 'more' }, { workingFolder: 'app' }]) {
    const result = editIdea(idea, changes, LATER)
    assert.equal(result.ok, true)
    assert.equal(result.approvalWithdrawn, true)
    assert.equal(result.idea.contentVersion, 2)
    assert.equal(result.idea.updatedAt, LATER.toISOString())
  }
  const both = editIdea(idea, { text: 'a', context: 'b', workingFolder: 'c' }, LATER)
  assert.equal(both.idea.contentVersion, 2, 'one bump per edit, not one per field')
})

test('editIdea does not bump when content is unchanged or only metadata changes', () => {
  const idea = deepFreeze(make({ text: 'same', context: 'ctx', workingFolder: 'app' }))
  const same = editIdea(idea, { text: 'same', context: 'ctx', workingFolder: 'app' }, LATER)
  assert.equal(same.approvalWithdrawn, false)
  assert.equal(same.idea.contentVersion, 1)
  const meta = editIdea(idea, { priority: PRIORITY.LOW, size: SIZE.SMALL, approvalRequested: true }, LATER)
  assert.equal(meta.approvalWithdrawn, false)
  assert.equal(meta.idea.contentVersion, 1)
  assert.equal(meta.idea.priority, 'low')
  assert.equal(meta.idea.size, 'small')
  assert.equal(meta.idea.approvalRequested, true)
  assert.equal(meta.idea.updatedAt, LATER.toISOString())
})

test('editIdea validates changes and ignores runner-owned fields', () => {
  const idea = deepFreeze(make())
  assert.equal(editIdea(idea, { text: ' ' }, LATER).error.code, 'text_required')
  assert.equal(editIdea(idea, { context: 'x'.repeat(10001) }, LATER).error.code, 'context_too_long')
  const result = editIdea(idea, { status: STATUS.COMPLETED, id: 'other', serviceId: 'claude', contentVersion: 9 }, LATER)
  assert.equal(result.ok, true)
  assert.equal(result.idea.status, STATUS.WAITING)
  assert.equal(result.idea.id, 'i1')
  assert.equal(result.idea.serviceId, null)
  assert.equal(result.idea.contentVersion, 1)
})

test('transitionIdea allows every edge of the state diagram', () => {
  const edges = [
    ['waiting', 'launched_manually', { serviceId: 'claude' }],
    ['waiting', 'running', { serviceId: 'claude' }],
    ['running', 'completed', {}],
    ['running', 'failed', {}],
    ['running', 'needs_input', {}],
    ['failed', 'waiting', {}],
    ['needs_input', 'waiting', {}],
    ['completed', 'waiting', {}],
    ['launched_manually', 'waiting', {}],
    ['waiting', 'archived', {}],
    ['completed', 'archived', {}],
    ['failed', 'archived', {}],
    ['launched_manually', 'archived', {}],
  ]
  for (const [from, to, options] of edges) {
    const idea = deepFreeze({ ...make(), status: from, serviceId: from === 'waiting' ? null : 'claude' })
    const next = transitionIdea(idea, to, { now: LATER, ...options })
    assert.equal(next.status, to, `${from} -> ${to}`)
    assert.equal(next.updatedAt, LATER.toISOString())
  }
})

test('transitionIdea rejects every edge missing from the diagram', () => {
  const allowed = new Set([
    'waiting>launched_manually', 'waiting>running', 'running>completed', 'running>failed',
    'running>needs_input', 'failed>waiting', 'needs_input>waiting', 'completed>waiting',
    'launched_manually>waiting', 'waiting>archived', 'completed>archived', 'failed>archived',
    'launched_manually>archived',
  ])
  for (const from of Object.values(STATUS)) {
    for (const to of Object.values(STATUS)) {
      if (allowed.has(`${from}>${to}`)) continue
      const idea = { ...make(), status: from, serviceId: 'claude' }
      assert.throws(() => transitionIdea(idea, to, { now: LATER, serviceId: 'claude' }), /transition/i, `${from} -> ${to}`)
    }
  }
  assert.throws(() => transitionIdea(make(), 'bogus', { now: LATER }), /status/i)
})

test('transitionIdea records serviceId, lastRunId and resultDecision, and clears serviceId on requeue', () => {
  const running = transitionIdea(make(), STATUS.RUNNING, { now: LATER, serviceId: 'chatgpt', lastRunId: 'r1' })
  assert.equal(running.serviceId, 'chatgpt')
  assert.equal(running.lastRunId, 'r1')
  const done = transitionIdea(running, STATUS.COMPLETED, { now: LATER })
  assert.equal(done.serviceId, 'chatgpt')
  assert.equal(done.lastRunId, 'r1')
  const requeued = transitionIdea(done, STATUS.WAITING, { now: LATER, resultDecision: 'requeued' })
  assert.equal(requeued.serviceId, null)
  assert.equal(requeued.resultDecision, 'requeued')
  assert.equal(requeued.lastRunId, 'r1', 'last run stays reviewable')
  assert.equal(requeued.contentVersion, 1)
})

test('transitionIdea requires a supported serviceId to launch or run, and a valid resultDecision', () => {
  assert.throws(() => transitionIdea(make(), STATUS.RUNNING, { now: LATER }), /serviceId/)
  assert.throws(() => transitionIdea(make(), STATUS.LAUNCHED_MANUALLY, { now: LATER, serviceId: 'gemini' }), /serviceId/)
  const idea = { ...make(), status: STATUS.COMPLETED }
  assert.throws(() => transitionIdea(idea, STATUS.WAITING, { now: LATER, resultDecision: 'maybe' }), /resultDecision/)
})

test('reorderIdeas renumbers listed ideas in the given order and leaves input untouched', () => {
  const ideas = deepFreeze([
    make({ id: 'a', order: 1 }),
    make({ id: 'b', order: 2 }),
    make({ id: 'c', order: 3 }),
  ])
  const next = reorderIdeas(ideas, ['c', 'a', 'b'], LATER)
  assert.deepEqual(next.map((i) => i.id), ['a', 'b', 'c'], 'array positions are preserved')
  assert.deepEqual(Object.fromEntries(next.map((i) => [i.id, i.order])), { c: 1, a: 2, b: 3 })
  assert.equal(next.find((i) => i.id === 'c').updatedAt, LATER.toISOString())
  assert.equal(next.find((i) => i.id === 'a').contentVersion, 1)
})

test('reorderIdeas leaves unchanged ideas alone and rejects unknown or duplicate ids', () => {
  const ideas = deepFreeze([make({ id: 'a', order: 1 }), make({ id: 'b', order: 2 })])
  const same = reorderIdeas(ideas, ['a', 'b'], LATER)
  assert.deepEqual(same, ideas)
  assert.throws(() => reorderIdeas(ideas, ['a', 'zzz'], LATER), /unknown/i)
  assert.throws(() => reorderIdeas(ideas, ['a', 'a'], LATER), /duplicate/i)
})

test('validateIdeaRecord accepts a well-formed record unchanged', () => {
  const record = make()
  const result = validateIdeaRecord(record)
  assert.equal(result.valid, true)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.idea, record)
})

test('validateIdeaRecord rejects type, enum and length violations', () => {
  const base = make()
  const bad = [
    [null, 'record'],
    ['text', 'record'],
    [{ ...base, id: '' }, 'id'],
    [{ ...base, text: '' }, 'text'],
    [{ ...base, text: 42 }, 'text'],
    [{ ...base, context: 'x'.repeat(10001) }, 'context'],
    [{ ...base, context: 5 }, 'context'],
    [{ ...base, workingFolder: 7 }, 'workingFolder'],
    [{ ...base, priority: 'urgent' }, 'priority'],
    [{ ...base, size: 'xl' }, 'size'],
    [{ ...base, status: 'done' }, 'status'],
    [{ ...base, contentVersion: 0 }, 'contentVersion'],
    [{ ...base, contentVersion: 1.5 }, 'contentVersion'],
    [{ ...base, approvalRequested: 'yes' }, 'approvalRequested'],
    [{ ...base, order: NaN }, 'order'],
    [{ ...base, createdAt: 'yesterday' }, 'createdAt'],
    [{ ...base, updatedAt: null }, 'updatedAt'],
    [{ ...base, serviceId: 3 }, 'serviceId'],
    [{ ...base, resultDecision: 'maybe' }, 'resultDecision'],
    [{ ...base, lastRunId: 3 }, 'lastRunId'],
  ]
  for (const [record, field] of bad) {
    const result = validateIdeaRecord(record)
    assert.equal(result.valid, false, `${field} should be invalid`)
    assert.ok(result.errors.some((e) => e.field === field), `error for ${field}`)
    assert.equal(result.idea, undefined)
  }
})

test('validateIdeaRecords splits valid ideas from an invalid list that is never runnable', () => {
  const good = make({ id: 'good' })
  const broken = { ...make({ id: 'broken' }), size: 'xl' }
  const { ideas, invalid } = validateIdeaRecords([good, broken, null, { id: 'nope' }])
  assert.deepEqual(ideas, [good])
  assert.equal(invalid.length, 3)
  assert.equal(invalid[0].id, 'broken')
  assert.ok(invalid[0].errors.length > 0)
  assert.equal(invalid[1].id, null)
  assert.equal(invalid[2].id, 'nope')
})
