import test from 'node:test'
import assert from 'node:assert/strict'
import { buildManualInstruction } from './instruction.js'

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

const IDEA = deepFreeze({
  id: 'idea-1',
  text: 'Refactor the export module to stream large files',
  context: 'The export currently builds the whole CSV in memory.',
  workingFolder: 'kairos/src/services',
  status: 'waiting',
})

test('includes the idea text, the context and the working folder as typed', () => {
  const out = buildManualInstruction(IDEA, 'claude')
  assert.ok(out.includes(IDEA.text))
  assert.ok(out.includes(IDEA.context))
  assert.ok(out.includes('kairos/src/services'))
})

test('states the official tool command for claude (print mode)', () => {
  const out = buildManualInstruction(IDEA, 'claude')
  assert.ok(out.includes('claude -p'))
  assert.ok(!out.includes('codex exec'))
})

test('states the official tool command for chatgpt (codex exec)', () => {
  const out = buildManualInstruction(IDEA, 'chatgpt')
  assert.ok(out.includes('codex exec'))
  assert.ok(!out.includes('claude -p'))
})

test('is pure and deterministic: same input gives the same output', () => {
  const first = buildManualInstruction(IDEA, 'claude')
  const second = buildManualInstruction(IDEA, 'claude')
  assert.equal(first, second)
})

test('does not mutate the idea', () => {
  const copy = JSON.parse(JSON.stringify(IDEA))
  buildManualInstruction(IDEA, 'chatgpt')
  assert.deepEqual(IDEA, copy)
})

test('handles missing context with a placeholder, never undefined or null', () => {
  for (const context of [undefined, null, '']) {
    const out = buildManualInstruction({ ...IDEA, context }, 'claude')
    assert.ok(out.includes(IDEA.text))
    assert.ok(!/\bundefined\b|\bnull\b/.test(out), `context ${String(context)} leaked into output`)
  }
})

test('handles missing working folder with a placeholder, never undefined or null', () => {
  for (const workingFolder of [undefined, null, '']) {
    const out = buildManualInstruction({ ...IDEA, workingFolder }, 'claude')
    assert.ok(out.includes(IDEA.text))
    assert.ok(!/\bundefined\b|\bnull\b/.test(out), `folder ${String(workingFolder)} leaked into output`)
  }
})

test('copies the working folder verbatim, without shell quoting or escaping', () => {
  const folder = `/Users/me/My Projects/it's "odd" $(whoami)`
  const out = buildManualInstruction({ ...IDEA, workingFolder: folder }, 'claude')
  assert.ok(out.includes(folder))
  assert.ok(!out.includes('\\'))
})

test('rejects an unsupported service', () => {
  assert.throws(() => buildManualInstruction(IDEA, 'copilot'), TypeError)
  assert.throws(() => buildManualInstruction(IDEA, undefined), TypeError)
})
