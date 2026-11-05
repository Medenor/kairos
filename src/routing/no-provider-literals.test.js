// FR-011, research D18: no provider is named in the shipped logic. Scans the non-test sources of
// src/providers, src/routing, src/surplus and runner for the former provider names and ids.
// Each allow-list entry names the file and the reason.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const DIRS = ['src/providers', 'src/routing', 'src/surplus', 'runner']

// Vendor names that must never appear (the allow-list entries may).
const PROVIDER_WORDS = ['chatgpt', 'copilot', 'openrouter', 'kilocode']
// Tool names: terminal tools the runner has adapters for. They name tools, not providers.
const TOOL_WORDS = ['claude', 'codex']

const ALLOW_PROVIDER_WORDS = {
  'runner/preflight.js': 'the codex login-status text "Logged in using ChatGPT" and its messages',
  'src/providers/legacyProviders.js': 'display-only table of the five former services (old records still carry their ids)',
  'src/providers/ids.js': 'the five former service ids, recognised as legacy and never generated',
}
const ALLOW_TOOL_WORDS = {
  'src/providers/surplusProfile.js': 'SUPPORTED_TOOLS lists the runner tool names',
  'src/providers/legacyProviders.js': 'display-only table of the five former services',
  'src/providers/ids.js': 'the five former service ids, recognised as legacy and never generated',
  'src/surplus/constants.js': 'tool names, if it still lists tools',
  'src/surplus/instruction.js': 'official non-interactive command per tool for the manual launch instruction',
  'runner/adapters/claude.js': 'tool adapter',
  'runner/adapters/codex.js': 'tool adapter',
  'runner/preflight.js': 'tool names and login-status checks',
  'runner/config.js': 'default tool paths',
  'runner/loop.js': 'adapter table keyed by tool name',
}

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === 'fixtures' || entry === 'node_modules') continue
      yield* sourceFiles(path)
    } else if (/\.(js|jsx)$/.test(entry) && !/\.test\.js$/.test(entry) && !/\.testkit\.js$/.test(entry)) {
      yield path
    }
  }
}

function findings() {
  const out = []
  for (const dir of DIRS) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      const rel = relative(ROOT, file)
      const text = readFileSync(file, 'utf8').toLowerCase()
      for (const word of PROVIDER_WORDS) if (text.includes(word) && !ALLOW_PROVIDER_WORDS[rel]) out.push(`${rel}: "${word}"`)
      for (const word of TOOL_WORDS) if (text.includes(word) && !ALLOW_TOOL_WORDS[rel]) out.push(`${rel}: "${word}"`)
    }
  }
  return out
}

test('no provider name appears in shipped logic outside the documented allow-list', () => {
  assert.deepEqual(findings(), [])
})

test('the allow-list only names files that exist', () => {
  for (const rel of [...Object.keys(ALLOW_PROVIDER_WORDS), ...Object.keys(ALLOW_TOOL_WORDS)]) {
    assert.doesNotThrow(() => statSync(join(ROOT, rel)), rel)
  }
})

test('the routing engine itself never names a provider or a tool', () => {
  const text = readFileSync(join(ROOT, 'src/routing/engine.js'), 'utf8').toLowerCase()
  for (const word of [...PROVIDER_WORDS, ...TOOL_WORDS]) assert.equal(text.includes(word), false, word)
})
