// Runner CLI entry (T057, contracts/runner-cli.md): command dispatch.
//
//   config [--take-over | --exclusions]   start   approve [ideaId]   approvals [list | revoke <ideaId>]
//   status   stop   clean [runId | --all]
//
// Exit codes: 0 ok; 1 usage or config error; 2 preflight failure; 3 another device is designated or holds the lease.
//
// `main(argv, io)` takes the arguments after `node runner/index.js` and returns the exit code. Everything that touches
// the outside world is injectable through `io` (see `resolveIo`), so tests need no network, tools or real terminal.
// `process.exit` is only called by the main-guard at the bottom of this file.
//
// Safety: this file never prints the environment, secrets or raw tool output. Text that comes from the shared store
// (idea text, status details) is stripped of control characters before it is shown, and an approval screen refuses
// content with control characters so the "type yes" prompt cannot be spoofed with terminal escapes.

import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SERVICES } from '../src/data/services.js'
import { STATUS } from '../src/surplus/constants.js'
import { keyForControl, parseRecordKey } from '../src/surplus/records.js'
import { ApiClientError, createApiClient, isDuplicateKey, isVersionConflict } from './api-client.js'
import { approve, listApprovals, pendingApprovals, revoke } from './approvals.js'
import {
  ConfigError, createTerminalIO, defaultBaseDir, editExclusions, loadConfig, runConfigWizard, runnerPaths, takeOver,
  writeSecureFile, ensureDir,
} from './config.js'
import { unfinishedRuns } from './journal.js'
import { EXIT_CODES, createLease, readLeaseStatus } from './lease.js'
import { createLoop, readStatusFile } from './loop.js'
import { checkFolder, cleanWorkdir } from './workdir.js'

export { EXIT_CODES }

const CLEAN_AGE_MS = 24 * 60 * 60 * 1000
const PREVIEW_CHARS = 60
const DETAIL_CHARS = 300
const RUN_CMD = 'npm run runner --'

export const USAGE = `Usage: ${RUN_CMD} <command> [options]

Commands:
  config [--take-over | --exclusions]  Create or edit the local config (device, API base, workspace, projects folder,
                                       allowed services, copy exclusions). --take-over makes this device the
                                       designated runner. --exclusions edits only the copy exclusion list.
  start                                Take the lease and run the loop (Ctrl-C stops it cleanly).
  approve [ideaId]                     Without an id, list ideas waiting for approval. With an id, show the exact
                                       text, context, folder (or the no-folder notice) and exclusions and require typing "yes".
  approvals [list | revoke <ideaId>]   List or revoke the local approvals.
  status                               Show config, lease, last evaluation and active run (read-only).
  stop                                 Write the STOP file and switch automatic runs off in the shared store.
  clean [runId | --all]                Remove disposable copies: one run, all finished runs, or (default) runs
                                       older than 24 hours.

Exit codes: 0 ok, 1 usage or config error, 2 preflight failure, 3 another device is designated or holds the lease.
`

// Per command: accepted flags and the maximum number of positional arguments.
const COMMANDS = Object.freeze({
  config: { flags: ['--take-over', '--exclusions'], positionals: 0 },
  start: { flags: [], positionals: 0 },
  approve: { flags: [], positionals: 1 },
  approvals: { flags: [], positionals: 2 },
  status: { flags: [], positionals: 0 },
  stop: { flags: [], positionals: 0 },
  clean: { flags: ['--all'], positionals: 1 },
})

