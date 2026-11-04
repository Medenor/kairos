// Pure surplus evaluation (contracts/evaluation.md): which service has quota that would expire
// unused, and which waiting idea to suggest for it. Importable by the browser and by the runner.
// No clock (callers inject `now`), no browser or Node-only globals, no mutation of the inputs.
import { DEFAULTS, PRIORITY, RULESET_VERSION, STATUS } from './constants.js'
import { resolveFolder } from './paths.js'
import { isInProtectedHours, nextProtectedStart, resetDayStart } from './time.js'
import { RESET_DATE_KEY, getConsumedPct, getResetInfo, quotaTimeKey } from '../utils.js'

const HOUR_MS = 3600000
const MINUTE_MS = 60000
const CLOCK_SKEW_TOLERANCE_MS = 5 * MINUTE_MS
const MODES = ['preview', 'suggest', 'auto'] // 'suggest' is an alias of 'preview'
const PRIORITY_RANK = { [PRIORITY.HIGH]: 0, [PRIORITY.NORMAL]: 1, [PRIORITY.LOW]: 2 }

const pad = (n) => String(n).padStart(2, '0')
const localStamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
const num = (n) => String(Math.round(n * 10) / 10)
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function threshold(policy, key, fallback) {
  const v = policy?.thresholds?.[key]
  return isNumber(v) && v > 0 ? v : fallback
}

// Remaining percentage of a quota, normalised with the shared consumed-percentage helper.
function remainingPct(quota, value) {
  if (!quota || !isNumber(value)) return null
  return Math.min(100, Math.max(0, 100 - getConsumedPct(quota, value)))
}

// Hours since a stamp, or null when the stamp is absent or unparseable.
function ageHours(stamp, now) {
  if (typeof stamp !== 'string' || stamp === '') return null
  const t = Date.parse(stamp)
  return Number.isFinite(t) ? (now.getTime() - t) / HOUR_MS : null
}

// A reading is fresh when it is no older than `limitHours`; a stamp clearly in the future is not trusted.
function isFresh(age, limitHours) {
  return age !== null && age >= -CLOCK_SKEW_TOLERANCE_MS / HOUR_MS && age <= limitHours
}

function readingProblem(label, age, limitHours) {
  if (age === null) return `${label} reading never confirmed; confirm the values`
  if (age < 0) return `${label} reading is dated in the future; confirm the values`
  return `${label} reading older than ${num(limitHours)} h (confirmed ${num(age)} h ago); confirm the values`
}

function resetProblem(info, windowDays) {
  switch (info.state) {
    case 'unset': return 'reset date not set'
    case 'invalid': return info.label === 'Reset date cannot be in the future' ? 'last reset date is in the future' : 'reset date invalid'
    case 'due': return 'reset due today'
    case 'overdue': return `reset overdue by ${Math.abs(info.daysRemaining)}d`
    case 'countdown': return `reset in ${info.daysRemaining}d, beyond the ${windowDays}d window`
    default: return 'no scheduled reset'
  }
}

function resetOf(svc, serviceState, now) {
  return getResetInfo(serviceState?.[RESET_DATE_KEY] ?? null, svc.resetCycleDays, now)
}

// Resolved folder of an idea: the runner's check first, else a lexical resolution against the base folder.
// An idea without a working folder gives null: it runs in its own scratch directory and never conflicts on a folder.
function resolvedFolderOf(idea, folderChecks, policy) {
  const fromCheck = folderChecks?.[idea.id]?.resolvedFolder
  if (typeof fromCheck === 'string' && fromCheck !== '') return fromCheck
  if (typeof idea.workingFolder !== 'string' || idea.workingFolder.trim() === '') return null
  const resolved = resolveFolder(idea.workingFolder, policy?.projectsBaseFolder ?? null)
  return typeof resolved === 'string' ? resolved : null
}

// Folders currently in use by a running run, or by a running idea.
function runningFolders(ideas, runs, folderChecks, policy) {
  const folders = new Set()
  for (const run of runs) {
    const folder = run?.status === 'running' ? run.ideaSnapshot?.resolvedFolder : null
    if (typeof folder === 'string' && folder !== '') folders.add(folder)
  }
  for (const idea of ideas) {
    if (idea?.status !== STATUS.RUNNING) continue
    const linked = runs.find((r) => r?.id === idea.lastRunId)?.ideaSnapshot?.resolvedFolder
    const folder = typeof linked === 'string' && linked !== '' ? linked : resolvedFolderOf(idea, folderChecks, policy)
    if (folder) folders.add(folder)
  }
  return folders
}

