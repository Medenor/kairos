// CLI tests for the provider allowance (feature 007, T104): allow, disallow and the status additions.
// `main(argv, io)` with an injected terminal and the fake shared-state API; no real tools or network.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { rmSync } from 'node:fs'
import { afterEach, describe, test } from 'node:test'
import { providerKey } from '../src/providers/records.js'
import { loadConfig, saveConfig } from './config.js'
import { EXIT_CODES, main } from './index.js'
import { CHATGPT_ID, CLAUDE_ID, WORLD_PROVIDERS, providerRecord, withWorld } from './loop.testkit.js'

const dirs = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function harness({ world, answers = [] }) {
  const out = []
  const err = []
  const queue = [...answers]
  const terminal = { write: (t) => out.push(t), ask: async () => (queue.length > 0 ? queue.shift() : null), close() {} }
  const io = {
    stdout: { write: (t) => out.push(t) },
    stderr: { write: (t) => err.push(t) },
    baseDir: world.baseDir,
    homeDir: world.homeDir,
    env: { PATH: process.env.PATH },
    now: world.clock.now,
    createApi: () => world.client,
    createTerminal: () => terminal,
    signals: new EventEmitter(),
  }
  return { io, stdout: () => out.join(''), stderr: () => err.join('') }
}

async function run(world, argv, answers = []) {
  const h = harness({ world, answers })
  const code = await main(argv, h.io)
  return { code, stdout: h.stdout(), stderr: h.stderr() }
}

// A world whose local config allows nothing yet: the user has to run `allow`.
const withUnallowed = (options, fn) => withWorld({ configPatch: { allowProviders: [] }, ...options }, async (world) => {
  saveConfig(world.baseDir, world.config)
  return fn(world)
})

const allowed = (world) => loadConfig(world.baseDir).config.allowProviders

describe('allow', () => {
  test('lists the eligible catalogue providers (name, tool, quota labels) when given no argument, and changes nothing', () =>
    withUnallowed({}, async (world) => {
      world.putRouting(providerKey(CHATGPT_ID), providerRecord('chatgpt'))
      world.putRouting('provider:p_noeligibleaaa', providerRecord('claude', { id: 'p_noeligibleaaa', name: 'No tool', surplus: null }))
      const { code, stdout } = await run(world, ['allow'])
      assert.equal(code, EXIT_CODES.OK)
      assert.match(stdout, /Alpha Claude/)
      assert.match(stdout, /tool claude/)
      assert.match(stdout, /Weekly quota/)
      assert.match(stdout, /Beta Codex/)
      assert.match(stdout, /tool codex/)
      assert.doesNotMatch(stdout, /No tool/, 'a provider without an eligible profile is not offered')
      assert.deepEqual(allowed(world), [])
    }))

  test('requires an explicit "yes", then stores the id, the pinned tool, the name and the time', () =>
    withUnallowed({}, async (world) => {
      const declined = await run(world, ['allow', 'alpha claude'], ['no'])
      assert.equal(declined.code, EXIT_CODES.OK)
      assert.match(declined.stdout, /Not allowed/)
      assert.deepEqual(allowed(world), [])

      const { code, stdout } = await run(world, ['allow', 'ALPHA CLAUDE'], ['yes'])
      assert.equal(code, EXIT_CODES.OK)
      assert.match(stdout, /pinned to the claude tool/)
      assert.deepEqual(allowed(world), [{ providerId: CLAUDE_ID, tool: 'claude', name: 'Alpha Claude', allowedAt: world.clock.now().toISOString() }])
    }))

  test('resolves an id as well as a unique case-folded name', () =>
    withUnallowed({}, async (world) => {
      const byId = await run(world, ['allow', CLAUDE_ID], ['yes'])
      assert.equal(byId.code, EXIT_CODES.OK)
      assert.equal(allowed(world).length, 1)
      assert.equal(allowed(world)[0].providerId, CLAUDE_ID)
    }))

  test('an unknown name fails with the candidates and a non-zero exit', () =>
    withUnallowed({}, async (world) => {
      const { code, stderr } = await run(world, ['allow', 'nobody'])
      assert.notEqual(code, EXIT_CODES.OK)
      assert.match(stderr, /No eligible provider matches/)
      assert.match(stderr, /Alpha Claude/)
      assert.deepEqual(allowed(world), [])
    }))

  test('an ambiguous name fails with the candidates; the id still works', () =>
    withUnallowed({}, async (world) => {
      world.putRouting('provider:p_twinaaaaaaaa', providerRecord('claude', { id: 'p_twinaaaaaaaa', name: 'alpha claude' }))
      const { code, stderr } = await run(world, ['allow', 'Alpha Claude'])
      assert.notEqual(code, EXIT_CODES.OK)
      assert.match(stderr, /Several providers match/)
      assert.match(stderr, /p_twinaaaaaaaa/)
      assert.match(stderr, new RegExp(CLAUDE_ID))
      assert.deepEqual(allowed(world), [])
    }))

  test('a provider without an eligible profile or a removed one cannot be allowed', () =>
    withUnallowed({}, async (world) => {
      world.setProvider({ surplus: null })
      const none = await run(world, ['allow', 'Alpha Claude'])
      assert.notEqual(none.code, EXIT_CODES.OK)
      world.putRouting(providerKey(CLAUDE_ID), { schemaVersion: 1, id: CLAUDE_ID, status: 'removed', name: 'Alpha Claude', removedAt: world.clock.now().toISOString() })
      const removed = await run(world, ['allow', CLAUDE_ID], ['yes'])
      assert.notEqual(removed.code, EXIT_CODES.OK)
      assert.deepEqual(allowed(world), [])
    }))

  test('allowing again after a tool change re-pins the new tool', () =>
    withWorld({}, async (world) => {
      saveConfig(world.baseDir, world.config)
      const spec = WORLD_PROVIDERS.claude
      world.setProvider({ surplus: { tool: 'codex', weeklyQuotaId: spec.weekly.id, sessionQuotaId: spec.session.id } })
      const { code } = await run(world, ['allow', CLAUDE_ID], ['yes'])
      assert.equal(code, EXIT_CODES.OK)
      assert.deepEqual(allowed(world).map((e) => [e.providerId, e.tool]), [[CLAUDE_ID, 'codex']])
    }))
})