class UsageError extends Error {}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g
// Tab and newline are fine in multi-line idea text; everything else is refused on the approval screen.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** One line of display text from untrusted input: control characters become spaces, long text is cut. */
export function safeLine(value, max = DETAIL_CHARS) {
  const flat = String(value ?? '').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** The API base without credentials or query, for display. */
function displayApiBase(apiBase) {
  try {
    const url = new URL(apiBase)
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return 'invalid'
  }
}

// --- Argument parsing ----------------------------------------------------------------------

function parseArgs(command, args) {
  const spec = COMMANDS[command]
  const flags = new Set()
  const positionals = []
  for (const arg of args) {
    if (arg.startsWith('-')) {
      if (!spec.flags.includes(arg)) throw new UsageError(`Unknown option for ${command}: ${safeLine(arg, 40)}`)
      flags.add(arg)
    } else positionals.push(arg)
  }
  if (positionals.length > spec.positionals) throw new UsageError(`Too many arguments for ${command}.`)
  return { flags, positionals }
}

// --- Injected environment --------------------------------------------------------------------

/**
 * `io` (every field optional): stdout, stderr ({ write }), stdin, env, homeDir, baseDir (default $KAIROS_RUNNER_HOME or
 * ~/.kairos-runner), now (() => Date), createApi(config), createTerminal() ({ write, ask, close }), signals ({ on, off }),
 * createLease(options), createLoop(options), loopOptions (merged into the createLoop options: scheduler, spawn, deps, ...).
 */
function resolveIo(io = {}) {
  const env = io.env ?? process.env
  const homeDir = io.homeDir ?? homedir()
  const stdout = io.stdout ?? process.stdout
  const stdin = io.stdin ?? process.stdin
  const baseDir = resolve(io.baseDir ?? defaultBaseDir({ env, home: homeDir }))
  return {
    env,
    homeDir,
    baseDir,
    paths: runnerPaths(baseDir),
    now: io.now ?? (() => new Date()),
    out: (text) => stdout.write(text),
    err: (text) => (io.stderr ?? process.stderr).write(text),
    createApi: io.createApi ?? ((config) => createApiClient({
      apiBase: config.apiBase, workspaceId: config.workspaceId, timeoutMs: config.limits.requestTimeoutMs,
    })),
    createTerminal: io.createTerminal ?? (() => createTerminalIO({ input: stdin, output: stdout })),
    signals: io.signals ?? process,
    createLease: io.createLease ?? createLease,
    createLoop: io.createLoop ?? createLoop,
    loopOptions: io.loopOptions ?? {},
  }
}

function requireConfig(ctx) {
  const loaded = loadConfig(ctx.baseDir)
  if (loaded.ok) return loaded
  if (loaded.reason === 'missing') {
    ctx.err(`No runner config found in ${ctx.baseDir}. Run "${RUN_CMD} config" first.\n`)
  } else if (loaded.reason === 'invalid') {
    ctx.err(`The runner config is invalid:\n${loaded.errors.map((e) => `  - ${e.message}`).join('\n')}\nRun "${RUN_CMD} config" to fix it.\n`)
  } else {
    ctx.err(`The runner config cannot be read (${loaded.reason}). Run "${RUN_CMD} config" to recreate it.\n`)
  }
  return null
}

const apiProblem = (error) => `${error.kind === 'timeout' || error.kind === 'network' ? 'shared store unreachable' : 'shared store error'} (${error.kind}${error.status ? ` ${error.status}` : ''})`

// --- Shared store: ideas ---------------------------------------------------------------------

/** Ideas of the shared store: [{ recordId, idea }]. An idea whose payload id differs from its key is ignored. */
async function fetchIdeas(api) {
  const { items } = await api.listRecords()
  const ideas = []
  for (const item of items ?? []) {
    if (item.record_type !== 'routing_config' || item.deleted_at) continue
    const parsed = parseRecordKey(item.logical_key)
    if (parsed?.kind !== 'idea' || !isObject(item.payload)) continue
    if (item.payload.id !== parsed.id) continue
    ideas.push({ recordId: item.id, idea: item.payload })
  }
  return ideas
}

const folderCheckFor = (ctx, config, idea) => checkFolder(idea.workingFolder, {
  baseFolder: config.projectsBaseFolder, homeDir: ctx.homeDir, exclusions: config.exclusions, limitBytes: config.limits.copyLimitBytes,
})

/** Waiting ideas that asked for approval, split into reviewable ones and ones whose folder is not usable. */
async function approvalCandidates(ctx, config, api) {
  const reviewable = []
  const blocked = []
  for (const { idea } of await fetchIdeas(api)) {
    if (idea.status !== STATUS.WAITING || idea.approvalRequested !== true) continue
    const check = await folderCheckFor(ctx, config, idea)
    if (check.ok) reviewable.push({ idea, resolvedFolder: check.resolvedFolder })
    else blocked.push({ idea, code: check.code })
  }
  return { pending: pendingApprovals(reviewable, { baseDir: ctx.baseDir }), blocked }
}

// --- config ----------------------------------------------------------------------------------

async function cmdConfig(ctx, { flags }) {
  if (flags.has('--take-over') && flags.has('--exclusions')) throw new UsageError('Use either --take-over or --exclusions, not both.')

  if (flags.has('--take-over')) {
    const loaded = requireConfig(ctx)
    if (!loaded) return EXIT_CODES.USAGE
    const { config } = loaded
    const result = await takeOver({ config, api: ctx.createApi(config), now: ctx.now() })
    ctx.out(`${config.deviceName} is now the designated runner of workspace ${config.workspaceId}.\n`)
    if (result.previousDesignatedDeviceId && result.previousDesignatedDeviceId !== config.deviceId) {
      ctx.out('The previously designated device stops on its next heartbeat.\n')
    }
    ctx.out(`Run "${RUN_CMD} start" to begin.\n`)
    return EXIT_CODES.OK
  }

  const terminal = ctx.createTerminal()
  try {
    if (flags.has('--exclusions')) {
      await editExclusions({ baseDir: ctx.baseDir, io: terminal })
      ctx.out('Exclusions saved.\n')
      return EXIT_CODES.OK
    }
    const config = await runConfigWizard({ baseDir: ctx.baseDir, io: terminal })
    ctx.out(`\nConfig saved to ${ctx.paths.config}\n`)
    ctx.out(`  device ${config.deviceName}, workspace ${config.workspaceId}, API ${displayApiBase(config.apiBase)}\n`)
    ctx.out(`  allowed services: ${config.allowServices.length > 0 ? config.allowServices.join(', ') : '(none)'}\n`)
    ctx.out(`Next: "${RUN_CMD} config --take-over" to designate this device, then "${RUN_CMD} start".\n`)
    return EXIT_CODES.OK
  } finally {
    terminal.close()
  }
}

// --- start -----------------------------------------------------------------------------------

function disclosuresText(config) {
  const lines = ['', 'Before automatic runs start, please note (FR-012):']
  for (const id of config.allowServices) {
    const name = SERVICES.find((s) => s.id === id)?.name ?? id
    lines.push(`  - ${name}: when a run starts, the idea text, its context and, if the idea has a working folder, a disposable copy of it are`)
    lines.push('    sent to the provider through your signed-in tool. Runs use your subscription sign-in, never an API key.')
  }
  lines.push('  - Anyone on your local network can read the shared ideas while shared-store access is unauthenticated.')
  lines.push('  - Provider rules on automated usage can change; check them before relying on this.')
  lines.push('  - Results are drafts in a disposable copy: nothing is applied to your original folder.')
  lines.push(`  - To stop: Ctrl-C here, "${RUN_CMD} stop", or the global stop button in the dashboard.`)
  lines.push('')
  return lines.join('\n')
}

async function cmdStart(ctx) {
  const loaded = requireConfig(ctx)
  if (!loaded) return EXIT_CODES.USAGE
  const { config } = loaded
  if (config.allowServices.length === 0) {
    ctx.err(`No service is allowed to run automatically. Run "${RUN_CMD} config" and list the services to allow.\n`)
    return EXIT_CODES.USAGE
  }

  ctx.out(disclosuresText(config))
  if (existsSync(ctx.paths.stop)) {
    ctx.out(`Note: the STOP file exists (${ctx.paths.stop}). The runner will only send heartbeats until you delete it.\n`)
  }

  const api = ctx.createApi(config)
  const lease = ctx.createLease({ config, api, now: ctx.now })
  // One progress line per change of outcome, so a runner that keeps retrying (store down, nothing eligible) is not silent.
  let lastOutcome = null
  const reportTick = (event) => {
    const result = event?.type === 'tick' ? event.result : null
    if (!result || result.terminal) return
    const outcome = result.started ? `run:${result.at}` : `${result.reason}|${result.serviceId ?? ''}`
    if (outcome === lastOutcome) return
    lastOutcome = outcome
    const stamp = safeLine(result.at, 40)
    ctx.out(result.started
      ? `[${stamp}] ran idea ${safeLine(result.ideaId, 60)} on ${safeLine(result.serviceId, 30)}: ${safeLine(result.run?.status ?? result.reason, 30)}\n`
      : `[${stamp}] nothing started (${safeLine(result.reason, 60)}): ${safeLine(result.detail)}\n`)
  }
  const loop = ctx.createLoop({
    config, baseDir: ctx.baseDir, api, lease, now: ctx.now, env: ctx.env, homeDir: ctx.homeDir, ...ctx.loopOptions,
    onEvent: (event) => {
      reportTick(event)
      ctx.loopOptions.onEvent?.(event)
    },
  })

  let stopping = null
  const onSignal = (signal) => {
    if (stopping) return
    ctx.out(`\nReceived ${signal}: stopping the runner...\n`)
    stopping = Promise.resolve().then(() => loop.stop()).catch(() => {})
  }
  const signalNames = ['SIGINT', 'SIGTERM']
  for (const name of signalNames) ctx.signals.on(name, onSignal)

  ctx.out(`Runner started as ${config.deviceName}. Press Ctrl-C to stop.\n`)
  let exit
  try {
    exit = await loop.start()
  } catch (error) {
    stopping ??= Promise.resolve().then(() => loop.stop()).catch(() => {}) // release the lease, best effort
    await stopping
    throw error
  } finally {
    for (const name of signalNames) ctx.signals.off(name, onSignal)
  }
  if (stopping) await stopping

  const code = Object.values(EXIT_CODES).includes(exit?.exitCode) ? exit.exitCode : EXIT_CODES.USAGE
  if (code === EXIT_CODES.OK) ctx.out('Runner stopped.\n')
  else ctx.err(`Runner stopped (${safeLine(exit?.reason, 60)}): ${safeLine(exit?.detail)}\n`)
  return code
}

// --- approve / approvals -----------------------------------------------------------------------

async function cmdApprove(ctx, { positionals }) {
  const loaded = requireConfig(ctx)
  if (!loaded) return EXIT_CODES.USAGE
  const { config } = loaded
  const api = ctx.createApi(config)

  if (positionals.length === 0) {
    const { pending, blocked } = await approvalCandidates(ctx, config, api)
    if (pending.length === 0 && blocked.length === 0) {
      ctx.out('No idea is waiting for approval on this device.\n')
      return EXIT_CODES.OK
    }
    if (pending.length > 0) {
      ctx.out(`Ideas waiting for approval (${pending.length}):\n`)
      for (const { idea, resolvedFolder } of pending) {
        const where = resolvedFolder === null ? 'no working folder, empty scratch directory' : safeLine(resolvedFolder, 120)
        ctx.out(`  ${safeLine(idea.id, 80)}  ${safeLine(idea.text, PREVIEW_CHARS)}  [${where}]\n`)
      }
      ctx.out(`Run "${RUN_CMD} approve <ideaId>" to review one in full and approve it.\n`)
    }
    if (blocked.length > 0) {
      ctx.out(`Ideas that asked for approval but have no usable folder (${blocked.length}):\n`)
      for (const { idea, code } of blocked) ctx.out(`  ${safeLine(idea.id, 80)}  ${safeLine(idea.text, PREVIEW_CHARS)}  (${code})\n`)
    }
    return EXIT_CODES.OK
  }

  const [ideaId] = positionals
  const found = (await fetchIdeas(api)).find((entry) => entry.idea.id === ideaId)
  if (!found) {
    ctx.err(`No idea with id ${safeLine(ideaId, 80)} in the shared store.\n`)
    return EXIT_CODES.USAGE
  }
  const { idea } = found
  if (idea.status !== STATUS.WAITING) {
    ctx.err(`Idea ${safeLine(ideaId, 80)} is "${safeLine(idea.status, 30)}": only waiting ideas can be approved.\n`)
    return EXIT_CODES.USAGE
  }
  const check = await folderCheckFor(ctx, config, idea)
  if (!check.ok) {
    ctx.err(`Idea ${safeLine(ideaId, 80)} cannot be approved: its folder is not usable (${check.code}).\n`)
    return EXIT_CODES.USAGE
  }
  // An idea without a working folder has resolvedFolder null: the prompt prints a fixed notice instead of a path.
  const shown = [idea.id, idea.text, idea.context ?? '', ...(check.resolvedFolder === null ? [] : [check.resolvedFolder])]
  if (shown.some((value) => typeof value !== 'string' || UNSAFE_CHARS.test(value))) {
    ctx.err('Refusing to show this idea: its id, text, context or folder contains control characters.\n')
    return EXIT_CODES.USAGE
  }

  const terminal = ctx.createTerminal()
  try {
    const prompter = { write: (text) => terminal.write(text), ask: async (question) => (await terminal.ask(question)) ?? '', close() {} }
    const result = await approve(idea, check.resolvedFolder, {
      baseDir: ctx.baseDir, now: ctx.now().toISOString(), exclusions: config.exclusions, prompter,
    })
    if (result.error) {
      ctx.err('This idea cannot be approved: its content is incomplete.\n')
      return EXIT_CODES.USAGE
    }
    if (!result.approved) {
      ctx.out('Not approved.\n')
      return EXIT_CODES.OK
    }
    ctx.out('Approved on this device. Editing the idea text, context or folder withdraws the approval.\n')
    return EXIT_CODES.OK
  } finally {
    terminal.close()
  }
}

async function cmdApprovals(ctx, { positionals }) {
  const [action = 'list', ideaId] = positionals
  if (action === 'list' && positionals.length <= 1) {
    const entries = listApprovals({ baseDir: ctx.baseDir })
    if (entries.length === 0) {
      ctx.out('No local approvals.\n')
      return EXIT_CODES.OK
    }
    ctx.out(`Local approvals (${entries.length}):\n`)
    for (const entry of entries) {
      ctx.out(`  ${safeLine(entry.ideaId, 80)}  approved ${safeLine(entry.approvedAt ?? 'unknown', 40)}  ${safeLine(entry.preview, PREVIEW_CHARS)}\n`)
    }
    return EXIT_CODES.OK
  }
  if (action === 'revoke' && positionals.length === 2) {
    if (revoke(ideaId, { baseDir: ctx.baseDir })) {
      ctx.out(`Revoked the approval of ${safeLine(ideaId, 80)}.\n`)
      return EXIT_CODES.OK
    }
    ctx.err(`No local approval for ${safeLine(ideaId, 80)}.\n`)
    return EXIT_CODES.USAGE
  }
  throw new UsageError('Usage: approvals [list | revoke <ideaId>]')
}

// --- status ----------------------------------------------------------------------------------

function printLease(ctx, lease) {
  if (!lease.exists) {
    ctx.out('Lease: no runner has been designated in this workspace yet.\n')
    return
  }
  const who = lease.designatedHere ? 'this device' : 'another device'
  ctx.out(`Lease: designated runner ${safeLine(lease.designatedDeviceName ?? lease.designatedDeviceId ?? 'unknown', 80)} (${who})\n`)
  if (lease.heartbeatAt === null) ctx.out('  no readable heartbeat\n')
  else ctx.out(`  last heartbeat ${lease.ageSeconds}s ago by ${safeLine(lease.holderDeviceName ?? lease.holderDeviceId ?? 'unknown', 80)}, lease ${lease.expired ? 'expired' : 'live'}\n`)
  if (!lease.valid) ctx.out('  the lease record is malformed\n')
}

function printEvaluation(ctx, evaluation) {
  if (!isObject(evaluation) || !Array.isArray(evaluation.services)) return
  for (const svc of evaluation.services) {
    const rules = Array.isArray(svc.rules) ? svc.rules : []
    ctx.out(`    ${safeLine(svc.serviceId, 30)}: ${svc.eligible ? 'eligible' : 'not eligible'}  ${rules.map((r) => `${safeLine(r.id, 6)} ${r.pass ? 'ok' : 'FAIL'}`).join('  ')}\n`)
    for (const rule of rules.filter((r) => !r.pass && typeof r.detail === 'string')) {
      ctx.out(`      ${safeLine(rule.id, 6)}: ${safeLine(rule.detail)}\n`)
    }
  }
}

function printLocalStatus(ctx, status) {
  if (!isObject(status)) {
    ctx.out('Runner process: no status recorded yet (the runner has not ticked on this device).\n')
    return
  }
  ctx.out(`Runner process: last update ${safeLine(status.updatedAt, 40)}\n`)
  if (isObject(status.terminal)) ctx.out(`  stopped: ${safeLine(status.terminal.reason, 60)} (exit ${Number(status.terminal.exitCode)}) ${safeLine(status.terminal.detail)}\n`)
  if (isObject(status.activeRun)) {
    const run = status.activeRun
    ctx.out(`  active run ${safeLine(run.runId, 60)} for idea ${safeLine(run.ideaId, 60)} on ${safeLine(run.serviceId, 30)}, started ${safeLine(run.startedAt, 40)}, hard stop ${safeLine(run.hardStopAt, 40)}\n`)
  } else ctx.out('  no active run\n')
  const tick = status.lastTick
  if (isObject(tick)) {
    ctx.out(`  last evaluation ${safeLine(tick.at, 40)}: ${tick.started ? 'started a run' : 'nothing started'} (${safeLine(tick.reason, 60)}) ${safeLine(tick.detail)}\n`)
    if (Array.isArray(tick.failedRules) && tick.failedRules.length > 0) ctx.out(`  failed rules: ${tick.failedRules.map((r) => safeLine(r, 6)).join(', ')}\n`)
    printEvaluation(ctx, tick.evaluation)
  }
}

async function cmdStatus(ctx) {
  const loaded = requireConfig(ctx)
  if (!loaded) return EXIT_CODES.USAGE
  const { config } = loaded
  ctx.out('Kairos runner status\n')
  ctx.out(`  device ${config.deviceName} (${config.deviceId}), workspace ${config.workspaceId}\n`)
  ctx.out(`  API ${displayApiBase(config.apiBase)}, projects folder ${config.projectsBaseFolder ?? '(not set)'}\n`)
  ctx.out(`  allowed services: ${config.allowServices.length > 0 ? config.allowServices.join(', ') : '(none)'}\n`)
  ctx.out(`  STOP file: ${existsSync(ctx.paths.stop) ? `present (${ctx.paths.stop})` : 'absent'}\n`)

  printLocalStatus(ctx, await readStatusFile(ctx.baseDir))

  const local = listApprovals({ baseDir: ctx.baseDir })
  ctx.out(`Local approvals: ${local.length}\n`)

  const api = ctx.createApi(config)
  try {
    printLease(ctx, await readLeaseStatus({ config, api, now: ctx.now }))
  } catch (error) {
    if (!(error instanceof ApiClientError)) throw error
    ctx.out(`Lease: unavailable, ${apiProblem(error)}\n`)
    return EXIT_CODES.OK
  }
  try {
    const { pending, blocked } = await approvalCandidates(ctx, config, api)
    ctx.out(`Pending approvals: ${pending.length}${blocked.length > 0 ? ` (plus ${blocked.length} with an unusable folder)` : ''}\n`)
    for (const { idea } of pending) ctx.out(`  ${safeLine(idea.id, 80)}  ${safeLine(idea.text, PREVIEW_CHARS)}\n`)
  } catch (error) {
    if (!(error instanceof ApiClientError)) throw error
    ctx.out(`Pending approvals: unavailable, ${apiProblem(error)}\n`)
  }
  return EXIT_CODES.OK
}

// --- stop ------------------------------------------------------------------------------------

async function switchAutoRunOff(api, now) {
  const key = keyForControl()
  const at = now().toISOString()
  let record = await api.getByKey(key)
  if (!record) {
    try {
      await api.createRecord({ logicalKey: key, payload: { autoRunEnabled: false, updatedAt: at } })
      return
    } catch (error) {
      if (!isDuplicateKey(error)) throw error
      record = await api.getByKey(key)
      if (!record) throw error
    }
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      await api.updateRecord(record.id, {
        expectedVersion: record.version,
        payload: { ...(isObject(record.payload) ? record.payload : {}), autoRunEnabled: false, updatedAt: at },
      })
      return
    } catch (error) {
      if (attempt > 0 || !isVersionConflict(error) || !error.serverRecord) throw error
      record = error.serverRecord
    }
  }
}