function costOf(policy, size) {
  const c = policy?.costPct?.[size]
  return isNumber(c) && c > 0 ? c : null
}

// Waiting ideas that may be run for this service in this cycle, plus the ones skipped with a reason.
function classifyIdeas({ ideas, runs, folderChecks, policy, mode, cycleKey, busyFolders }) {
  const usable = []
  const skipped = []
  let waiting = 0
  for (const idea of ideas) {
    if (!idea || idea.status !== STATUS.WAITING) continue
    waiting += 1
    const check = folderChecks?.[idea.id]
    if (check && check.ok === false) {
      const code = typeof check.code === 'string' && check.code !== '' ? check.code : 'folder_check_failed'
      skipped.push({ ideaId: idea.id, reason: code, detail: 'the working folder check failed' })
      continue
    }
    if (mode === 'auto' && !check) {
      skipped.push({ ideaId: idea.id, reason: 'folder_not_checked', detail: 'the working folder was not checked' })
      continue
    }
    if (cycleKey && runs.some((r) => r?.ideaId === idea.id && r.mode === 'auto' && r.cycleKey === cycleKey && (r.status === 'failed' || r.status === 'interrupted'))) {
      skipped.push({ ideaId: idea.id, reason: 'retry_used', detail: 'an automatic run already failed or was interrupted in this reset cycle' })
      continue
    }
    const folder = resolvedFolderOf(idea, folderChecks, policy)
    if (folder && busyFolders.has(folder)) {
      skipped.push({ ideaId: idea.id, reason: 'running_elsewhere', detail: 'another run is using this folder' })
      continue
    }
    const costPct = costOf(policy, idea.size)
    if (costPct === null) {
      skipped.push({ ideaId: idea.id, reason: 'size_invalid', detail: 'the idea size has no cost estimate' })
      continue
    }
    usable.push({ idea, costPct })
  }
  return { usable, skipped, waiting }
}

const byPreference = (a, b) =>
  (PRIORITY_RANK[a.idea.priority] ?? PRIORITY_RANK[PRIORITY.NORMAL]) - (PRIORITY_RANK[b.idea.priority] ?? PRIORITY_RANK[PRIORITY.NORMAL]) ||
  b.costPct - a.costPct ||
  (Date.parse(a.idea.createdAt) || Infinity) - (Date.parse(b.idea.createdAt) || Infinity) ||
  cmp(String(a.idea.id), String(b.idea.id))

function summariseSkips(skipped) {
  const counts = new Map()
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1)
  return [...counts].map(([reason, n]) => `${reason}: ${n}`).join(', ')
}

