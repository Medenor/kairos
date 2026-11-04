import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PassThrough } from 'node:stream'
import {
  DEFAULT_EXCLUSIONS,
  DEFAULT_LIMITS,
  ConfigError,
  addExclusion,
  createTerminalIO,
  defaultBaseDir,
  defaultConfig,
  editExclusions,
  loadConfig,
  removeExclusion,
  resetExclusions,
  runConfigWizard,
  runnerPaths,
  saveConfig,
  takeOver,
  updateConfig,
  validateConfig,
  writeSecureFile,
} from './config.js'
import { createApiClient } from './api-client.js'
import { start } from './fixtures/fake-api.js'

const TMP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-tmp')
const created = []
function tempBase() {
  mkdirSync(TMP_ROOT, { recursive: true })
  const dir = mkdtempSync(join(TMP_ROOT, 'config-'))
  created.push(dir)
  return join(dir, '.kairos-runner')
}
test.after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

const valid = (extra = {}) => ({ ...defaultConfig({ deviceId: 'dev-1', deviceName: 'Laptop' }), workspaceId: 'ws-1', ...extra })
const mode = (path) => statSync(path).mode & 0o777

test('defaultBaseDir uses KAIROS_RUNNER_HOME or ~/.kairos-runner', () => {
  assert.equal(defaultBaseDir({ env: {}, home: '/home/u' }), '/home/u/.kairos-runner')
  assert.equal(defaultBaseDir({ env: { KAIROS_RUNNER_HOME: '/x/r' }, home: '/home/u' }), '/x/r')
})

test('saveConfig creates the directory 0700 and config.json 0600 and loadConfig round-trips', () => {
  const base = tempBase()
  const saved = saveConfig(base, valid())
  assert.equal(mode(base), 0o700)
  assert.equal(mode(runnerPaths(base).config), 0o600)
  const loaded = loadConfig(base)
  assert.equal(loaded.ok, true)
  assert.deepEqual(loaded.config, saved)
  assert.equal(loaded.config.deviceId, 'dev-1')
  assert.deepEqual(loaded.config.exclusions, [...DEFAULT_EXCLUSIONS])
  assert.deepEqual(loaded.config.limits, { ...DEFAULT_LIMITS })
  assert.equal(loaded.config.limits.evalIntervalMinutes, 15)
  assert.deepEqual(loaded.config.allowServices, [])
})

test('an existing wider-permission directory is tightened to 0700', () => {
  const base = tempBase()
  mkdirSync(base, { recursive: true, mode: 0o755 })
  saveConfig(base, valid())
  assert.equal(mode(base), 0o700)
})

test('loadConfig reports missing, invalid_json and invalid without throwing', () => {
  const base = tempBase()
  assert.deepEqual(loadConfig(base), { ok: false, reason: 'missing', errors: [] })
  writeSecureFile(runnerPaths(base).config, '{not json')
  assert.equal(loadConfig(base).reason, 'invalid_json')
  writeSecureFile(runnerPaths(base).config, JSON.stringify({ deviceId: 'x' }))
  const invalid = loadConfig(base)
  assert.equal(invalid.reason, 'invalid')
  assert.ok(invalid.errors.some((e) => e.field === 'workspaceId'))
})

