// Generic routing rules (contracts/routing-rules.md). Pure: no DOM, no clock, no network, no mutation
// of the inputs, and no provider name or id anywhere in this module. A recommendation is computed only
// from what the user declared (fit per task, gating quotas, schedule) and the current quota state.
import { TASKS } from '../data/tasks.js'
import { compareByName } from '../providers/tiebreak.js'
import { RESET_DATE_KEY, getConsumedPct, getResetInfo } from '../utils.js'
import { BAND_CRIT, BAND_WARN, BUCKET_WIDTH, FIT_SCORE, MAX_ALTERNATIVES, RESET_NOTE_DAYS, ROUTING_RULESET_VERSION } from './constants.js'

const isReading = (v) => typeof v === 'number' && Number.isFinite(v)
const round = (n) => Math.round(n)

function penaltyFor(pressure) {
  if (pressure >= BAND_CRIT) return 2
  if (pressure >= BAND_WARN) return 1
  return 0
}

const bucketOf = (pressure) => Math.floor(pressure / BUCKET_WIDTH)

// Days to reset only count when the next reset is today or ahead; overdue, unset, invalid and none sort last.
function knownDays(candidate) {
  return candidate.resetState === 'countdown' || candidate.resetState === 'due' ? candidate.daysToReset : null
}

function compareReset(a, b) {
  const da = knownDays(a)
  const db = knownDays(b)
  if (da === null && db === null) return 0
  if (da === null) return 1
  if (db === null) return -1
  return da - db
}

// Criteria in order; each returns <0 when `a` ranks first. `name` ends with the provider id: total order.
const CRITERIA = [
  ['score', (a, b) => b.score - a.score],
  ['pressure_bucket', (a, b) => bucketOf(a.pressure) - bucketOf(b.pressure)],
  ['reset', compareReset],
  ['pressure', (a, b) => a.pressure - b.pressure],
  ['fit', (a, b) => FIT_SCORE[b.fit] - FIT_SCORE[a.fit]],
  ['name', (a, b) => compareByName({ id: a.providerId, name: a.name }, { id: b.providerId, name: b.name })],
]

function compareCandidates(a, b) {
  for (const [, compare] of CRITERIA) {
    const result = compare(a, b)
    if (result !== 0) return result
  }
  return 0
}

function firstDifference(a, b) {
  for (const [criterion, compare] of CRITERIA) if (compare(a, b) !== 0) return criterion
  return 'name'
}

function resetNote(candidate) {
  if (candidate.resetState === 'due') return ' Reset due today — your quota may have already refreshed.'
  if (candidate.resetState === 'overdue') return ' Reset overdue — consider logging the new reset date.'
  if (candidate.resetState === 'countdown' && candidate.daysToReset <= RESET_NOTE_DAYS) {
    return ` Resets in ${candidate.daysToReset}d — spend it now before quota refreshes.`
  }
  return ''
}

const FIT_WORD = { strong: 'Strong', acceptable: 'Acceptable', weak: 'Weak' }

function describeReset(candidate) {
  if (candidate.resetState === 'countdown') return `resets in ${candidate.daysToReset}d`
  if (candidate.resetState === 'due') return 'reset due today'
  if (candidate.resetState === 'overdue') return `reset overdue by ${Math.abs(candidate.daysToReset)}d`
  return null
}

function decisiveText(criterion, a, b) {
  switch (criterion) {
    case 'score':
      return `scores higher than ${b.name} (${a.score} vs ${b.score})`
    case 'pressure_bucket':
      return `same score but less loaded than ${b.name} (${round(a.pressure)}% vs ${round(b.pressure)}%)`
    case 'reset': {
      const da = knownDays(a)
      const db = knownDays(b)
      return db === null
        ? `same score and load; ${b.name} has no upcoming reset to spend before`
        : `same score and load; resets sooner than ${b.name} (${da}d vs ${db}d)`
    }
    case 'pressure':
      return `same score, bucket and reset; slightly less loaded than ${b.name} (${round(a.pressure)}% vs ${round(b.pressure)}%)`
    case 'fit':
      return `same score and load; better declared fit than ${b.name}`
    default:
      return `tie broken by name against ${b.name}`
  }
}

function publicResult(c) {
  return {
    providerId: c.providerId,
    name: c.name,
    fit: c.fit,
    score: c.score,
    pressure: c.pressure,
    gatingQuotaId: c.gatingQuotaId,
    daysToReset: c.daysToReset,
    resetState: c.resetState,
    role: `${FIT_WORD[c.fit]} fit, ${round(c.pressure)}% used`,
  }
}