function evaluateService({ svc, state, policy, ideas, runs, folderChecks, mode, now }) {
  const sp = policy?.services?.[svc.id]
  const serviceState = state?.[svc.id]
  const weeklyQuota = svc.quotas.find((q) => q.id === svc.surplus.weeklyQuotaId)
  const sessionQuota = svc.quotas.find((q) => q.id === svc.surplus.sessionQuotaId)

  const reservePct = isNumber(sp?.reservePct) ? sp.reservePct : DEFAULTS.RESERVE_PCT
  const windowDays = Number.isInteger(sp?.windowDays) ? sp.windowDays : DEFAULTS.WINDOW_DAYS
  const freshnessHours = threshold(policy, 'freshnessHours', DEFAULTS.FRESHNESS_HOURS)
  const sessionMaxAgeHours = threshold(policy, 'sessionMaxAgeHours', DEFAULTS.SESSION_MAX_AGE_HOURS)
  const sessionMinRoomPct = threshold(policy, 'sessionMinRoomPct', DEFAULTS.SESSION_MIN_ROOM_PCT)
  const maxRunMinutes = threshold(policy, 'maxRunMinutes', DEFAULTS.MAX_RUN_MINUTES)

  const reset = resetOf(svc, serviceState, now)
  const weeklyRemainingPct = remainingPct(weeklyQuota, serviceState?.[weeklyQuota?.id])
  const sessionRemainingPct = remainingPct(sessionQuota, serviceState?.[sessionQuota?.id])
  const weeklyAge = ageHours(serviceState?.[quotaTimeKey(svc.surplus.weeklyQuotaId)], now)
  const sessionAge = ageHours(serviceState?.[quotaTimeKey(svc.surplus.sessionQuotaId)], now)

  const inputs = {
    daysToReset: reset.daysRemaining,
    nextResetDate: reset.nextResetDate,
    resetState: reset.state,
    weeklyRemainingPct,
    sessionRemainingPct,
    weeklyAgeHours: weeklyAge,
    sessionAgeHours: sessionAge,
    reservePct,
    windowDays,
    freshnessHours,
    sessionMaxAgeHours,
    sessionMinRoomPct,
    maxRunMinutes,
  }

  const cycleKey = reset.nextResetDate ? `${svc.id}:${reset.nextResetDate}` : null
  const pool = classifyIdeas({
    ideas, runs, folderChecks, policy, mode, cycleKey, busyFolders: runningFolders(ideas, runs, folderChecks, policy),
  })

  // R4 is judged on the ideas that can run; with none, on the smallest class so the rule still informs.
  const fitting = weeklyRemainingPct === null ? [] : pool.usable.filter((u) => weeklyRemainingPct >= reservePct + u.costPct)
  const smallestCost = costOf(policy, 'small') ?? DEFAULTS.COST_SMALL_PCT

  const rules = []

  rules.push({
    id: 'R1',
    pass: sp?.surplusEnabled === true,
    detail: sp?.surplusEnabled === true ? 'surplus is on for this service' : 'surplus is off for this service',
  })

  const r2 = reset.state === 'countdown' && reset.daysRemaining >= 1 && reset.daysRemaining <= windowDays
  rules.push({
    id: 'R2',
    pass: r2,
    detail: r2 ? `reset in ${reset.daysRemaining}d (${reset.nextResetDate}), inside the ${windowDays}d window` : resetProblem(reset, windowDays),
  })

  const r3 = isFresh(weeklyAge, freshnessHours)
  rules.push({
    id: 'R3',
    pass: r3,
    detail: r3 ? `weekly reading confirmed ${num(weeklyAge)} h ago (limit ${num(freshnessHours)} h)` : readingProblem('weekly', weeklyAge, freshnessHours),
  })

  let r4
  let r4Detail
  if (weeklyRemainingPct === null) {
    r4 = false
    r4Detail = 'weekly quota value unknown'
  } else if (pool.usable.length > 0) {
    r4 = fitting.length > 0
    const smallest = Math.min(...pool.usable.map((u) => u.costPct))
    r4Detail = r4
      ? `${num(weeklyRemainingPct)}% remaining covers reserve ${num(reservePct)}% plus the smallest cost ${num(smallest)}% (${fitting.length} idea(s) fit)`
      : `${num(weeklyRemainingPct)}% remaining is below reserve ${num(reservePct)}% plus the smallest cost ${num(smallest)}% (needs ${num(reservePct + smallest)}%)`
  } else {
    r4 = weeklyRemainingPct >= reservePct + smallestCost
    r4Detail = `${num(weeklyRemainingPct)}% remaining, reserve ${num(reservePct)}%, smallest cost ${num(smallestCost)}% (no idea to size against)`
  }
  rules.push({ id: 'R4', pass: r4, detail: r4Detail })

  const sessionFresh = isFresh(sessionAge, sessionMaxAgeHours)
  const sessionRoomy = sessionRemainingPct !== null && sessionRemainingPct >= sessionMinRoomPct
  const r5 = sessionFresh && sessionRoomy
  const r5Problems = []
  if (!sessionFresh) r5Problems.push(readingProblem('session', sessionAge, sessionMaxAgeHours))
  if (!sessionRoomy) {
    r5Problems.push(sessionRemainingPct === null
      ? 'session quota value unknown'
      : `session room ${num(sessionRemainingPct)}% is below the ${num(sessionMinRoomPct)}% minimum`)
  }
  rules.push({
    id: 'R5',
    pass: r5,
    detail: r5
      ? `session reading confirmed ${num(sessionAge)} h ago, ${num(sessionRemainingPct)}% remaining (minimum ${num(sessionMinRoomPct)}%)`
      : r5Problems.join('; '),
  })

  const end = new Date(now.getTime() + maxRunMinutes * MINUTE_MS)
  const protectedHours = policy?.protectedHours ?? []
  const protectedStart = nextProtectedStart(protectedHours, now)
  const resetStart = resetDayStart(reset.nextResetDate)
  const r6Problems = []
  if (isInProtectedHours(protectedHours, now)) r6Problems.push('inside protected hours now')
  else if (protectedStart && end >= protectedStart) r6Problems.push(`a ${num(maxRunMinutes)} min run would reach protected hours at ${localStamp(protectedStart)}`)
  if (resetStart && resetStart <= now) r6Problems.push(`the reset day (${localStamp(resetStart)}) has already started: update the reset date`)
  else if (resetStart && end >= resetStart) r6Problems.push(`a ${num(maxRunMinutes)} min run would reach the reset day (${localStamp(resetStart)})`)
  const r6 = r6Problems.length === 0
  rules.push({
    id: 'R6',
    pass: r6,
    detail: r6
      ? `a ${num(maxRunMinutes)} min run ends ${localStamp(end)}, before protected hours and the reset day`
      : r6Problems.join('; '),
  })

  const r7 = pool.usable.length > 0
  let r7Detail
  if (r7) r7Detail = `${pool.usable.length} waiting idea(s) usable`
  else if (pool.waiting === 0) r7Detail = 'no waiting idea'
  else r7Detail = `no waiting idea usable (${summariseSkips(pool.skipped)})`
  rules.push({ id: 'R7', pass: r7, detail: r7Detail })

  const eligible = rules.every((r) => r.pass)

  // Ideas that fit are ranked; ideas that do not fit are reported as skipped.
  const skipped = [...pool.skipped]
  for (const u of pool.usable) {
    if (!fitting.includes(u)) {
      skipped.push({
        ideaId: u.idea.id,
        reason: 'insufficient_weekly_room',
        detail: weeklyRemainingPct === null
          ? 'weekly quota value unknown'
          : `needs ${num(reservePct + u.costPct)}% (reserve ${num(reservePct)}% + cost ${num(u.costPct)}%), ${num(weeklyRemainingPct)}% remaining`,
      })
    }
  }

  let candidate = null
  if (eligible) {
    const best = [...fitting].sort(byPreference)[0]
    const room = weeklyRemainingPct - reservePct
    candidate = {
      ideaId: best.idea.id,
      size: best.idea.size,
      costPct: best.costPct,
      reason: `${weeklyRemainingPct}% remaining minus ${reservePct}% reserve minus ${best.costPct}% cost leaves ${num(room - best.costPct)}%; ` +
        `priority ${best.idea.priority}, size ${best.idea.size}`,
    }
  }

  let reason
  if (eligible) {
    reason = `${svc.name}: ${num(weeklyRemainingPct)}% remaining minus ${num(reservePct)}% reserve minus ${num(candidate.costPct)}% cost leaves ` +
      `${num(weeklyRemainingPct - reservePct - candidate.costPct)}%; resets in ${reset.daysRemaining}d; all rules pass`
  } else {
    const failing = rules.filter((r) => !r.pass).map((r) => `${r.id} ${r.detail}`)
    reason = `${svc.name} not eligible: ${failing.join('; ')}`
  }

  return { serviceId: svc.id, eligible, inputs, rules, candidate, skipped, reason }
}

