import test from 'node:test'
import assert from 'node:assert/strict'
import { buildManualInstruction } from './instruction.js'
import { sampleServices } from '../providers/fixtures/sampleProviders.js'

const CLAUDE_SERVICE = sampleServices()[0]
const CODEX_SERVICE = { ...CLAUDE_SERVICE, name: 'Codex provider', surplus: { ...CLAUDE_SERVICE.surplus, tool: 'codex' } }

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
  const out = buildManualInstruction(IDEA, CLAUDE_SERVICE)
  assert.ok(out.includes(IDEA.text))
  assert.ok(out.includes(IDEA.context))
  assert.ok(out.includes('kairos/src/services'))
})

test('states the official tool command for claude (print mode)', () => {
  const out = buildManualInstruction(IDEA, CLAUDE_SERVICE)
  assert.ok(out.includes('claude -p'))
  assert.ok(!out.includes('codex exec'))
})

test('states the official tool command for a codex provider (codex exec)', () => {
  const out = buildManualInstruction(IDEA, CODEX_SERVICE)
  assert.ok(out.includes('codex exec'))
  assert.ok(!out.includes('claude -p'))
})

test('is pure and deterministic: same input gives the same output', () => {
  const first = buildManualInstruction(IDEA, CLAUDE_SERVICE)
  const second = buildManualInstruction(IDEA, CLAUDE_SERVICE)
  assert.equal(first, second)
})

test('does not mutate the idea', () => {
  const copy = JSON.parse(JSON.stringify(IDEA))
  buildManualInstruction(IDEA, CODEX_SERVICE)
  assert.deepEqual(IDEA, copy)
})

test('handles missing context with a placeholder, never undefined or null', () => {
  for (const context of [undefined, null, '']) {
    const out = buildManualInstruction({ ...IDEA, context }, CLAUDE_SERVICE)
    assert.ok(out.includes(IDEA.text))
    assert.ok(!/\bundefined\b|\bnull\b/.test(out), `context ${String(context)} leaked into output`)
  }
})

test('handles missing working folder with a placeholder, never undefined or null', () => {
  for (const workingFolder of [undefined, null, '']) {
    const out = buildManualInstruction({ ...IDEA, workingFolder }, CLAUDE_SERVICE)
    assert.ok(out.includes(IDEA.text))
    assert.ok(!/\bundefined\b|\bnull\b/.test(out), `folder ${String(workingFolder)} leaked into output`)
  }
})

test('copies the working folder verbatim, without shell quoting or escaping', () => {
  const folder = `/Users/me/My Projects/it's "odd" $(whoami)`
  const out = buildManualInstruction({ ...IDEA, workingFolder: folder }, CLAUDE_SERVICE)
  assert.ok(out.includes(folder))
  assert.ok(!out.includes('\\'))
})

test('names the provider the idea is suggested for', () => {
  assert.ok(buildManualInstruction(IDEA, CLAUDE_SERVICE).startsWith('Task for Alpha Weekly:'))
})

test('rejects a provider without a supported terminal tool', () => {
  assert.throws(() => buildManualInstruction(IDEA, { ...CLAUDE_SERVICE, surplus: null }), TypeError)
  assert.throws(() => buildManualInstruction(IDEA, { ...CLAUDE_SERVICE, surplus: { tool: 'bash' } }), TypeError)
  assert.throws(() => buildManualInstruction(IDEA, undefined), TypeError)
})