test('validateConfig rejects bad fields with a field name each', () => {
  const cases = [
    [{ deviceId: '' }, 'deviceId'],
    [{ deviceName: 5 }, 'deviceName'],
    [{ apiBase: 'ftp://host' }, 'apiBase'],
    [{ apiBase: 'nope' }, 'apiBase'],
    [{ workspaceId: '' }, 'workspaceId'],
    [{ projectsBaseFolder: 'relative/dir' }, 'projectsBaseFolder'],
    [{ allowServices: ['copilot'] }, 'allowServices'],
    [{ allowServices: 'claude' }, 'allowServices'],
    [{ tools: { claude: '' } }, 'tools.claude'],
    [{ exclusions: ['ok', ''] }, 'exclusions'],
    [{ exclusions: ['/etc'] }, 'exclusions'],
    [{ exclusions: ['../up'] }, 'exclusions'],
    [{ limits: { copyLimitBytes: 0 } }, 'limits.copyLimitBytes'],
    [{ limits: { evalIntervalMinutes: 'soon' } }, 'limits.evalIntervalMinutes'],
  ]
  for (const [patch, field] of cases) {
    const result = validateConfig({ ...valid(), ...patch })
    assert.equal(result.valid, false, JSON.stringify(patch))
    assert.ok(result.errors.some((e) => e.field === field), `${field} in ${JSON.stringify(result.errors)}`)
  }
  assert.equal(validateConfig('x').valid, false)
  assert.equal(validateConfig(valid()).valid, true)
})

test('validateConfig normalises: dedupes services and exclusions, trims, drops unknown keys, strips trailing slash', () => {
  const { config } = validateConfig({
    ...valid(),
    apiBase: 'http://host:8080/api/v1/',
    allowServices: ['claude', 'claude', 'chatgpt'],
    exclusions: [' .env* ', '.env*', 'dist'],
    deviceName: ' Laptop ',
    surprise: true,
    limits: { heartbeatSeconds: 0.5, unknown: 1 },
  })
  assert.equal(config.apiBase, 'http://host:8080/api/v1')
  assert.deepEqual(config.allowServices, ['claude', 'chatgpt'])
  assert.deepEqual(config.exclusions, ['.env*', 'dist'])
  assert.equal(config.deviceName, 'Laptop')
  assert.equal(config.surprise, undefined)
  assert.equal(config.limits.heartbeatSeconds, 0.5)
  assert.equal(config.limits.unknown, undefined)
  assert.equal(config.limits.leaseSeconds, 180)
})

test('saveConfig throws ConfigError for an invalid config and writes nothing', () => {
  const base = tempBase()
  assert.throws(() => saveConfig(base, valid({ workspaceId: '' })), (e) => e instanceof ConfigError && e.errors[0].field === 'workspaceId')
  assert.equal(existsSync(runnerPaths(base).config), false)
})

test('updateConfig starts from defaults, merges tools and limits, keeps the device id', () => {
  const base = tempBase()
  assert.throws(() => updateConfig(base, {}), ConfigError) // no workspace yet
  const first = updateConfig(base, { workspaceId: 'ws-1', allowServices: ['claude'], limits: { evalIntervalMinutes: 5 } }, { deviceId: 'dev-9', deviceName: 'Box' })
  assert.equal(first.deviceId, 'dev-9')
  assert.equal(first.limits.evalIntervalMinutes, 5)
  const second = updateConfig(base, { tools: { claude: '/opt/claude' }, limits: { leaseSeconds: 30 } })
  assert.equal(second.deviceId, 'dev-9')
  assert.equal(second.tools.claude, '/opt/claude')
  assert.equal(second.tools.codex, 'codex')
  assert.equal(second.limits.evalIntervalMinutes, 5)
  assert.equal(second.limits.leaseSeconds, 30)
  assert.deepEqual(second.allowServices, ['claude'])
})

test('addExclusion and removeExclusion are pure and handle duplicates, positions and errors', () => {
  const config = valid()
  const added = addExclusion(config, ' dist ')
  assert.equal(added.changed, true)
  assert.equal(added.config.exclusions.at(-1), 'dist')
  assert.equal(config.exclusions.includes('dist'), false)
  assert.equal(addExclusion(added.config, 'dist').changed, false)
  assert.equal(addExclusion(config, '').error !== undefined, true)
  assert.equal(addExclusion(config, '/abs').error !== undefined, true)

  const byName = removeExclusion(added.config, 'dist')
  assert.deepEqual(byName.config.exclusions, [...DEFAULT_EXCLUSIONS])
  const byPosition = removeExclusion(config, '1')
  assert.equal(byPosition.config.exclusions[0], DEFAULT_EXCLUSIONS[1])
  assert.equal(removeExclusion(config, '999').error !== undefined, true)
  assert.equal(removeExclusion(config, 'nope').changed, false)
  assert.deepEqual(resetExclusions(byPosition.config).exclusions, [...DEFAULT_EXCLUSIONS])
})