/**
 * Evaluate surplus for every service with a `surplus` block. Pure and deterministic: the same input
 * gives a deep-equal result (SC-002), and the result is stored verbatim as Run.decisionInputs.
 * `mode` is 'preview' (alias 'suggest', the browser) or 'auto' (the runner: a missing folder check
 * fails closed). The runner's other guardrails (approvals, lease, control record) live outside.
 */
export function evaluateSurplus({ now, state, services, policy, ideas, runs, folderChecks, mode = 'preview' }) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('now must be a valid Date')
  if (!MODES.includes(mode)) throw new TypeError(`mode must be one of ${MODES.join(', ')}`)
  const ideaList = Array.isArray(ideas) ? ideas : []
  const runList = Array.isArray(runs) ? runs : []
  const supported = (Array.isArray(services) ? services : []).filter((s) => s?.surplus)

  const results = supported.map((svc) =>
    evaluateService({ svc, state, policy, ideas: ideaList, runs: runList, folderChecks: folderChecks ?? null, mode, now }))

  const order = new Map(supported.map((s, i) => [s.id, i]))
  const ranked = results
    .filter((r) => r.eligible)
    .sort((a, b) => a.inputs.daysToReset - b.inputs.daysToReset || order.get(a.serviceId) - order.get(b.serviceId))

  let selected = null
  let reason
  if (ranked.length > 0) {
    const first = ranked[0]
    selected = { serviceId: first.serviceId, ideaId: first.candidate.ideaId, alternatives: ranked.slice(1).map((r) => r.serviceId) }
    reason = `${first.reason}; suggested idea ${first.candidate.ideaId} (${first.candidate.size}, priority ${ideaList.find((i) => i.id === first.candidate.ideaId)?.priority ?? 'normal'})`
    if (selected.alternatives.length > 0) reason += `; alternatives: ${selected.alternatives.join(', ')}`
  } else if (results.length === 0) {
    reason = 'No suggestion: no service supports surplus runs'
  } else {
    reason = `No suggestion. ${results.map((r) => r.reason).join('. ')}`
  }

  return { rulesetVersion: RULESET_VERSION, evaluatedAt: now.toISOString(), services: results, selected, reason }
}
