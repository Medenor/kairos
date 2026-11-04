// Shared helpers for the loop tests (T045 to T047): a manual clock and scheduler, an event recorder, and a "world"
// that wires the fake shared-state API, fake claude/codex tools, temporary folders under <repo>/.test-tmp,
// approvals, lease and a ready-to-use loop. Test-only: nothing here is imported by production code.

import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SERVICES } from '../src/data/services.js'
import { classifyFolder, resolveFolder } from '../src/surplus/paths.js'
import { defaultPolicy } from '../src/surplus/policy.js'
import { createIdea } from '../src/surplus/ideas.js'
import { cycleRecordKey, ideaKey, keyForControl, keyForPolicy, runKey } from '../src/surplus/records.js'
import { quotaTimeKey, RESET_DATE_KEY } from '../src/utils.js'
import { createApiClient } from './api-client.js'
import { approve } from './approvals.js'
import { defaultConfig, runnerPaths, validateConfig } from './config.js'
import { start as startApi } from './fixtures/fake-api.js'
import { writeFakeCli } from './fixtures/fake-cli.js'
import { readJournal } from './journal.js'
import { createLease } from './lease.js'
import { createLoop } from './loop.js'

export const REPO_TMP = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-tmp')

/** Local time on 2026-11-03 plus `dayOffset` days (the reset date logic works in local days). */
export const localAt = (hours, minutes = 0, dayOffset = 0) => new Date(2026, 10, 3 + dayOffset, hours, minutes)

export const claudeResult = (text) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text })

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Poll `predicate` in real time (short) until it is truthy. */
export async function until(predicate, { timeoutMs = 15000, label = 'condition' } = {}) {
  const startedAt = Date.now()
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() - startedAt > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await delay(10)
  }
}

/** Manual clock plus a setTimeout-style scheduler: time only moves when the test calls advance(). */
export function makeClock(start = localAt(14, 0)) {
  let t = start.getTime()
  let seq = 0
  let timers = []
  const clock = {
    now: () => new Date(t),
    set: (date) => {
      t = date.getTime()
    },
    scheduler: {
      setTimeout(fn, ms) {
        seq += 1
        timers.push({ id: seq, at: t + Math.max(0, ms), fn })
        return seq
      },
      clearTimeout(id) {
        timers = timers.filter((timer) => timer.id !== id)
      },
    },
    /** Pending timers as the delay (ms) left before each fires, ascending. */
    pendingDelays: () => timers.map((timer) => timer.at - t).sort((a, b) => a - b),
    async advance(ms) {
      const target = t + ms
      for (;;) {
        const due = timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0]
        if (!due) break
        timers = timers.filter((timer) => timer !== due)
        t = Math.max(t, due.at)
        due.fn()
        await new Promise((resolve) => setImmediate(resolve))
      }
      t = target
    },
  }
  return clock
}

export function makeEvents() {
  const list = []
  let waiters = []
  const matching = (type) => list.filter((event) => event.type === type)
  return {
    list,
    onEvent(event) {
      list.push(event)
      waiters = waiters.filter((waiter) => {
        if (matching(waiter.type).length < waiter.count) return true
        waiter.resolve(matching(waiter.type)[waiter.count - 1])
        return false
      })
    },
    of: matching,
    waitFor(type, count = 1, timeoutMs = 15000) {
      return new Promise((resolve, reject) => {
        if (matching(type).length >= count) return resolve(matching(type)[count - 1])
        const timer = setTimeout(() => reject(new Error(`timed out waiting for event ${type} x${count}`)), timeoutMs)
        waiters.push({ type, count, resolve: (event) => { clearTimeout(timer); resolve(event) } })
        return undefined
      })
    },
  }
}

/** quota_state seeds for one service: values are given as remaining percentages. */
export function quotaSeeds(serviceId, { weeklyRemaining = 60, sessionRemaining = 80, weeklyAgeHours = 1, sessionAgeHours = 1, lastReset = '2026-10-28' } = {}, at) {
  const svc = SERVICES.find((s) => s.id === serviceId)
  const stored = (quotaId, remaining) => {
    const quota = svc.quotas.find((q) => q.id === quotaId)
    return quota.type === 'consumed_pct' ? 100 - remaining : remaining
  }
  const stamp = (hours) => new Date(at.getTime() - hours * 3600000).toISOString()
  const { weeklyQuotaId, sessionQuotaId } = svc.surplus
  return [
    [`${serviceId}:${weeklyQuotaId}`, stored(weeklyQuotaId, weeklyRemaining)],
    [`${serviceId}:${sessionQuotaId}`, stored(sessionQuotaId, sessionRemaining)],
    [`${serviceId}:${quotaTimeKey(weeklyQuotaId)}`, stamp(weeklyAgeHours)],
    [`${serviceId}:${quotaTimeKey(sessionQuotaId)}`, stamp(sessionAgeHours)],
    [`${serviceId}:${RESET_DATE_KEY}`, lastReset],
  ]
}