function classify(provider, task, state, now) {
  const fit = provider.fits?.[task] && FIT_SCORE[provider.fits[task]] !== undefined ? provider.fits[task] : 'none'
  const base = { providerId: provider.id, name: provider.name }

  if (FIT_SCORE[fit] === 0) {
    const declared = provider.fits?.[task] === 'none'
    return { ...base, excluded: { cause: 'not_suitable', detail: declared ? 'Declared as not suitable for this task.' : 'Not set: treated as not suitable for this task.' } }
  }

  const providerState = state?.[provider.id] ?? {}
  const gating = (provider.quotas ?? []).filter((q) => !q.gates || q.gates.includes(task))
  const unread = gating.find((q) => !isReading(providerState[q.id]))
  if (unread) return { ...base, excluded: { cause: 'unread', detail: `No reading yet for ${unread.label}.` } }

  let pressure = 0
  let gatingQuotaId = null
  let blocking = null
  for (const quota of gating) {
    const consumed = getConsumedPct(quota, providerState[quota.id])
    if (consumed >= 100 && !blocking) blocking = quota
    if (gatingQuotaId === null || consumed > pressure) {
      pressure = consumed
      gatingQuotaId = quota.id
    }
  }

  const reset = getResetInfo(providerState[RESET_DATE_KEY] ?? null, provider.resetCycleDays, now)
  if (blocking) {
    return { ...base, resetState: reset.state, daysToReset: reset.daysRemaining, excluded: { cause: 'blocked', detail: `${blocking.label} is used up.` } }
  }

  const gatingQuota = gating.find((q) => q.id === gatingQuotaId) ?? null
  return {
    ...base,
    fit,
    pressure,
    gatingQuotaId,
    gatingLabel: gatingQuota ? gatingQuota.label : null,
    score: FIT_SCORE[fit] - penaltyFor(pressure),
    resetState: reset.state,
    daysToReset: reset.daysRemaining,
    nextResetDate: reset.nextResetDate,
  }
}

function noPrimaryReason(taskName, providers, classified) {
  if (providers.length === 0) return 'No provider declared: add one to get a recommendation.'
  const blocked = classified.filter((c) => c.excluded?.cause === 'blocked')
  const unread = classified.filter((c) => c.excluded?.cause === 'unread')
  if (blocked.length === 0 && unread.length === 0) {
    return `No provider is suited to "${taskName}": declare a fit for it on at least one provider.`
  }
  let reason = `Every provider suited to "${taskName}" is blocked or has no reading yet.`
  const waiting = blocked
    .filter((c) => c.resetState === 'countdown' || c.resetState === 'due')
    .sort((a, b) => a.daysToReset - b.daysToReset || compareByName({ id: a.providerId, name: a.name }, { id: b.providerId, name: b.name }))
  if (waiting.length > 0) {
    const soonest = waiting[0]
    reason += ` Soonest reset: ${soonest.name} ${soonest.daysToReset === 0 ? 'today' : `in ${soonest.daysToReset}d`}.`
  }
  return reason
}

/**
 * recommend({ task, providers, state, now }) -> Recommendation (see contracts/routing-rules.md).
 * `providers` are runtime services; `state` is quota state by provider and quota id; `now` is the one
 * Date the dashboard shares with the surplus evaluation (FR-038).
 */
export function recommend({ task, providers, state, now }) {
  const list = Array.isArray(providers) ? providers : []
  const taskName = TASKS.find((t) => t.id === task)?.name ?? String(task)
  const classified = list.map((p) => classify(p, task, state, now))
  const eligible = classified.filter((c) => !c.excluded).sort(compareCandidates)
  const excluded = classified
    .filter((c) => c.excluded)
    .map((c) => ({ providerId: c.providerId, name: c.name, cause: c.excluded.cause, detail: c.excluded.detail }))
    .sort((a, b) => compareByName({ id: a.providerId, name: a.name }, { id: b.providerId, name: b.name }))

  const base = { rulesetVersion: ROUTING_RULESET_VERSION, taskId: task, excluded }
  if (eligible.length === 0) {
    return { ...base, primary: null, alternatives: [], reason: noPrimaryReason(taskName, list, classified), tieBreak: null }
  }

  const [primary, runnerUp] = eligible
  const tieBreak = runnerUp ? { criterion: firstDifference(primary, runnerUp), between: [primary.providerId, runnerUp.providerId] } : null

  const facts = [`${primary.name}: ${FIT_WORD[primary.fit].toLowerCase()} fit for "${taskName}"`]
  if (primary.gatingLabel) facts.push(`${primary.gatingLabel} at ${round(primary.pressure)}% consumed`)
  const resetText = describeReset(primary)
  if (resetText) facts.push(resetText)
  let reason = `${facts.join(', ')}.`
  reason += runnerUp ? ` Chosen because ${decisiveText(tieBreak.criterion, primary, runnerUp)}.` : ' Only provider currently available for this task.'
  reason += resetNote(primary)
  if (excluded.length > 0) {
    reason += ` Not used: ${excluded.map((e) => `${e.name} (${e.cause === 'not_suitable' ? 'not suitable' : e.cause === 'blocked' ? 'blocked' : 'no reading'})`).join(', ')}.`
  }

  return {
    ...base,
    primary: publicResult(primary),
    alternatives: eligible.slice(1, 1 + MAX_ALTERNATIVES).map(publicResult),
    reason,
    tieBreak,
  }
}