function scriptedIO(answers) {
  const out = []
  return {
    out,
    write: (text) => out.push(text),
    ask: async (prompt) => {
      out.push(prompt)
      return answers.length ? answers.shift() : null
    },
  }
}

test('editExclusions shows the list, applies add and remove, saves each change and stops on done', async () => {
  const base = tempBase()
  saveConfig(base, valid())
  const io = scriptedIO(['add build/', 'remove .npmrc', 'bogus', 'remove 99', 'add', 'done'])
  const final = await editExclusions({ baseDir: base, io })
  const shown = io.out.join('')
  assert.match(shown, /1\. \.env\*/)
  assert.match(shown, /Unknown command: bogus/)
  assert.match(shown, /No such exclusion: 99/)
  assert.ok(final.exclusions.includes('build/'))
  assert.equal(final.exclusions.includes('.npmrc'), false)
  assert.deepEqual(loadConfig(base).config.exclusions, final.exclusions)
})

test('editExclusions ends at end of input and refuses without a config', async () => {
  const base = tempBase()
  await assert.rejects(() => editExclusions({ baseDir: base, io: scriptedIO([]) }), ConfigError)
  saveConfig(base, valid())
  const final = await editExclusions({ baseDir: base, io: scriptedIO([]) })
  assert.deepEqual(final.exclusions, [...DEFAULT_EXCLUSIONS])
})

test('runConfigWizard collects the fields, keeps defaults on empty answers, then edits exclusions', async () => {
  const base = tempBase()
  const io = scriptedIO(['Studio Mac', 'http://192.168.1.5:8888/api/v1', 'ws-7', '/Users/u/Projects', 'claude, chatgpt', 'add out/', 'done'])
  const config = await runConfigWizard({ baseDir: base, io, deviceId: 'dev-3', deviceName: 'ignored' })
  assert.equal(config.deviceId, 'dev-3')
  assert.equal(config.deviceName, 'Studio Mac')
  assert.equal(config.workspaceId, 'ws-7')
  assert.equal(config.projectsBaseFolder, '/Users/u/Projects')
  assert.deepEqual(config.allowServices, ['claude', 'chatgpt'])
  assert.ok(config.exclusions.includes('out/'))
  assert.equal(mode(runnerPaths(base).config), 0o600)
})

test('createTerminalIO reads buffered lines in order and returns null at end of input', async () => {
  const input = new PassThrough()
  const output = new PassThrough()
  const written = []
  output.on('data', (chunk) => written.push(chunk.toString()))
  const io = createTerminalIO({ input, output })
  input.write('first\nsecond\n')
  input.end()
  assert.equal(await io.ask('a> '), 'first')
  assert.equal(await io.ask('b> '), 'second')
  assert.equal(await io.ask('c> '), null)
  io.write('bye')
  await new Promise((resolve) => setImmediate(resolve))
  assert.match(written.join(''), /a> b> c> bye/)
  io.close()
})

test('writeSecureFile leaves no temp file and replaces atomically with mode 0600', () => {
  const base = tempBase()
  const file = join(base, 'x.json')
  writeSecureFile(file, 'one')
  writeSecureFile(file, 'two')
  assert.equal(readFileSync(file, 'utf8'), 'two')
  assert.equal(mode(file), 0o600)
  assert.equal(existsSync(`${file}.${process.pid}.tmp`), false)
  writeFileSync(file, 'three', { mode: 0o666 })
  writeSecureFile(file, 'four')
  assert.equal(mode(file), 0o600)
})

async function withApi(fn) {
  const api = await start()
  try {
    await fn(api, createApiClient({ apiBase: api.url, workspaceId: api.workspaceId, timeoutMs: 2000 }))
  } finally {
    await api.close()
  }
}