export function makePolicy(serviceId, at) {
  const policy = defaultPolicy()
  policy.services[serviceId] = { ...policy.services[serviceId], surplusEnabled: true, autoRunEnabled: true, disclosuresAckAt: at.toISOString() }
  policy.protectedHours = [{ days: [0, 1, 2, 3, 4, 5, 6], start: '23:00', end: '06:00' }]
  return policy
}

/** An executable that prints `partial` then waits (a tool that is still working). */
export function writeHangingTool(dir, name, partial = 'partial draft') {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\nprintf '%s' '${partial}'\nexec sleep 3600\n`)
  chmodSync(path, 0o755)
  return path
}

const HELP = {
  claude: '--print --output-format --permission-mode --allowedTools',
  codex: '--sandbox --cd --ask-for-approval --skip-git-repo-check',
}

/**
 * world options: serviceId ('claude'), start (Date), quota, policy ((policy) => void), control (true | false | null),
 * seedPolicy (true), ideas ([{id, text, context, folder, workingFolder, makeFolder, size, priority, approved}]),
 * cli ({claude, codex} fake behaviours), configPatch, env, stopFile (false), realPreflight (false).
 */
export async function makeWorld(options = {}) {
  const {
    serviceId = 'claude', start = localAt(14, 0), quota = {}, policy: tweakPolicy, control = true, seedPolicy = true,
    ideas = [{}], cli = {}, configPatch = {}, env: extraEnv = {}, stopFile = false, realPreflight = false,
  } = options
  mkdirSync(REPO_TMP, { recursive: true })
  const dir = mkdtempSync(join(REPO_TMP, 'loop-'))
  const baseDir = join(dir, 'runner')
  const projectsDir = join(dir, 'projects')
  const homeDir = join(dir, 'home')
  const binDir = join(dir, 'bin')
  for (const d of [baseDir, projectsDir, homeDir]) mkdirSync(d, { recursive: true })

  const fakeApi = await startApi()
  const client = createApiClient({ apiBase: fakeApi.url, workspaceId: fakeApi.workspaceId, timeoutMs: 3000 })
  const clock = makeClock(start)
  const events = makeEvents()
  const tools = {
    claude: writeFakeCli(binDir, 'claude', { helpText: HELP.claude, stdout: claudeResult('Draft result'), ...cli.claude }),
    codex: writeFakeCli(binDir, 'codex', { helpText: HELP.codex, stdout: 'Draft result\n', ...cli.codex }),
  }

  const rawConfig = {
    ...defaultConfig({ deviceId: 'dev-a', deviceName: 'Laptop' }),
    workspaceId: fakeApi.workspaceId,
    apiBase: fakeApi.url,
    projectsBaseFolder: projectsDir,
    allowServices: [serviceId],
    tools: { claude: tools.claude.path, codex: tools.codex.path },
    ...configPatch,
  }
  const validated = validateConfig(rawConfig)
  if (!validated.valid) throw new Error(`test config invalid: ${JSON.stringify(validated.errors)}`)
  const config = validated.config

  let runCounter = 0
  const loops = []
  const world = {
    dir, baseDir, projectsDir, homeDir, binDir, fakeApi, client, clock, events, config, tools, serviceId,
    paths: runnerPaths(baseDir),
    cli: tools,
    approveIdea: async (idea) => {
      // no working folder: approved for the empty scratch directory (resolvedFolder null)
      const resolved = classifyFolder(idea.workingFolder) === 'empty' ? null : resolveFolder(idea.workingFolder, config.projectsBaseFolder, homeDir)
      await approve(idea, resolved, { baseDir, now: clock.now().toISOString(), exclusions: config.exclusions, prompter: { write() {}, ask: async () => 'yes', close() {} } })
    },
    async addIdea(spec = {}, index = 0) {
      const id = spec.id ?? 'idea-a'
      const folder = spec.folder ?? 'proj-a'
      const workingFolder = spec.workingFolder !== undefined ? spec.workingFolder : folder
      if (spec.makeFolder !== false && spec.workingFolder === undefined) {
        mkdirSync(join(projectsDir, folder), { recursive: true })
        writeFileSync(join(projectsDir, folder, 'README.md'), 'hello\n')
      }
      const made = createIdea({
        id, text: spec.text ?? `Draft the notes for ${id}`, context: spec.context ?? 'Keep it short', workingFolder,
        size: spec.size ?? 'medium', priority: spec.priority ?? 'normal', now: new Date(start.getTime() - (100 - index) * 60000),
      })
      if (!made.ok) throw new Error(`idea invalid: ${JSON.stringify(made.error)}`)
      const idea = { ...made.idea, ...(spec.status ? { status: spec.status } : {}) }
      fakeApi.seed(ideaKey(id), idea)
      if (spec.approved !== false) await world.approveIdea(idea)
      return idea
    },
    putRouting: (logicalKey, payload) => fakeApi.put(logicalKey, payload),
    setControl: (enabled) => fakeApi.put(keyForControl(), { autoRunEnabled: enabled, updatedAt: clock.now().toISOString() }),
    setPolicy(tweak) {
      const policy = makePolicy(serviceId, start)
      tweak?.(policy)
      return fakeApi.put(keyForPolicy(), policy)
    },
    async setQuota(logicalKey, value) {
      const { items } = await client.listRecords()
      const existing = items.find((r) => r.record_type === 'quota_state' && r.logical_key === logicalKey)
      if (existing) return client.updateRecord(existing.id, { expectedVersion: existing.version, payload: { value } })
      return client.createRecord({ logicalKey, payload: { value }, recordType: 'quota_state' })
    },
    /** Put the weekly remaining percentage of the world's service, as the browser would after the user edits it. */
    setWeeklyRemaining(remaining) {
      const svc = SERVICES.find((s) => s.id === serviceId)
      const quota0 = svc.quotas.find((q) => q.id === svc.surplus.weeklyQuotaId)
      return world.setQuota(`${serviceId}:${quota0.id}`, quota0.type === 'consumed_pct' ? 100 - remaining : remaining)
    },
    makeLease: (cfg = config) => createLease({ config: cfg, api: client, now: clock.now }),
    makeLoop(overrides = {}) {
      const { deps = {}, config: cfgOverride, ...rest } = overrides
      const loop = createLoop({
        config: cfgOverride ?? config,
        baseDir,
        api: client,
        lease: rest.lease ?? world.makeLease(cfgOverride ?? config),
        now: clock.now,
        scheduler: clock.scheduler,
        env: { PATH: process.env.PATH, HOME: homeDir, ...extraEnv },
        homeDir,
        newId: () => `run-${(runCounter += 1)}`,
        onEvent: events.onEvent,
        deps: { ...(realPreflight ? {} : { preflight: async () => ({ ok: true }) }), ...deps },
        ...rest,
      })
      loops.push(loop)
      return loop
    },
    records: (prefix) => [...fakeApi.records.values()].filter((r) => !r.deleted_at && r.logical_key.startsWith(prefix)),
    runs: () => [...fakeApi.records.values()].filter((r) => !r.deleted_at && r.logical_key.startsWith('run:')).map((r) => r.payload),
    run: (id) => fakeApi.find(runKey(id))?.payload ?? null,
    idea: (id = 'idea-a') => fakeApi.find(ideaKey(id)),
    cycle: (resetDate) => fakeApi.find(cycleRecordKey(serviceId, resetDate)),
    journal: () => readJournal(baseDir),
    skips: () => readJournal(baseDir).filter((e) => e.type === 'evaluation-skipped'),
    putsTo(logicalKey) {
      const record = fakeApi.find(logicalKey)
      return record ? fakeApi.requests.filter((r) => r.method === 'PUT' && r.path.endsWith(`/${record.id}`)) : []
    },
    postsTo: (logicalKey) => fakeApi.requests.filter((r) => r.method === 'POST' && r.body?.logical_key === logicalKey),
    waitForCli: (tool, count = 1) => until(() => tool.calls().length >= count, { label: 'the fake tool to start' }),
    async cleanup() {
      for (const loop of loops) await Promise.race([loop.stop().catch(() => {}), delay(1000)])
      for (const tool of Object.values(tools)) {
        for (const call of tool.calls()) {
          try {
            process.kill(call.pid, 'SIGKILL')
          } catch {
            // already gone
          }
        }
      }
      await fakeApi.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }

  for (const [key, value] of quotaSeeds(serviceId, quota, start)) fakeApi.seed(key, { value }, 'quota_state')
  if (seedPolicy) world.setPolicy(tweakPolicy)
  if (control !== null) world.setControl(control)
  for (const [index, spec] of ideas.entries()) await world.addIdea(spec, index)
  if (stopFile) writeFileSync(world.paths.stop, '')
  return world
}

/** Run `fn(world)` and always clean up. */
export async function withWorld(options, fn) {
  const world = await makeWorld(options)
  try {
    return await fn(world)
  } finally {
    await world.cleanup()
  }
}

export const stopFileExists = (world) => existsSync(world.paths.stop)
