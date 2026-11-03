// Runner configuration and local-file safety (T049).
//
// Everything lives under one base directory (default ~/.kairos-runner/, mode 0700; files mode 0600).
// Tests inject a temp base dir. The runner never writes outside it except HTTP calls to the API base.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { SUPPORTED_SERVICE_IDS, DEFAULTS } from '../src/surplus/constants.js'
import { keyForLease } from '../src/surplus/records.js'
import { isVersionConflict, ApiClientError } from './api-client.js'

export const CONFIG_SCHEMA_VERSION = 1
export const DEFAULT_API_BASE = 'http://localhost:8888/api/v1'

/** Default copy exclusions (research D10, FR-030): matched by the workdir module on names and relative paths. */
export const DEFAULT_EXCLUSIONS = Object.freeze([
  '.env*',
  '*.pem',
  '*.key',
  'id_rsa*',
  '.npmrc',
  '.netrc',
  '.aws',
  '.ssh',
  '.gnupg',
  'credentials*',
  'secrets*',
  'node_modules',
  '.git/hooks',
])

/** Default limits. Units are in the names; every value is a positive number (fractions allowed for tests). */
export const DEFAULT_LIMITS = Object.freeze({
  copyLimitBytes: DEFAULTS.COPY_LIMIT_BYTES,
  outputCapBytes: DEFAULTS.OUTPUT_CAP_BYTES,
  diffCapBytes: DEFAULTS.OUTPUT_CAP_BYTES,
  evalIntervalMinutes: DEFAULTS.EVAL_INTERVAL_MINUTES,
  heartbeatSeconds: 60,
  leaseSeconds: 180,
  stopWatcherSeconds: DEFAULTS.STOP_WATCHER_SECONDS,
  quotaWatcherSeconds: DEFAULTS.QUOTA_WATCHER_SECONDS,
  killGraceSeconds: 10,
  requestTimeoutMs: 10_000,
})

export const DEFAULT_TOOLS = Object.freeze({ claude: 'claude', codex: 'codex' })

export class ConfigError extends Error {
  constructor(message, errors = []) {
    super(message)
    this.name = 'ConfigError'
    this.errors = errors
  }
}

// --- Local files ---------------------------------------------------------------------------

/** `$KAIROS_RUNNER_HOME` when set, else `<home>/.kairos-runner`. */
export function defaultBaseDir({ env = process.env, home = homedir() } = {}) {
  return env.KAIROS_RUNNER_HOME ? env.KAIROS_RUNNER_HOME : join(home, '.kairos-runner')
}

/** Absolute locations of every runner-local file under `baseDir`. */
export function runnerPaths(baseDir) {
  return {
    baseDir,
    config: join(baseDir, 'config.json'),
    approvals: join(baseDir, 'approvals.json'),
    journal: join(baseDir, 'journal.jsonl'),
    stop: join(baseDir, 'STOP'),
    runsDir: join(baseDir, 'runs'),
    runDir: (runId) => join(baseDir, 'runs', String(runId)),
  }
}

/** Create `dir` (and parents) with mode 0700 and enforce 0700 on it even when it already existed. */
export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
}

export const ensureBaseDir = ensureDir

/** Atomically write a file with mode 0600 inside a 0700 directory. */
export function writeSecureFile(file, content) {
  ensureDir(dirname(file))
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, content, { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, file)
}

// --- Validation ----------------------------------------------------------------------------

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== ''
const isPositiveNumber = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0
const MAX_EXCLUSION_LENGTH = 200

/** Trim and check one exclusion pattern. Returns `{ pattern }` or `{ error }`. */
export function normalizeExclusion(input) {
  const pattern = typeof input === 'string' ? input.trim() : ''
  if (pattern === '') return { error: 'Exclusion must not be empty' }
  if (pattern.length > MAX_EXCLUSION_LENGTH) return { error: `Exclusion must be at most ${MAX_EXCLUSION_LENGTH} characters` }
  if (/[\n\r\0]/.test(pattern)) return { error: 'Exclusion must be a single line' }
  if (pattern.startsWith('/') || pattern.split('/').includes('..')) {
    return { error: 'Exclusion must be relative to the copied folder (no leading / and no ..)' }
  }
  return { pattern }
}