test('takeOver creates the lease record with this device designated and an expired heartbeat', () =>
  withApi(async (api, client) => {
    const now = new Date('2026-11-03T10:00:00.000Z')
    const result = await takeOver({ config: valid(), api: client, now })
    assert.equal(result.created, true)
    assert.equal(result.previousDesignatedDeviceId, null)
    const payload = api.find('runner-lease').payload
    assert.equal(payload.designatedDeviceId, 'dev-1')
    assert.equal(payload.designatedDeviceName, 'Laptop')
    assert.equal(payload.designatedAt, now.toISOString())
    assert.equal(payload.heartbeatAt, '1970-01-01T00:00:00.000Z')
    assert.equal(payload.leaseSeconds, 180)
    assert.deepEqual(payload.approved, {})
  }))

test('takeOver replaces another device designation and keeps its lease fields', () =>
  withApi(async (api, client) => {
    const lease = {
      designatedDeviceId: 'dev-old',
      designatedDeviceName: 'Old',
      designatedAt: '2026-10-01T00:00:00.000Z',
      deviceId: 'dev-old',
      deviceName: 'Old',
      startedAt: '2026-11-03T09:00:00.000Z',
      heartbeatAt: '2026-11-03T09:59:00.000Z',
      leaseSeconds: 180,
      approved: { 'i-1': 2 },
    }
    api.seed('runner-lease', lease)
    const now = new Date('2026-11-03T10:00:00.000Z')
    const result = await takeOver({ config: valid(), api: client, now })
    assert.equal(result.created, false)
    assert.equal(result.previousDesignatedDeviceId, 'dev-old')
    const stored = api.find('runner-lease')
    assert.equal(stored.version, 2)
    assert.equal(stored.payload.designatedDeviceId, 'dev-1')
    assert.equal(stored.payload.designatedAt, now.toISOString())
    assert.equal(stored.payload.deviceId, 'dev-old')
    assert.equal(stored.payload.heartbeatAt, lease.heartbeatAt)
    assert.deepEqual(stored.payload.approved, { 'i-1': 2 })
  }))

test('takeOver retries once after a version conflict and gives up after a second one', async () => {
  const api = await start()
  try {
    api.seed('runner-lease', { designatedDeviceId: 'dev-old' })
    const real = createApiClient({ apiBase: api.url, workspaceId: api.workspaceId, timeoutMs: 2000 })
    let bumped = false
    const racing = {
      ...real,
      updateRecord: async (id, args) => {
        if (!bumped) {
          bumped = true
          api.put('runner-lease', { designatedDeviceId: 'dev-racer', extra: true })
        }
        return real.updateRecord(id, args)
      },
    }
    const result = await takeOver({ config: valid(), api: racing })
    assert.equal(result.previousDesignatedDeviceId, 'dev-racer')
    assert.equal(api.find('runner-lease').payload.extra, true)
    assert.equal(api.find('runner-lease').payload.designatedDeviceId, 'dev-1')

    const alwaysRacing = {
      ...real,
      updateRecord: async (id, args) => {
        api.put('runner-lease', { designatedDeviceId: 'dev-racer' })
        return real.updateRecord(id, args)
      },
    }
    await assert.rejects(() => takeOver({ config: valid(), api: alwaysRacing }), (e) => e.kind === 'conflict')
  } finally {
    await api.close()
  }
})

test('allowCodexAuto defaults to false and must be a boolean', () => {
  const base = { ...defaultConfig({ deviceId: 'd', deviceName: 'n' }), workspaceId: 'w' }
  assert.equal(base.allowCodexAuto, false)
  const omitted = { ...base }
  delete omitted.allowCodexAuto
  assert.equal(validateConfig(omitted).config.allowCodexAuto, false)
  assert.equal(validateConfig({ ...base, allowCodexAuto: true }).config.allowCodexAuto, true)
  assert.equal(validateConfig({ ...base, allowCodexAuto: 'yes' }).valid, false)
})
