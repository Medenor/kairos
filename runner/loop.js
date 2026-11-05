// The runner loop (T056): tick algorithm, compare-and-set claim, hard stop, stop and quota watchers,
// run finalisation and restart recovery (contracts/runner-cli.md, research D8 and D9).
//
// Everything that touches the outside world is injected so tests are fast and deterministic:
// `now` (clock), `scheduler` (setTimeout/clearTimeout), `spawn`, `api`, `lease` and a few module hooks in `deps`.
// The loop owns no real timer unless the defaults are used. The CLI entry (T057) builds it with
// `createLoop({ config, baseDir, api, lease })`, calls `start()` and maps the result to the process exit code.
//
// Trust model: nothing read from the shared store can authorise a run. Authorisation comes from the local config
// (`allowProviders`, each entry pinned to a provider id AND a tool), the local approvals file (hash of the idea as fetched right before the claim), the local
// preflight and the designated-device lease. The shared policy, control record and ideas only restrict or select.

import { spawn as nodeSpawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULTS, STATUS } from '../src/surplus/constants.js'
import { emptyCatalogue, applyCatalogueRecords } from '../src/providers/records.js'
import { toRuntimeServices } from '../src/providers/runtime.js'
import { surplusProblems } from '../src/providers/surplusProfile.js'
import { evaluateSurplus } from '../src/surplus/evaluation.js'
import { applyCycleReadings, deriveCycleReadings } from '../src/surplus/cycleReadings.js'
import { validateIdeaRecord } from '../src/surplus/ideas.js'
import {
  FAILURE_REASONS, RUN_STATUS, capOutput, cycleKeyOf, cycleRecordKey, ideaKey, keyForPolicy, runKey,
} from '../src/surplus/records.js'
import { applySurplusRecords, emptySurplusState } from '../src/surplus/storage.js'
import { hardStopAt as computeHardStop, isInProtectedHours, nextProtectedStart, resetDayStart } from '../src/surplus/time.js'
import { applyQuotaRecord } from '../src/stateTransitions.js'
import { getConsumedPct } from '../src/utils.js'
import * as claudeAdapter from './adapters/claude.js'
import * as codexAdapter from './adapters/codex.js'
import { ApiClientError, isDuplicateKey, isVersionConflict } from './api-client.js'
import { approvedVersions, isApproved } from './approvals.js'
import { runnerPaths, writeSecureFile } from './config.js'
import { appendEnd, appendEvaluationSkipped, appendStart, unfinishedRuns } from './journal.js'
import { EXIT_CODES, LeaseError } from './lease.js'
import { runPreflight } from './preflight.js'
import { checkFolder, diffWorkdir, prepareWorkdir } from './workdir.js'

export { EXIT_CODES }

export const STATUS_FILE = 'status.json'

/**
 * Reasons a tick starts nothing (`result.reason`). Guardrail and preflight reasons follow the contract list; the
 * rest explain evaluation outcomes. `not_eligible` carries `failedRules` (R1..R7); an R7-only failure reports the
 * first skip reason of the candidate ideas instead (`not_approved`, `folder_not_found`, `retry_used`, ...).
 */
export const SKIP_REASONS = Object.freeze([
  'stop_file', 'global_stop', 'no_shared_mode', 'policy_invalid', 'disclosures_missing', 'auto_run_disabled',
  'service_not_allowed', 'surplus_disabled', 'not_eligible', 'no_waiting_idea', 'not_approved', 'run_active',
  'tick_in_progress', 'claim_conflict', 'claim_lost', 'claim_failed', 'idea_invalid', 'folder_error',
  'tool_missing', 'flags_unsupported', 'not_signed_in', 'billing_guard', 'api_unavailable', 'internal_error',
  'recovery_pending', 'codex_reads_uncontained', 'provider_not_eligible', 'tool_changed',
])

const defaultAdapters = Object.freeze({ claude: claudeAdapter, codex: codexAdapter })
const defaultScheduler = Object.freeze({
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
})
const MIB = 1024 * 1024
const MINUTE_MS = 60000
const RETRY_ATTEMPTS = 3
const keyOf = (record) => `${record.record_type}|${record.logical_key}`
const clampPct = (n) => Math.min(100, Math.max(0, n))

const IDEA_STATUS_FOR_RUN = Object.freeze({
  [RUN_STATUS.COMPLETED]: STATUS.COMPLETED,
  [RUN_STATUS.NEEDS_INPUT]: STATUS.NEEDS_INPUT,
  [RUN_STATUS.FAILED]: STATUS.FAILED,
  [RUN_STATUS.INTERRUPTED]: STATUS.FAILED,
})

/** Contents of `<baseDir>/status.json` written after every tick for the `status` command, or null. */
export async function readStatusFile(baseDir) {
  try {
    return JSON.parse(await readFile(join(baseDir, STATUS_FILE), 'utf8'))
  } catch {
    return null
  }
}

function collector(limitBytes) {
  const chunks = []
  let size = 0
  let dropped = 0
  return {
    push(buffer) {
      const room = Math.max(0, limitBytes - size)
      const take = buffer.subarray(0, room)
      if (take.length > 0) chunks.push(take)
      size += take.length
      dropped += buffer.length - take.length
    },
    text: () => Buffer.concat(chunks).toString('utf8'),
    dropped: () => dropped,
  }
}

// Signal the whole process group of a child started with `detached: true`; fall back to the child itself.
function signalChild(child, signal) {
  try {
    if (typeof child.pid === 'number' && child.pid > 0) {
      process.kill(-child.pid, signal)
      return
    }
  } catch {
    // group gone or not a group leader: try the child itself
  }
  try {
    child.kill(signal)
  } catch {
    // already exited
  }
}

function weeklyRemainingPct(quotaState, svc) {
  const quota = svc.quotas.find((q) => q.id === svc.surplus.weeklyQuotaId)
  const value = quotaState?.[svc.id]?.[svc.surplus.weeklyQuotaId]
  if (!quota || typeof value !== 'number' || !Number.isFinite(value)) return null
  return clampPct(100 - getConsumedPct(quota, value))
}