describe('disallow', () => {
  test('removes the entry by name or id', () =>
    withWorld({}, async (world) => {
      saveConfig(world.baseDir, world.config)
      assert.equal(allowed(world).length, 1)
      const { code, stdout } = await run(world, ['disallow', 'alpha claude'])
      assert.equal(code, EXIT_CODES.OK)
      assert.match(stdout, /no longer allowed/)
      assert.deepEqual(allowed(world), [])
    }))

  test('works for an id that is no longer in the catalogue', () =>
    withWorld({}, async (world) => {
      saveConfig(world.baseDir, world.config)
      world.putRouting(providerKey(CLAUDE_ID), { schemaVersion: 1, id: CLAUDE_ID, status: 'removed', name: 'Gone', removedAt: world.clock.now().toISOString() })
      const { code } = await run(world, ['disallow', CLAUDE_ID])
      assert.equal(code, EXIT_CODES.OK)
      assert.deepEqual(allowed(world), [])
    }))

  test('an unknown argument or none is a usage error and keeps the allowance', () =>
    withWorld({}, async (world) => {
      saveConfig(world.baseDir, world.config)
      assert.equal((await run(world, ['disallow', 'nobody'])).code, EXIT_CODES.USAGE)
      assert.equal((await run(world, ['disallow'])).code, EXIT_CODES.USAGE)
      assert.equal(allowed(world).length, 1)
    }))
})

describe('status', () => {
  const statusOf = async (world) => (await run(world, ['status'])).stdout

  test('lists allowed providers with their catalogue state: ok', () =>
    withWorld({}, async (world) => {
      saveConfig(world.baseDir, world.config)
      assert.match(await statusOf(world), /Alpha Claude\s+p_claudeaaaaaa\s+claude: ok/)
    }))

  test('flags a tool change in the store', () =>
    withWorld({}, async (world) => {
      saveConfig(world.baseDir, world.config)
      const spec = WORLD_PROVIDERS.claude
      world.setProvider({ surplus: { tool: 'codex', weeklyQuotaId: spec.weekly.id, sessionQuotaId: spec.session.id } })
      assert.match(await statusOf(world), /tool changed \(pinned claude, now codex\)/)
    }))

  test('flags a removed provider and a provider that is not eligible any more', () =>
    withWorld({}, async (world) => {
      saveConfig(world.baseDir, world.config)
      world.setProvider({ schedule: { type: 'monthly', cycleDays: 30 } })
      assert.match(await statusOf(world), /not eligible \(.*weekly/i)
      world.putRouting(providerKey(CLAUDE_ID), { schemaVersion: 1, id: CLAUDE_ID, status: 'removed', name: 'Alpha Claude', removedAt: world.clock.now().toISOString() })
      assert.match(await statusOf(world), /claude: removed/)
    }))

  test('says (none) when nothing is allowed and keeps the v1 allowance out of sight', () =>
    withUnallowed({ configPatch: { allowProviders: [], legacyAllowServices: ['claude'] } }, async (world) => {
      const out = await statusOf(world)
      assert.match(out, /allowed providers: \(none\)/)
      assert.doesNotMatch(out, /Alpha Claude\s+p_/)
    }))

  test('start refuses to run with nothing allowed and points to allow', () =>
    withUnallowed({}, async (world) => {
      const { code, stderr } = await run(world, ['start'])
      assert.equal(code, EXIT_CODES.USAGE)
      assert.match(stderr, /allow <provider>/)
    }))
})

describe('the old allowServices command is gone', () => {
  test('the config wizard no longer asks for services and the help documents allow and disallow', async () => {
    await withUnallowed({}, async (world) => {
      const h = harness({ world })
      assert.equal(await main(['--help'], h.io), 0)
      assert.match(h.stdout(), /allow \[name-or-id\]/)
      assert.match(h.stdout(), /disallow <name-or-id>/)
      assert.doesNotMatch(h.stdout(), /allowed services/)
    })
  })
})