/** Defaults for a first-time configuration. `workspaceId` stays empty and must be supplied. */
export function defaultConfig({ deviceId = randomUUID(), deviceName = hostname() } = {}) {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    deviceId,
    deviceName,
    apiBase: DEFAULT_API_BASE,
    workspaceId: '',
    projectsBaseFolder: null,
    allowServices: [],
    tools: { ...DEFAULT_TOOLS },
    exclusions: [...DEFAULT_EXCLUSIONS],
    limits: { ...DEFAULT_LIMITS },
  }
}

/**
 * Validate and normalise a parsed config (missing optional fields take their defaults; unknown keys are dropped).
 * Returns `{ valid, config, errors: [{ field, message }] }`; `config` is null when invalid.
 */
export function validateConfig(raw) {
  const errors = []
  const bad = (field, message) => errors.push({ field, message })
  if (!isObject(raw)) return { valid: false, config: null, errors: [{ field: 'config', message: 'config must be an object' }] }

  if (!isNonEmptyString(raw.deviceId)) bad('deviceId', 'deviceId must be a non-empty string')
  if (!isNonEmptyString(raw.deviceName)) bad('deviceName', 'deviceName must be a non-empty string')
  if (!isNonEmptyString(raw.workspaceId)) bad('workspaceId', 'workspaceId must be a non-empty string')

  let apiBase = raw.apiBase
  try {
    const url = new URL(String(apiBase))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol')
    apiBase = url.toString().replace(/\/+$/, '')
  } catch {
    bad('apiBase', 'apiBase must be an http(s) URL')
  }

  let projectsBaseFolder = raw.projectsBaseFolder ?? null
  if (projectsBaseFolder !== null && !(typeof projectsBaseFolder === 'string' && projectsBaseFolder.startsWith('/'))) {
    bad('projectsBaseFolder', 'projectsBaseFolder must be null or an absolute path')
    projectsBaseFolder = null
  }

  let allowServices = raw.allowServices ?? []
  if (!Array.isArray(allowServices) || !allowServices.every((id) => SUPPORTED_SERVICE_IDS.includes(id))) {
    bad('allowServices', `allowServices must list only: ${SUPPORTED_SERVICE_IDS.join(', ')}`)
    allowServices = []
  } else {
    allowServices = [...new Set(allowServices)]
  }

  const tools = { ...DEFAULT_TOOLS }
  if (raw.tools !== undefined) {
    if (!isObject(raw.tools)) bad('tools', 'tools must be an object')
    else {
      for (const [name, path] of Object.entries(raw.tools)) {
        if (!(name in DEFAULT_TOOLS)) continue
        if (!isNonEmptyString(path)) bad(`tools.${name}`, `tools.${name} must be a non-empty string`)
        else tools[name] = path
      }
    }
  }

  let exclusions = [...DEFAULT_EXCLUSIONS]
  if (raw.exclusions !== undefined) {
    if (!Array.isArray(raw.exclusions)) bad('exclusions', 'exclusions must be an array of patterns')
    else {
      const list = []
      for (const item of raw.exclusions) {
        const checked = normalizeExclusion(item)
        if (checked.error) bad('exclusions', checked.error)
        else if (!list.includes(checked.pattern)) list.push(checked.pattern)
      }
      exclusions = list
    }
  }

  const limits = { ...DEFAULT_LIMITS }
  if (raw.limits !== undefined) {
    if (!isObject(raw.limits)) bad('limits', 'limits must be an object')
    else {
      for (const [name, value] of Object.entries(raw.limits)) {
        if (!(name in DEFAULT_LIMITS)) continue
        if (!isPositiveNumber(value)) bad(`limits.${name}`, `limits.${name} must be a positive number`)
        else limits[name] = value
      }
    }
  }

  if (errors.length > 0) return { valid: false, config: null, errors }
  return {
    valid: true,
    errors: [],
    config: {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      deviceId: raw.deviceId.trim(),
      deviceName: raw.deviceName.trim(),
      apiBase,
      workspaceId: raw.workspaceId.trim(),
      projectsBaseFolder,
      allowServices,
      tools,
      exclusions,
      limits,
    },
  }
}

// --- Load, save, update --------------------------------------------------------------------

/**
 * Read `<baseDir>/config.json`. Returns `{ ok: true, config }` or `{ ok: false, reason, errors }` with
 * reason 'missing' | 'unreadable' | 'invalid_json' | 'invalid'. Never throws.
 */