// Why the provider of an active run can no longer run, or null. Mirrors guard steps 1, 4 and 5 and the tombstone check.
function providerStopCause(providerId, pinnedTool, policy, catalogue) {
  const entry = catalogue.providers[providerId]
  if (!entry || entry.status !== 'active') return 'The provider was removed.'
  const sp = policy?.providers?.[providerId]
  if (sp && sp.surplusEnabled === false) return 'Surplus use was turned off for this provider.'
  if (sp && sp.autoRunEnabled === false) return 'Automatic runs were turned off for this provider.'
  if (surplusProblems(entry).length > 0) return 'The provider is no longer eligible for surplus use.'
  if (entry.surplus.tool !== pinnedTool) return `The tool of this provider changed (now ${entry.surplus.tool}).`
  return null
}

function stopCauseFor(spawnAt, policy, nextResetDate) {
  const stopAt = computeHardStop(spawnAt, policy, nextResetDate)
  const t = stopAt.getTime()
  const protectedHours = policy?.protectedHours ?? []
  const protectedStart = nextProtectedStart(protectedHours, spawnAt)
  const resetStart = resetDayStart(nextResetDate)
  let code = FAILURE_REASONS.TIMEOUT
  let message = 'The maximum run duration was reached.'
  if (isInProtectedHours(protectedHours, spawnAt) || (protectedStart && protectedStart.getTime() === t)) {
    code = FAILURE_REASONS.PROTECTED_HOURS
    message = 'Protected hours begin.'
  } else if (resetStart && resetStart.getTime() === t) {
    code = FAILURE_REASONS.RESET_DAY
    message = 'The reset day begins.'
  }
  return { at: stopAt, code, message }
}

// Primary reason code and failed rules when the evaluation selected nothing.
function explainNoSelection(evaluation, policy, catalogue) {
  const enabled = evaluation.services.filter((s) => s.rules.find((r) => r.id === 'R1')?.pass)
  if (enabled.length === 0) {
    // Providers the policy has switched on but that are not evaluated: removed, invalid or no longer eligible.
    const gone = Object.entries(policy?.providers ?? {})
      .filter(([id, sp]) => sp?.surplusEnabled === true && !evaluation.services.some((s) => s.serviceId === id))
      .map(([id]) => ({ id, entry: catalogue?.providers?.[id] }))
    if (gone.length > 0) {
      const { id, entry } = gone[0]
      const why = entry?.status === 'active' ? surplusProblems(entry).join(' ') : 'The provider was removed or its record is invalid.'
      return { reason: 'provider_not_eligible', failedRules: [], serviceId: id, detail: `${entry?.name ?? id} is switched on for surplus use but cannot run: ${why}` }
    }
    return { reason: 'surplus_disabled', failedRules: ['R1'], serviceId: null, detail: evaluation.reason }
  }
  const failing = (s) => s.rules.filter((r) => !r.pass).map((r) => r.id)
  const best = enabled.map((s, i) => ({ s, i, f: failing(s) })).sort((a, b) => a.f.length - b.f.length || a.i - b.i)[0]
  if (best.f.length === 1 && best.f[0] === 'R7') {
    const first = best.s.skipped[0]
    return { reason: first?.reason ?? 'no_waiting_idea', failedRules: best.f, serviceId: best.s.serviceId, ideaId: first?.ideaId ?? null, detail: best.s.reason }
  }
  return { reason: 'not_eligible', failedRules: best.f, serviceId: best.s.serviceId, detail: best.s.reason }
}

/**
 * createLoop(options) -> loop
 *
 * Required: `config` (validated runner config), `baseDir` (absolute runner directory), `api` (api-client.js client),
 * `lease` (createLease result; the loop claims it itself).
 * Optional: `adapters` ({claude, codex}), `now` (() => Date), `scheduler`
 * ({setTimeout, clearTimeout}), `spawn` (child_process.spawn compatible), `env` (default process.env; filtered by the
 * adapter and checked by preflight), `homeDir`, `newId` (run ids), `onEvent(event)` (observability and tests),
 * `deps` ({preflight, checkFolder, prepareWorkdir, diffWorkdir} overrides).
 *
 * loop.start()    -> Promise<Exit>: claim the lease, recover, then tick every evaluation interval until stop() or a
 *                    terminal condition. Resolves with the Exit result.
 * loop.stop()     -> Promise<Exit>: stop the schedule, terminate a running tool (stopped_by_user), release the lease.
 * loop.tick()     -> Promise<TickResult>: one evaluation, and when a run starts the whole run up to finalisation.
 * loop.status()   -> { ready, terminal, intervalMs, activeRun, lastTick }   (synchronous, in-memory)
 * loop.settled()  -> Promise<void>: waits for in-flight watcher work (deterministic tests).
 * loop.intervalMs -> evaluation interval, `config.limits.evalIntervalMinutes` (default 15 min, FR-033).
 *
 * Exit:       { terminal: true, exitCode: 0 | 1 | 2 | 3, reason, detail, at }
 *             0 stopped on request; 2 `no_shared_mode` (no workspace or API); 3 lease lost, lease held or another
 *             device designated (reasons from lease.js LEASE_REASONS).
 * TickResult: { at (ISO), started: bool, reason, detail, failedRules?, serviceId?, ideaId?, evaluation?,
 *               run? (the finalised run payload, when started), terminal?, exitCode? }
 */