async function cmdStop(ctx) {
  try {
    ensureDir(ctx.baseDir)
    writeSecureFile(ctx.paths.stop, `${ctx.now().toISOString()}\n`)
  } catch {
    ctx.err(`Could not write the STOP file ${ctx.paths.stop}.\n`)
    return EXIT_CODES.USAGE
  }
  ctx.out(`STOP file written: ${ctx.paths.stop}\nNo new run starts on this device, and a running tool is terminated within 5 seconds. Delete the file to allow runs again.\n`)

  const loaded = loadConfig(ctx.baseDir)
  if (!loaded.ok) {
    ctx.out('The shared store was not updated because there is no valid runner config.\n')
    return EXIT_CODES.OK
  }
  try {
    await switchAutoRunOff(ctx.createApi(loaded.config), ctx.now)
    ctx.out('Automatic runs are switched off in the shared store (surplus-control).\n')
  } catch (error) {
    const reason = error instanceof ApiClientError ? apiProblem(error) : 'unexpected error'
    ctx.out(`Could not switch automatic runs off in the shared store (${reason}). The STOP file still blocks runs on this device.\n`)
  }
  return EXIT_CODES.OK
}

// --- clean -----------------------------------------------------------------------------------

function listRunDirs(runsDir) {
  try {
    return readdirSync(runsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  } catch {
    return []
  }
}

async function cmdClean(ctx, { flags, positionals }) {
  const all = flags.has('--all')
  if (all && positionals.length > 0) throw new UsageError('Use either a run id or --all, not both.')
  const runs = listRunDirs(ctx.paths.runsDir)
  const active = new Set(unfinishedRuns(ctx.baseDir).map((entry) => entry.runId))

  let targets
  if (positionals.length === 1) {
    const [runId] = positionals
    if (!runs.includes(runId)) {
      ctx.err(`No run ${safeLine(runId, 80)} in ${ctx.paths.runsDir}.\n`)
      return EXIT_CODES.USAGE
    }
    if (active.has(runId)) {
      ctx.err(`Run ${safeLine(runId, 80)} has no end entry in the journal (still running, or interrupted). Start the runner to recover it, then clean.\n`)
      return EXIT_CODES.USAGE
    }
    targets = [runId]
  } else if (all) {
    targets = runs
  } else {
    const cutoff = ctx.now().getTime() - CLEAN_AGE_MS
    targets = runs.filter((id) => {
      try {
        return statSync(join(ctx.paths.runsDir, id)).mtimeMs < cutoff
      } catch {
        return false
      }
    })
  }

  let removed = 0
  let failed = 0
  const skipped = targets.filter((id) => active.has(id))
  for (const runId of targets.filter((id) => !active.has(id))) {
    const result = await cleanWorkdir({ runId, baseDir: ctx.baseDir, removeRunDir: true })
    if (result.ok) removed += result.removed ? 1 : 0
    else failed += 1
  }
  ctx.out(`Removed ${removed} run${removed === 1 ? '' : 's'}.\n`)
  if (skipped.length > 0) ctx.out(`Kept ${skipped.length} unfinished run${skipped.length === 1 ? '' : 's'} (no end entry in the journal): ${skipped.map((id) => safeLine(id, 60)).join(', ')}\n`)
  if (failed > 0) {
    ctx.err(`Could not clean ${failed} run${failed === 1 ? '' : 's'} (invalid run directory name).\n`)
    return EXIT_CODES.USAGE
  }
  return EXIT_CODES.OK
}

// --- dispatch --------------------------------------------------------------------------------

const HANDLERS = Object.freeze({
  config: cmdConfig, start: cmdStart, approve: cmdApprove, approvals: cmdApprovals, status: cmdStatus, stop: cmdStop, clean: cmdClean,
})

/**
 * Run one command. `argv` is the argument list after the script name. Returns the exit code, never throws and never
 * calls process.exit.
 */
export async function main(argv = [], io = {}) {
  const ctx = resolveIo(io)
  const [command, ...rest] = argv
  if (command === 'help' || command === '--help' || command === '-h') {
    ctx.out(USAGE)
    return EXIT_CODES.OK
  }
  try {
    if (command === undefined) throw new UsageError('No command given.')
    if (!Object.hasOwn(COMMANDS, command)) throw new UsageError(`Unknown command: ${safeLine(command, 40)}`)
    return await HANDLERS[command](ctx, parseArgs(command, rest))
  } catch (error) {
    if (error instanceof UsageError) {
      ctx.err(`${error.message}\n\n${USAGE}`)
    } else if (error instanceof ConfigError) {
      ctx.err(`${safeLine(error.message)}\n`)
    } else if (error instanceof ApiClientError) {
      ctx.err(`Cannot complete the request: ${apiProblem(error)}. Check the API base and workspace id in the config.\n`)
    } else {
      ctx.err(`Unexpected error: ${safeLine(error?.message ?? error)}\n`)
    }
    return EXIT_CODES.USAGE
  }
}

// Main-guard: the only place that calls process.exit.
function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2)).then((code) => process.exit(code))
}