export function loadConfig(baseDir) {
  const file = runnerPaths(baseDir).config
  if (!existsSync(file)) return { ok: false, reason: 'missing', errors: [] }
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return { ok: false, reason: 'unreadable', errors: [] }
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid_json', errors: [] }
  }
  const result = validateConfig(raw)
  return result.valid ? { ok: true, config: result.config } : { ok: false, reason: 'invalid', errors: result.errors }
}

/** Validate then write `config.json` (0600, directory 0700). Throws ConfigError when invalid. Returns the normalised config. */
export function saveConfig(baseDir, config) {
  const result = validateConfig(config)
  if (!result.valid) throw new ConfigError(`Invalid config: ${result.errors.map((e) => e.message).join('; ')}`, result.errors)
  writeSecureFile(runnerPaths(baseDir).config, `${JSON.stringify(result.config, null, 2)}\n`)
  return result.config
}

/**
 * Merge `patch` into the stored config (or into fresh defaults on first use), validate and save.
 * `tools` and `limits` merge key by key; every other field is replaced. `exclusions` in the patch replaces the list.
 * Throws ConfigError when the result is invalid (for example while `workspaceId` is still empty).
 */
export function updateConfig(baseDir, patch = {}, { deviceId, deviceName } = {}) {
  const loaded = loadConfig(baseDir)
  const base = loaded.ok ? loaded.config : defaultConfig({ deviceId, deviceName })
  const next = {
    ...base,
    ...patch,
    tools: { ...base.tools, ...(patch.tools ?? {}) },
    limits: { ...base.limits, ...(patch.limits ?? {}) },
  }
  return saveConfig(baseDir, next)
}

// --- Exclusions (FR-030) -------------------------------------------------------------------

/** Pure: add a pattern. Returns `{ config, changed, error? }` (a duplicate is not an error and not a change). */
export function addExclusion(config, input) {
  const checked = normalizeExclusion(input)
  if (checked.error) return { config, changed: false, error: checked.error }
  if (config.exclusions.includes(checked.pattern)) return { config, changed: false }
  return { config: { ...config, exclusions: [...config.exclusions, checked.pattern] }, changed: true }
}

/** Pure: remove a pattern given as text or as its 1-based position in the list. */
export function removeExclusion(config, target) {
  const text = String(target ?? '').trim()
  let index = config.exclusions.indexOf(text)
  if (index === -1 && /^\d+$/.test(text)) index = Number(text) - 1
  if (index < 0 || index >= config.exclusions.length) return { config, changed: false, error: `No such exclusion: ${text}` }
  return { config: { ...config, exclusions: config.exclusions.filter((_, i) => i !== index) }, changed: true }
}

/** Pure: back to the default exclusion list. */
export function resetExclusions(config) {
  return { ...config, exclusions: [...DEFAULT_EXCLUSIONS] }
}

export function formatExclusions(exclusions) {
  if (exclusions.length === 0) return '  (none)\n'
  return exclusions.map((pattern, i) => `  ${i + 1}. ${pattern}\n`).join('')
}

/**
 * Terminal IO for the interactive commands: `{ write(text), ask(prompt) -> Promise<string | null>, close() }`.
 * `ask` resolves null at end of input. Tests pass their own object with the same shape.
 */
export function createTerminalIO({ input = process.stdin, output = process.stdout } = {}) {
  const rl = createInterface({ input, output, terminal: false })
  const lines = rl[Symbol.asyncIterator]()
  return {
    write: (text) => output.write(text),
    async ask(prompt) {
      output.write(prompt)
      const next = await lines.next()
      return next.done ? null : next.value
    },
    close: () => rl.close(),
  }
}

/**
 * Interactive exclusion editor over injected IO (FR-030). Shows the list, then loops on commands:
 * `add <pattern>`, `remove <number|pattern>`, `reset`, `done` (or empty line / end of input). Every change is saved
 * immediately. Returns the final config. Requires a valid stored config.
 */