export function createLoop({
  config,
  baseDir,
  api,
  lease,
  adapters = defaultAdapters,
  now = () => new Date(),
  scheduler = defaultScheduler,
  spawn = nodeSpawn,
  env = process.env,
  homeDir = homedir(),
  newId = randomUUID,
  onEvent = () => {},
  deps = {},
}) {
  const preflight = deps.preflight ?? runPreflight
  const folderCheck = deps.checkFolder ?? checkFolder
  const makeWorkdir = deps.prepareWorkdir ?? prepareWorkdir
  const makeDiff = deps.diffWorkdir ?? diffWorkdir
  const paths = runnerPaths(baseDir)
  const limits = config.limits
  const intervalMs = limits.evalIntervalMinutes * MINUTE_MS

  // --- state ---------------------------------------------------------------------------------
  const cache = new Map() // record_type|logical_key -> record
  let cursor = null
  let refreshChain = Promise.resolve()
  let ready = false
  let recovered = false
  let terminalResult = null
  let tickPromise = null
  let stopping = false
  let wake = null
  let activeRun = null
  let lastTick = null
  let lastApproved
  let lastSkipKey = null
  const inflight = new Set()
  // The providers the runner learns from the shared store on every pull (untrusted data: they only ever
  // restrict or select, never authorise). Rebuilt by derive().
  let services = []

  const emit = (type, data = {}) => {
    try {
      onEvent({ type, ...data })
    } catch {
      // observers never break the loop
    }
  }

  const sleep = (ms) =>
    new Promise((resolve) => {
      const handle = scheduler.setTimeout(() => {
        wake = null
        resolve()
      }, ms)
      wake = () => {
        scheduler.clearTimeout(handle)
        wake = null
        resolve()
      }
    })

  async function withRetry(fn) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await fn()
      } catch (error) {
        const transient = error instanceof ApiClientError && (error.kind === 'network' || error.kind === 'timeout' || (error.kind === 'http' && error.status >= 500))
        if (!transient || attempt >= RETRY_ATTEMPTS) throw error
        await sleep(1000 * attempt)
      }
    }
  }

  // --- shared records ------------------------------------------------------------------------

  const remember = (record) => {
    if (!record) return record
    if (record.deleted_at) cache.delete(keyOf(record))
    else cache.set(keyOf(record), record)
    return record
  }

  async function fullPull() {
    const { items, next_cursor: next } = await api.pull()
    cache.clear()
    for (const item of items) remember(item)
    cursor = next ?? cursor
  }

  // Incremental pull used by the watchers, serialised so two watchers never interleave.
  function refresh() {
    const run = refreshChain.then(async () => {
      const { items, next_cursor: next } = await api.pull({ cursor })
      for (const item of items) remember(item)
      cursor = next ?? cursor
    })
    refreshChain = run.catch(() => {})
    return run
  }

  function derive() {
    const items = [...cache.values()]
    const records = items.filter((item) => item.record_type === 'routing_config')
    // Tombstones and invalid provider records are ignored: only active, valid definitions become services.
    const catalogue = applyCatalogueRecords(emptyCatalogue(), records)
    services = toRuntimeServices(catalogue)
    let quota = {}
    for (const item of items) if (item.record_type === 'quota_state') quota = applyQuotaRecord(quota, item)
    const surplus = applySurplusRecords(emptySurplusState(), records)
    return { quota, surplus, catalogue, services }
  }

  // --- results, journal and status file ------------------------------------------------------

  function writeStatus() {
    try {
      writeSecureFile(join(baseDir, STATUS_FILE), `${JSON.stringify({
        updatedAt: now().toISOString(),
        terminal: terminalResult,
        activeRun: activeRun ? { runId: activeRun.runId, ideaId: activeRun.ideaId, serviceId: activeRun.serviceId, startedAt: activeRun.startedAt, hardStopAt: activeRun.hardStopAt } : null,
        lastTick,
      }, null, 2)}\n`)
    } catch {
      // the status file is informational
    }
  }

  function skipped(at, reason, detail, extra = {}) {
    const { journal = true, ...rest } = extra
    const result = { at: at.toISOString(), started: false, reason, detail, ...rest }
    if (journal) {
      const key = `${reason}|${rest.ideaId ?? ''}|${rest.serviceId ?? ''}`
      if (key !== lastSkipKey) {
        lastSkipKey = key
        try {
          appendEvaluationSkipped(baseDir, { at: result.at, reason, ideaId: rest.ideaId ?? null, serviceId: rest.serviceId ?? null })
        } catch {
          // journal failure must not stop the loop
        }
      }
    }
    return result
  }

  async function finish(exitCode, reason, detail) {
    if (terminalResult) return terminalResult
    terminalResult = { terminal: true, started: false, exitCode, reason, detail, at: now().toISOString() }
    try {
      await lease.release()
    } catch {
      // best effort
    }
    writeStatus()
    emit('exit', { exitCode, reason })
    return terminalResult
  }

  // --- lifecycle -----------------------------------------------------------------------------

  async function ensureReady() {
    if (terminalResult) return terminalResult
    if (ready) return null
    if (!config.workspaceId || !api) {
      return finish(EXIT_CODES.PREFLIGHT, 'no_shared_mode', 'Automatic runs need shared mode: set a workspace id and API base with "config".')
    }
    try {
      await lease.claim({ approved: {} })
    } catch (error) {
      if (error instanceof LeaseError) return finish(error.exitCode, error.reason, error.message)
      throw error
    }
    ready = true
    return null
  }

  async function heartbeat() {
    const result = await lease.heartbeat(lastApproved === undefined ? {} : { approved: lastApproved })
    if (result.status === 'lost') return finish(result.exitCode, result.reason, result.message)
    return null
  }

  // --- restart recovery (research D8) ---------------------------------------------------------

  // Compare-and-set update; on a version conflict, rebuild the payload on top of the server's copy and write once more.
  function putRecord(ref, build) {
    return withRetry(async () => {
      try {
        return remember(await api.updateRecord(ref.id, { expectedVersion: ref.version, payload: build(ref.payload) }))
      } catch (error) {
        if (!isVersionConflict(error) || !error.serverRecord) throw error
        return remember(await api.updateRecord(error.serverRecord.id, {
          expectedVersion: error.serverRecord.version,
          payload: build(error.serverRecord.payload),
        }))
      }
    })
  }

  // Runner-owned fields only, on top of whatever the user changed meanwhile.
  const putIdea = (ref, patch, at) => putRecord(ref, (payload) => ({ ...payload, ...patch, updatedAt: at.toISOString() }))

  const putRun = (ref, payload) => putRecord(ref, () => payload)

  async function recover(at) {
    await fullPull()
    const { surplus } = derive()
    const interruptedAt = at.toISOString()
    const journalOpen = new Map(unfinishedRuns(baseDir).map((entry) => [entry.runId, entry]))
    const runRecordFor = (runId) => cache.get(`routing_config|${runKey(runId)}`) ?? null
    const ideaRecordFor = (ideaId) => cache.get(`routing_config|${ideaKey(ideaId)}`) ?? null
    const orphanIds = new Set(journalOpen.keys())
    for (const run of surplus.runs) if (run.status === RUN_STATUS.RUNNING) orphanIds.add(run.id)

    for (const runId of orphanIds) {
      const runRef = runRecordFor(runId)
      let ideaId = journalOpen.get(runId)?.ideaId ?? null
      let ideaStatus = STATUS.FAILED
      if (runRef && runRef.payload.status === RUN_STATUS.RUNNING) {
        ideaId = runRef.payload.ideaId
        await putRun(runRef, {
          ...runRef.payload,
          status: RUN_STATUS.INTERRUPTED,
          endedAt: interruptedAt,
          failureReason: { code: FAILURE_REASONS.INTERRUPTED, message: 'The runner stopped before this run finished.' },
        })
      } else if (runRef) {
        // Already final (crash between the run update and the idea update): the idea follows its run.
        ideaId = runRef.payload.ideaId
        ideaStatus = IDEA_STATUS_FOR_RUN[runRef.payload.status] ?? STATUS.FAILED
      }
      const ideaRef = ideaId ? ideaRecordFor(ideaId) : null
      if (ideaRef && ideaRef.payload.status === STATUS.RUNNING) {
        await putIdea(ideaRef, { status: ideaStatus }, at)
      }
      if (journalOpen.has(runId)) {
        appendEnd(baseDir, { runId, status: RUN_STATUS.INTERRUPTED, at: interruptedAt, failureReason: FAILURE_REASONS.INTERRUPTED })
      }
      emit('recovered', { runId, ideaId })
    }

    // Ideas left `running` whose run is missing or already final: follow the run, or return to waiting when the claim never completed.
    const { surplus: after } = derive()
    for (const idea of after.ideas) {
      if (idea.status !== STATUS.RUNNING) continue
      const ideaRef = ideaRecordFor(idea.id)
      const run = after.runs.find((r) => r.id === idea.lastRunId)
      if (!ideaRef) continue
      if (!run) await putIdea(ideaRef, { status: STATUS.WAITING, serviceId: null }, at)
      else if (run.status !== RUN_STATUS.RUNNING) await putIdea(ideaRef, { status: IDEA_STATUS_FOR_RUN[run.status] ?? STATUS.FAILED }, at)
      emit('recovered', { ideaId: idea.id })
    }
  }

  // --- cycle record ---------------------------------------------------------------------------

  async function upsertCycle(serviceId, at) {
    try {
      await refresh().catch(() => {})
      const { quota, surplus } = derive()
      const readings = deriveCycleReadings(null, quota, services, at).readings.filter((r) => r.serviceId === serviceId)
      const next = applyCycleReadings(surplus.cycles, readings)
      if (next === surplus.cycles) return
      for (const reading of readings) {
        const record = next.find((c) => c.serviceId === reading.serviceId && c.resetDate === reading.nextResetDate)
        const before = surplus.cycles.find((c) => c.serviceId === record.serviceId && c.resetDate === record.resetDate)
        if (before && before.readAt === record.readAt && before.lastWeeklyRemainingPct === record.lastWeeklyRemainingPct) continue
        const logicalKey = cycleRecordKey(record.serviceId, record.resetDate)
        const existing = cache.get(`routing_config|${logicalKey}`)
        const write = async (ref) => remember(await api.updateRecord(ref.id, { expectedVersion: ref.version, payload: record }))
        try {
          if (!existing) remember(await api.createRecord({ logicalKey, payload: record }))
          else await write(existing)
        } catch (error) {
          if (isDuplicateKey(error)) {
            const server = await api.getByKey(logicalKey)
            if (server) await write(server)
          } else if (isVersionConflict(error) && error.serverRecord) await write(error.serverRecord)
          else throw error
        }
      }
    } catch (error) {
      emit('cycle-failed', { message: error?.message })
    }
  }

  // --- tick ----------------------------------------------------------------------------------

  const checkIdeaFolder = (idea) => folderCheck(idea.workingFolder, {
    baseFolder: config.projectsBaseFolder, homeDir, exclusions: config.exclusions, limitBytes: limits.copyLimitBytes,
  })

  async function checkFolders(ideas) {
    const folderChecks = {}
    const approvals = []
    for (const idea of ideas) {
      if (idea.status !== STATUS.WAITING) continue
      const check = await checkIdeaFolder(idea)
      if (!check.ok) {
        folderChecks[idea.id] = check
        continue
      }
      approvals.push({ idea, resolvedFolder: check.resolvedFolder })
      // An idea without a valid local approval is reported through the same skip mechanism of the evaluation.
      folderChecks[idea.id] = isApproved(idea, check.resolvedFolder, { baseDir })
        ? check
        : { ok: false, code: 'not_approved', resolvedFolder: check.resolvedFolder }
    }
    lastApproved = approvedVersions(approvals, { baseDir })
    return folderChecks
  }

  // Local guardrails and preflight for the provider of the selected idea (tick step 6, contracts/runner-allowance.md).
  // Steps 1 and 2 come from the shared store and can only restrict; steps 3 and 5 are local and no store write can set them.
  async function guardService(providerId, policy, catalogue) {
    const sp = policy.providers?.[providerId]
    if (sp?.autoRunEnabled !== true) return { reason: 'auto_run_disabled', detail: `Automatic runs are off for this provider (${providerId}).` }
    if (!sp.disclosuresAckAt) return { reason: 'disclosures_missing', detail: `The disclosures were not acknowledged for this provider (${providerId}).` }
    const allowed = (config.allowProviders ?? []).find((entry) => entry.providerId === providerId)
    if (!allowed) return { reason: 'service_not_allowed', detail: `Provider ${providerId} is not allowed on this runner. Run "allow" to allow it.` }
    const entry = catalogue.providers[providerId]
    const problems = entry?.status === 'active' ? surplusProblems(entry) : ['The provider is removed or its record is invalid.']
    if (problems.length > 0) return { reason: 'provider_not_eligible', detail: `${allowed.name} is not eligible for surplus use: ${problems.join(' ')}` }
    if (entry.surplus.tool !== allowed.tool) {
      return { reason: 'tool_changed', detail: `${allowed.name} was allowed with the ${allowed.tool} tool but the shared catalogue now says ${entry.surplus.tool}. Run "allow" again to confirm.` }
    }
    const adapter = adapters[entry.surplus.tool]
    if (!adapter) return { reason: 'tool_missing', detail: `No adapter for ${entry.surplus.tool}.` }
    if (adapter.tool === 'codex' && config.allowCodexAuto !== true) {
      return { reason: 'codex_reads_uncontained', detail: 'Codex reads files outside the disposable copy (not contained). Set allowCodexAuto to true in config.json to run it automatically.' }
    }
    const result = await preflight({ adapter, env, toolPath: config.tools?.[adapter.tool] })
    if (!result.ok) return { reason: result.reason, detail: result.message }
    return null
  }

  async function runTick() {
    const exit = await ensureReady()
    if (exit) return exit
    const at = now()

    if (existsSync(paths.stop)) {
      const lost = await heartbeat()
      return lost ?? skipped(at, 'stop_file', 'The STOP file exists: heartbeat only, nothing is evaluated.')
    }
    const lost = await heartbeat()
    if (lost) return lost

    try {
      await fullPull()
      // No run is active here (ticks are serialised), so a `running` run or idea is left over from a crash.
      const hasLeftover = () => {
        const { runs, ideas } = derive().surplus
        return runs.some((r) => r.status === RUN_STATUS.RUNNING) || ideas.some((i) => i.status === STATUS.RUNNING)
      }
      if (!recovered || hasLeftover()) {
        await recover(at)
        recovered = true
        await fullPull()
      }
    } catch (error) {
      if (error instanceof ApiClientError) return skipped(at, 'api_unavailable', `The shared store could not be used: ${error.message}`, { journal: false })
      throw error
    }
    const { quota, surplus, catalogue } = derive()

    if (surplus.control?.autoRunEnabled !== true) {
      return skipped(at, 'global_stop', surplus.control ? 'Automatic runs are switched off (global stop).' : 'No control record: automatic runs were never enabled.')
    }
    const policyIssue = surplus.invalid.find((entry) => entry.logicalKey === keyForPolicy())
    if (policyIssue) {
      const text = policyIssue.errors.map((e) => e.message).join('; ')
      return skipped(at, /disclosures/i.test(text) ? 'disclosures_missing' : 'policy_invalid', `The surplus policy is invalid: ${text}`)
    }
    if (!surplus.recordIndex[keyForPolicy()]) {
      return skipped(at, 'no_shared_mode', 'No surplus policy in the workspace: shared mode is off in the browser or nothing was synced yet.')
    }
    const policy = surplus.policy

    const folderChecks = await checkFolders(surplus.ideas)
    const { evaluation, go, blocked } = await selectRunnable({ at, quota, surplus, policy, folderChecks, catalogue })

    if (!go) {
      if (blocked.size > 0) {
        const [serviceId, problem] = blocked.entries().next().value
        return skipped(at, problem.reason, problem.detail, { serviceId, evaluation })
      }
      const why = explainNoSelection(evaluation, policy, catalogue)
      return skipped(at, why.reason, why.detail, { failedRules: why.failedRules, serviceId: why.serviceId, ideaId: why.ideaId, evaluation })
    }

    return claimAndRun({ at, evaluation, policy, quota })
  }

  // Evaluate, and when the selected service fails its local guard, block it and evaluate again with the next candidate.
  async function selectRunnable({ at, quota, surplus, policy, folderChecks, catalogue }) {
    const blocked = new Map()
    let evaluation
    for (let attempt = 0; attempt <= services.length; attempt += 1) {
      const effective = { ...policy, providers: { ...policy.providers } }
      for (const id of blocked.keys()) effective.providers[id] = { ...effective.providers[id], surplusEnabled: false }
      evaluation = evaluateSurplus({ now: at, state: quota, services, policy: effective, ideas: surplus.ideas, runs: surplus.runs, folderChecks, mode: 'auto' })
      if (!evaluation.selected) break
      const problem = await guardService(evaluation.selected.serviceId, policy, catalogue)
      if (!problem) return { evaluation, go: true, blocked }
      blocked.set(evaluation.selected.serviceId, problem)
    }
    return { evaluation, go: false, blocked }
  }

  // --- claim and run ---------------------------------------------------------------------------

  async function claimAndRun({ at, evaluation, policy }) {
    const { serviceId, ideaId } = evaluation.selected
    const svc = services.find((s) => s.id === serviceId)
    const adapter = adapters[svc.surplus.tool]
    const base = { serviceId, ideaId, evaluation }

    // Re-fetch the idea and recompute everything the approval depends on from that fetch (shared-records trust rules).
    const ideaRef = await api.getByKey(ideaKey(ideaId))
    if (!ideaRef) return skipped(at, 'claim_lost', 'The idea no longer exists.', base)
    const checked = validateIdeaRecord(ideaRef.payload)
    if (!checked.valid) return skipped(at, 'idea_invalid', 'The idea record is invalid.', base)
    const idea = ideaRef.payload
    if (idea.status !== STATUS.WAITING) return skipped(at, 'claim_lost', `The idea is ${idea.status}, not waiting.`, base)
    const folder = await checkIdeaFolder(idea)
    if (!folder.ok) return skipped(at, 'folder_error', `The working folder check failed (${folder.code}).`, base)
    if (!isApproved(idea, folder.resolvedFolder, { baseDir })) {
      return skipped(at, 'not_approved', 'The idea is not approved on this runner for its current content.', base)
    }

    const runId = newId()
    // Step 7: compare-and-set `waiting -> running`; a 409 starts nothing.
    let claimedIdea
    try {
      claimedIdea = remember(await api.updateRecord(ideaRef.id, {
        expectedVersion: ideaRef.version,
        payload: { ...idea, status: STATUS.RUNNING, serviceId, lastRunId: runId, updatedAt: at.toISOString() },
      }))
    } catch (error) {
      if (isVersionConflict(error)) return skipped(at, 'claim_conflict', 'Another client changed the idea first (409): nothing was started.', base)
      if (error instanceof ApiClientError) return skipped(at, 'claim_failed', `The claim failed: ${error.message}`, { ...base, journal: false })
      throw error
    }

    const serviceEvaluation = evaluation.services.find((s) => s.serviceId === serviceId)
    const costPct = serviceEvaluation?.candidate?.costPct ?? 0
    const nextResetDate = serviceEvaluation?.inputs?.nextResetDate ?? null
    const runPayload = {
      id: runId,
      ideaId,
      serviceId,
      providerName: String(svc.name).slice(0, 60),
      ideaSnapshot: {
        text: idea.text,
        context: idea.context ?? '',
        workingFolder: idea.workingFolder ?? null,
        resolvedFolder: folder.resolvedFolder,
        contentVersion: idea.contentVersion,
      },
      mode: 'auto',
      cycleKey: cycleKeyOf(serviceId, nextResetDate),
      startedAt: at.toISOString(),
      endedAt: null,
      status: RUN_STATUS.RUNNING,
      failureReason: null,
      decisionInputs: evaluation,
      estimatedCostPct: 0,
      output: '',
      truncated: false,
      proposal: null,
      localRunDir: null,
    }
    let runRef
    try {
      runRef = remember(await api.createRecord({ logicalKey: runKey(runId), payload: runPayload }))
    } catch (error) {
      if (!(error instanceof ApiClientError)) throw error
      // The idea is `running` without a run: put it back (best effort; recovery also handles it).
      await putIdea(claimedIdea, { status: STATUS.WAITING, serviceId: null }, now()).catch(() => {})
      return skipped(at, 'claim_failed', `The run record could not be written: ${error.message}`, { ...base, journal: false })
    }
    appendStart(baseDir, { runId, ideaId, serviceId, at: at.toISOString(), tool: adapter.tool })
    lastSkipKey = null
    emit('claimed', { runId, ideaId, serviceId })

    return executeRun({ at, evaluation, policy, svc, adapter, idea, folder, runId, runPayload, runRef, ideaRef: claimedIdea, costPct, nextResetDate })
  }

  async function executeRun(ctx) {
    const { at, evaluation, svc, adapter, idea, runId, runPayload, runRef, ideaRef, costPct } = ctx
    const serviceId = svc.id
    const run = { runId, ideaId: idea.id, serviceId, startedAt: at.toISOString(), hardStopAt: null, stopCause: null, child: null, exited: false, pinnedTool: adapter.tool }
    activeRun = run
    writeStatus()
    const timers = new Set()
    const arm = (fn, ms) => {
      const handle = scheduler.setTimeout(() => {
        timers.delete(handle)
        fn()
      }, ms)
      timers.add(handle)
      return handle
    }
    const disarmAll = () => {
      for (const handle of timers) scheduler.clearTimeout(handle)
      timers.clear()
    }

    const requestStop = (code, message) => {
      if (run.stopCause || run.exited) return
      run.stopCause = { code, message }
      emit('stopping', { runId, code })
      if (run.child) {
        signalChild(run.child, 'SIGTERM')
        arm(() => {
          if (!run.exited) signalChild(run.child, 'SIGKILL')
        }, limits.killGraceSeconds * 1000)
      }
    }
    run.requestStop = requestStop

    let copy = null
    let outcome
    let leaseLost = null
    try {
      copy = await makeWorkdir({
        runId, folder: idea.workingFolder, baseFolder: config.projectsBaseFolder, homeDir, baseDir,
        exclusions: config.exclusions, limitBytes: limits.copyLimitBytes,
      })
      if (!copy.ok) {
        outcome = { status: RUN_STATUS.FAILED, failureReason: { code: FAILURE_REASONS.FOLDER_ERROR, message: `The disposable copy could not be made (${copy.code}).` }, text: '', spawned: false }
      } else {
        outcome = await spawnAndSupervise({ run, adapter, idea, svc, workDir: copy.workDir, arm, requestStop, onLeaseLost: (r) => { leaseLost = r } })
      }
    } catch (error) {
      requestStop(FAILURE_REASONS.INTERRUPTED, `The runner failed: ${error?.message ?? error}`)
      outcome = { status: RUN_STATUS.FAILED, failureReason: { code: FAILURE_REASONS.INTERRUPTED, message: `The runner failed while running: ${error?.message ?? error}` }, text: '', spawned: Boolean(run.child) }
    } finally {
      disarmAll()
    }

    const endAt = now()
    const final = await finalise({ runId, runPayload, runRef, ideaRef, outcome, copy, endAt, costPct, serviceId, idea })
    activeRun = null
    lastSkipKey = null
    emit('finalised', { runId, status: final.status })
    const result = { at: at.toISOString(), started: true, reason: 'run_finished', detail: `Run ${runId} ended as ${final.status}.`, serviceId, ideaId: idea.id, runId, run: final, evaluation }
    if (leaseLost) {
      const exit = await finish(leaseLost.exitCode, leaseLost.reason, leaseLost.message)
      return { ...result, terminal: true, exitCode: exit.exitCode, reason: exit.reason, detail: exit.detail }
    }
    return result
  }

  // Re-check the stop conditions, then spawn the tool under supervision. A run that must not start ends as `interrupted`.
  async function spawnAndSupervise({ run, adapter, idea, svc, workDir, arm, requestStop, onLeaseLost }) {
    const recheck = await recheckBeforeSpawn(svc.id)
    if (!recheck.ok) return { status: RUN_STATUS.INTERRUPTED, failureReason: recheck.failureReason, text: '', spawned: false }
    run.hardStopAt = recheck.cause.at.toISOString()
    const invocation = adapter.buildInvocation({ prompt: adapter.buildPrompt(idea), cwd: workDir, env, toolPath: config.tools?.[adapter.tool] })
    const exit = await supervise({ run, invocation, cause: recheck.cause, spawnAt: recheck.spawnAt, serviceId: svc.id, svc, policy: recheck.policy, arm, requestStop, onLeaseLost })
    return decide(adapter, exit, run.stopCause)
  }

  // A copy may take long enough for a stop or a time boundary to become active. Pull again before creating a child.
  async function recheckBeforeSpawn(serviceId) {
    const stopFileCreated = { ok: false, failureReason: { code: FAILURE_REASONS.STOPPED_BY_USER, message: 'The STOP file was created.' } }
    if (existsSync(paths.stop)) return stopFileCreated
    await fullPull()
    if (existsSync(paths.stop)) return stopFileCreated
    const { quota, surplus } = derive()
    if (surplus.control?.autoRunEnabled !== true) {
      return { ok: false, failureReason: { code: FAILURE_REASONS.STOPPED_BY_USER, message: 'Automatic runs were switched off (global stop).' } }
    }
    const currentPolicy = surplus.policy
    const evaluation = evaluateSurplus({ now: now(), state: quota, services, policy: currentPolicy, ideas: [], runs: [], folderChecks: {}, mode: 'auto' })
    const current = evaluation.services.find((entry) => entry.serviceId === serviceId)
    const spawnAt = now()
    const cause = stopCauseFor(spawnAt, currentPolicy, current?.inputs?.nextResetDate)
    if (cause.at.getTime() <= spawnAt.getTime()) return { ok: false, failureReason: { code: cause.code, message: cause.message } }
    return { ok: true, policy: currentPolicy, cause, spawnAt }
  }

  // Spawn the tool, arm the hard stop and both watchers, and resolve when the process is gone.
  function supervise({ run, invocation, cause, spawnAt, serviceId, svc, policy, arm, requestStop, onLeaseLost }) {
    const captureLimit = Math.max(4 * limits.outputCapBytes, MIB)
    const out = collector(captureLimit)
    const err = collector(captureLimit)
    let child
    try {
      child = spawn(invocation.cmd, invocation.args, { cwd: invocation.cwd, env: invocation.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      return Promise.resolve({ code: null, signal: null, spawnError: error, stdout: '', stderr: '' })
    }
    run.child = child
    child.stdout?.on('data', (chunk) => out.push(chunk))
    child.stderr?.on('data', (chunk) => err.push(chunk))

    const exited = new Promise((resolve) => {
      let done = false
      const end = (value) => {
        if (done) return
        done = true
        run.exited = true
        resolve({ ...value, stdout: out.text(), stderr: err.text(), dropped: out.dropped() })
      }
      child.once('error', (error) => {
        if (typeof child.pid !== 'number') end({ code: null, signal: null, spawnError: error })
      })
      child.once('close', (code, signal) => end({ code, signal }))
    })

    // Hard stop: min(maxDuration, protected hours, reset day), SIGTERM then SIGKILL after the grace period.
    arm(() => requestStop(cause.code, cause.message), Math.max(0, cause.at.getTime() - spawnAt.getTime()))

    // Re-armed before the work so the cadence never drifts.
    const armEvery = (ms, work) => {
      const tickAgain = () => {
        if (run.exited) return
        arm(tickAgain, ms)
        work()
      }
      arm(tickAgain, ms)
    }

    // Stop watcher (5 s): STOP file and the control record.
    const guard = (work) => {
      let busy = false
      return () => {
        if (busy || run.exited) return
        busy = true
        const promise = Promise.resolve().then(work).catch((error) => emit('watcher-error', { message: error?.message })).finally(() => {
          busy = false
          inflight.delete(promise)
        })
        inflight.add(promise)
      }
    }
    const stopWork = guard(async () => {
      if (existsSync(paths.stop)) return requestStop(FAILURE_REASONS.STOPPED_BY_USER, 'The STOP file was created.')
      await refresh()
      const { surplus, catalogue } = derive()
      const control = surplus.control
      if (control && control.autoRunEnabled === false) return requestStop(FAILURE_REASONS.STOPPED_BY_USER, 'Automatic runs were switched off (global stop).')
      // The provider of the active run must still be runnable (FR-037): not removed, surplus and automatic
      // runs still on, profile still eligible and the tool unchanged. Otherwise the run stops like a STOP file.
      const cause = providerStopCause(run.serviceId, run.pinnedTool, surplus.policy, catalogue)
      if (cause) requestStop(FAILURE_REASONS.STOPPED_BY_USER, cause)
    })
    armEvery(limits.stopWatcherSeconds * 1000, stopWork)

    // Quota watcher (60 s): lease and designation, per-service switch and the reserve rule.
    const quotaWork = guard(async () => {
      const lease1 = (await lease.maybeHeartbeat()) ?? (await lease.verify())
      if (lease1?.status === 'lost') {
        onLeaseLost(lease1)
        return requestStop(FAILURE_REASONS.INTERRUPTED, `The lease was lost: ${lease1.message}`)
      }
      await refresh()
      const { quota, surplus } = derive()
      const sp = surplus.policy?.providers?.[serviceId]
      if (sp && sp.autoRunEnabled === false) return requestStop(FAILURE_REASONS.STOPPED_BY_USER, 'Automatic runs were switched off for this provider.')
      const remaining = weeklyRemainingPct(quota, svc)
      const reserve = typeof sp?.reservePct === 'number' ? sp.reservePct : policy?.providers?.[serviceId]?.reservePct ?? DEFAULTS.RESERVE_PCT
      if (remaining !== null && remaining <= reserve) {
        requestStop(FAILURE_REASONS.QUOTA_EXHAUSTED, `The weekly quota (${Math.round(remaining * 10) / 10}% left) reached the ${reserve}% reserve.`)
      }
    })
    armEvery(limits.quotaWatcherSeconds * 1000, quotaWork)

    emit('spawned', { runId: run.runId, pid: child.pid ?? null, hardStopAt: run.hardStopAt, hardStopReason: cause.code })
    return exited
  }

  // Turn the tool's exit into a final run status and reason.
  function decide(adapter, exit, stopCause) {
    if (exit.spawnError) {
      return { status: RUN_STATUS.FAILED, failureReason: { code: FAILURE_REASONS.TOOL_MISSING, message: `${adapter.tool} could not be started.` }, text: '', spawned: false, dropped: 0 }
    }
    let parsed
    try {
      parsed = adapter.parseResult({ code: exit.code, stdout: exit.stdout, stderr: exit.stderr })
    } catch {
      parsed = { status: 'failed', failureReason: null, text: exit.stdout.trim() }
    }
    const base = { spawned: true, dropped: exit.dropped ?? 0 }
    if (stopCause) {
      return { ...base, status: RUN_STATUS.INTERRUPTED, failureReason: { code: stopCause.code, message: stopCause.message }, text: parsed.text || exit.stdout.trim() }
    }
    if (parsed.status === 'completed') return { ...base, status: RUN_STATUS.COMPLETED, failureReason: null, text: parsed.text }
    if (parsed.status === 'needs_input') return { ...base, status: RUN_STATUS.NEEDS_INPUT, failureReason: null, text: parsed.text }
    if (parsed.failureReason?.code === FAILURE_REASONS.INTERRUPTED) {
      return { ...base, status: RUN_STATUS.INTERRUPTED, failureReason: parsed.failureReason, text: parsed.text }
    }
    const generic = { code: FAILURE_REASONS.INTERRUPTED, message: `The tool failed (exit code ${exit.code}) without a recognised reason.` }
    return { ...base, status: RUN_STATUS.FAILED, failureReason: parsed.failureReason ?? generic, text: parsed.text }
  }

  // Step 9: capture, diff, PUT run once, PUT idea, upsert the cycle record, journal end.
  async function finalise({ runId, runPayload, runRef, ideaRef, outcome, copy, endAt, costPct, serviceId, idea }) {
    const capped = capOutput(outcome.text ?? '', limits.outputCapBytes)
    let proposal = null
    if (copy?.ok && outcome.spawned) {
      try {
        const diff = await makeDiff({ originalDir: copy.originalDir, workDir: copy.workDir, exclusions: config.exclusions, maxDiffBytes: limits.diffCapBytes })
        const files = diff.changed.length + diff.added.length + diff.removed.length
        if (files > 0) proposal = { diff: diff.diff, truncated: diff.truncated, files }
      } catch (error) {
        emit('diff-failed', { message: error?.message })
      }
    }
    if (copy?.ok) {
      try {
        writeSecureFile(join(copy.runDir, 'output.txt'), outcome.text ?? '')
        if (proposal) writeSecureFile(join(copy.runDir, 'proposal.diff'), proposal.diff)
      } catch {
        // local copies of the output are a convenience
      }
    }
    const final = {
      ...runPayload,
      endedAt: endAt.toISOString(),
      status: outcome.status,
      failureReason: outcome.failureReason,
      estimatedCostPct: outcome.spawned ? costPct : 0,
      output: capped.text,
      truncated: capped.truncated || (outcome.dropped ?? 0) > 0,
      proposal,
      localRunDir: copy?.ok ? copy.runDir : null,
    }
    try {
      await putRun(runRef, final)
    } catch (error) {
      emit('finalise-failed', { runId, message: error?.message })
    }
    try {
      await putIdea(ideaRef, { status: IDEA_STATUS_FOR_RUN[outcome.status] ?? STATUS.FAILED, serviceId, lastRunId: runId }, endAt)
    } catch (error) {
      emit('idea-update-failed', { runId, ideaId: idea.id, message: error?.message })
    }
    await upsertCycle(serviceId, endAt)
    try {
      appendEnd(baseDir, { runId, status: outcome.status, at: endAt.toISOString(), failureReason: outcome.failureReason?.code ?? null })
    } catch (error) {
      emit('journal-failed', { message: error?.message })
    }
    return final
  }

  // --- public API ------------------------------------------------------------------------------

  async function tick() {
    if (terminalResult) return terminalResult
    if (tickPromise) {
      const at = now()
      return skipped(at, activeRun ? 'run_active' : 'tick_in_progress', activeRun ? 'A run is already active in this workspace.' : 'An evaluation is already in progress.', { journal: false })
    }
    tickPromise = (async () => {
      let result
      try {
        result = await runTick()
      } catch (error) {
        result = skipped(now(), 'internal_error', error?.message ?? String(error), { journal: false })
        emit('error', { message: error?.message })
      }
      lastTick = { ...result, evaluation: result.evaluation ?? null, run: undefined }
      writeStatus()
      emit('tick', { result })
      return result
    })()
    try {
      return await tickPromise
    } finally {
      tickPromise = null
    }
  }

  async function start() {
    while (!terminalResult) {
      const result = await tick()
      if (result.terminal || stopping) break
      await sleep(intervalMs)
      if (stopping) break
    }
    return terminalResult ?? finish(EXIT_CODES.OK, 'stopped', 'The runner was stopped.')
  }

  async function stop() {
    stopping = true
    if (wake) wake()
    if (activeRun) activeRun.requestStop(FAILURE_REASONS.STOPPED_BY_USER, 'The runner was stopped.')
    if (tickPromise) await tickPromise.catch(() => {})
    return finish(EXIT_CODES.OK, 'stopped', 'The runner was stopped.')
  }

  return {
    intervalMs,
    start,
    stop,
    tick,
    settled: () => Promise.all([...inflight]).then(() => undefined),
    status: () => ({
      ready,
      terminal: terminalResult,
      intervalMs,
      activeRun: activeRun ? { runId: activeRun.runId, ideaId: activeRun.ideaId, serviceId: activeRun.serviceId, startedAt: activeRun.startedAt, hardStopAt: activeRun.hardStopAt, stopping: Boolean(activeRun.stopCause) } : null,
      lastTick,
    }),
  }
}
