// Runner config v2 (feature 007, T101): a local allowance pinned to provider id and tool; v1 files load with
// nothing allowed and their `allowServices` kept verbatim.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_SCHEMA_VERSION, defaultConfig, loadConfig, runnerPaths, saveConfig, updateConfig, validateConfig } from './config.js'
import { LEGACY_RUNNER_CONFIG_V1 } from '../src/providers/fixtures/legacyData.js'

const AT = '2026-11-03T10:00:00.000Z'
const entry = (patch = {}) => ({ providerId: 'p_allowedaaaaa', tool: 'claude', name: 'Allowed', allowedAt: AT, ...patch })
const base = () => ({ ...defaultConfig({ deviceId: 'dev', deviceName: 'Box' }), workspaceId: 'ws-1' })
const tempBase = () => mkdtempSync(join(tmpdir(), 'kairos-config-'))

test('schema version 2 and an empty allowance by default', () => {
  assert.equal(CONFIG_SCHEMA_VERSION, 2)
  const config = defaultConfig({ deviceId: 'd', deviceName: 'n' })
  assert.deepEqual(config.allowProviders, [])
  assert.equal(config.allowServices, undefined)
})

test('a v1 file loads as v2: nothing allowed, allowServices preserved untouched under legacyAllowServices', () => {
  const dir = tempBase()
  writeFileSync(runnerPaths(dir).config, JSON.stringify(LEGACY_RUNNER_CONFIG_V1))
  const loaded = loadConfig(dir)
  assert.equal(loaded.ok, true)
  assert.equal(loaded.config.schemaVersion, 2)
  assert.deepEqual(loaded.config.allowProviders, [])
  assert.deepEqual(loaded.config.legacyAllowServices, ['claude'])
  assert.equal(loaded.config.allowServices, undefined)
})

test('the legacy allowance survives the next save byte for byte and is never read as an allowance', () => {
  const dir = tempBase()
  writeFileSync(runnerPaths(dir).config, JSON.stringify(LEGACY_RUNNER_CONFIG_V1))
  const loaded = loadConfig(dir).config
  const saved = saveConfig(dir, { ...loaded, allowProviders: [entry()] })
  assert.deepEqual(saved.legacyAllowServices, ['claude'])
  const onDisk = JSON.parse(readFileSync(runnerPaths(dir).config, 'utf8'))
  assert.equal(JSON.stringify(onDisk.legacyAllowServices), JSON.stringify(LEGACY_RUNNER_CONFIG_V1.allowServices))
  assert.equal(onDisk.allowServices, undefined)
  assert.equal(onDisk.allowProviders.length, 1)
})

test('allowProviders entries need a provider id, a supported tool, a name and an ISO date', () => {
  assert.equal(validateConfig({ ...base(), allowProviders: [entry()] }).valid, true)
  assert.equal(validateConfig({ ...base(), allowProviders: [entry({ tool: 'codex' })] }).valid, true)
  const cases = [
    [{ providerId: 'claude' }, 'allowProviders[0].providerId'],
    [{ providerId: 'p_short' }, 'allowProviders[0].providerId'],
    [{ tool: 'bash' }, 'allowProviders[0].tool'],
    [{ name: '' }, 'allowProviders[0].name'],
    [{ allowedAt: 'yesterday' }, 'allowProviders[0].allowedAt'],
  ]
  for (const [patch, field] of cases) {
    const result = validateConfig({ ...base(), allowProviders: [entry(patch)] })
    assert.equal(result.valid, false, JSON.stringify(patch))
    assert.ok(result.errors.some((e) => e.field === field), `${field} in ${JSON.stringify(result.errors)}`)
  }
  assert.equal(validateConfig({ ...base(), allowProviders: 'p_allowedaaaaa' }).valid, false)
})

test('duplicate provider ids collapse to the first entry; unknown keys are still dropped', () => {
  const { config } = validateConfig({ ...base(), surprise: 1, allowProviders: [entry(), entry({ tool: 'codex' }), entry({ providerId: 'p_otherzzzzzzz', name: 'Other' })] })
  assert.deepEqual(config.allowProviders.map((e) => [e.providerId, e.tool]), [['p_allowedaaaaa', 'claude'], ['p_otherzzzzzzz', 'claude']])
  assert.equal(config.surprise, undefined)
  assert.deepEqual(Object.keys(config.allowProviders[0]).sort(), ['allowedAt', 'name', 'providerId', 'tool'])
})

test('tools and limits merge as before and the allowance is replaced as a whole by updateConfig', () => {
  const dir = tempBase()
  updateConfig(dir, { workspaceId: 'ws-1', allowProviders: [entry()] }, { deviceId: 'dev', deviceName: 'Box' })
  const next = updateConfig(dir, { tools: { claude: '/opt/claude' }, limits: { leaseSeconds: 30 } })
  assert.equal(next.tools.claude, '/opt/claude')
  assert.equal(next.tools.codex, 'codex')
  assert.equal(next.limits.leaseSeconds, 30)
  assert.deepEqual(next.allowProviders, [entry()])
  assert.deepEqual(updateConfig(dir, { allowProviders: [] }).allowProviders, [])
})