export async function editExclusions({ baseDir, io }) {
  const loaded = loadConfig(baseDir)
  if (!loaded.ok) throw new ConfigError(`Cannot edit exclusions: config is ${loaded.reason}`, loaded.errors)
  let config = loaded.config
  for (;;) {
    io.write(`Files and folders excluded from the disposable copy:\n${formatExclusions(config.exclusions)}`)
    const answer = await io.ask('Command (add <pattern> | remove <number|pattern> | reset | done): ')
    const line = (answer ?? '').trim()
    if (answer === null || line === '' || line === 'done') return config
    const [command, ...rest] = line.split(/\s+/)
    const argument = rest.join(' ')
    let outcome
    if (command === 'add') outcome = addExclusion(config, argument)
    else if (command === 'remove') outcome = removeExclusion(config, argument)
    else if (command === 'reset') outcome = { config: resetExclusions(config), changed: true }
    else {
      io.write(`Unknown command: ${command}\n`)
      continue
    }
    if (outcome.error) {
      io.write(`${outcome.error}\n`)
      continue
    }
    if (outcome.changed) config = saveConfig(baseDir, outcome.config)
  }
}

/**
 * Interactive configuration (`config` command): prompts for each editable field (empty answer keeps the current
 * value), saves, then runs the exclusion editor. Returns the saved config.
 */
export async function runConfigWizard({ baseDir, io, deviceId, deviceName }) {
  const loaded = loadConfig(baseDir)
  const current = loaded.ok ? loaded.config : defaultConfig({ deviceId, deviceName })
  const patch = {}
  const fields = [
    ['deviceName', 'Device name', (v) => v],
    ['apiBase', 'Shared-state API base URL', (v) => v],
    ['workspaceId', 'Workspace id', (v) => v],
    ['projectsBaseFolder', 'Projects base folder (absolute path, "-" for none)', (v) => (v === '-' ? null : v)],
    ['allowServices', `Services allowed to run automatically (comma separated: ${SUPPORTED_SERVICE_IDS.join(', ')}; "-" for none)`, (v) =>
      v === '-' ? [] : v.split(',').map((s) => s.trim()).filter(Boolean)],
  ]
  for (const [field, label, parse] of fields) {
    const shown = Array.isArray(current[field]) ? current[field].join(',') : current[field] ?? ''
    const answer = await io.ask(`${label} [${shown}]: `)
    const text = (answer ?? '').trim()
    if (text !== '') patch[field] = parse(text)
  }
  const saved = updateConfig(baseDir, patch, { deviceId, deviceName })
  await editExclusions({ baseDir, io })
  return loadConfig(baseDir).config ?? saved
}

// --- Take-over (FR-014) --------------------------------------------------------------------

/**
 * `config --take-over`: make this device the designated runner by writing `designatedDeviceId`,
 * `designatedDeviceName` and `designatedAt` into the `runner-lease` record, whatever the previous value was.
 * The previous holder's lease fields (heartbeat etc.) are left untouched; its runner exits on its next heartbeat
 * because the designation no longer matches. When the record does not exist yet it is created with an already
 * expired heartbeat (epoch) so no live lease is claimed on behalf of a runner that is not running.
 * A version conflict is retried once against the server's record. Returns
 * `{ created, previousDesignatedDeviceId, record }`. Throws ApiClientError on API failure.
 */
export async function takeOver({ config, api, now = new Date() }) {
  const at = now.toISOString()
  const key = keyForLease()
  const designation = { designatedDeviceId: config.deviceId, designatedDeviceName: config.deviceName, designatedAt: at }

  let existing = await api.getByKey(key)
  if (!existing) {
    const payload = {
      ...designation,
      deviceId: config.deviceId,
      deviceName: config.deviceName,
      startedAt: at,
      heartbeatAt: new Date(0).toISOString(),
      leaseSeconds: config.limits.leaseSeconds,
      approved: {},
    }
    try {
      const record = await api.createRecord({ logicalKey: key, payload })
      return { created: true, previousDesignatedDeviceId: null, record }
    } catch (error) {
      if (!(error instanceof ApiClientError) || error.code !== 'DUPLICATE_LOGICAL_KEY') throw error
      existing = await api.getByKey(key)
      if (!existing) throw error
    }
  }

  for (let attempt = 0; ; attempt += 1) {
    const previousDesignatedDeviceId = existing.payload?.designatedDeviceId ?? null
    try {
      const record = await api.updateRecord(existing.id, {
        expectedVersion: existing.version,
        payload: { ...existing.payload, ...designation },
      })
      return { created: false, previousDesignatedDeviceId, record }
    } catch (error) {
      if (attempt > 0 || !isVersionConflict(error) || !error.serverRecord) throw error
      existing = error.serverRecord
    }
  }
}
