// Surplus policy defaults and validation (pure; see data-model.md "Surplus Policy").
import { DEFAULTS } from './constants.js'
import { isProviderId } from '../providers/ids.js'

// 2 (feature 007): per-provider settings live in `providers`, keyed by provider id. A v1 policy keeps its
// global fields; its `services` object moves verbatim into the inert `legacy` field (never read).
export const POLICY_SCHEMA_VERSION = 2

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const THRESHOLD_KEYS = ['freshnessHours', 'sessionMaxAgeHours', 'sessionMinRoomPct', 'maxRunMinutes', 'evalIntervalMinutes']

// Default per-provider settings, created the first time a provider's surplus is configured: all off.
export function defaultProviderSurplus() {
  return {
    surplusEnabled: false,
    reservePct: DEFAULTS.RESERVE_PCT,
    windowDays: DEFAULTS.WINDOW_DAYS,
    autoRunEnabled: false,
    disclosuresAckAt: null,
  }
}

export function defaultPolicy() {
  return {
    schemaVersion: POLICY_SCHEMA_VERSION,
    providers: {},
    protectedHours: [],
    costPct: {
      small: DEFAULTS.COST_SMALL_PCT,
      medium: DEFAULTS.COST_MEDIUM_PCT,
      large: DEFAULTS.COST_LARGE_PCT,
    },
    thresholds: {
      freshnessHours: DEFAULTS.FRESHNESS_HOURS,
      sessionMaxAgeHours: DEFAULTS.SESSION_MAX_AGE_HOURS,
      sessionMinRoomPct: DEFAULTS.SESSION_MIN_ROOM_PCT,
      maxRunMinutes: DEFAULTS.MAX_RUN_MINUTES,
      evalIntervalMinutes: DEFAULTS.EVAL_INTERVAL_MINUTES,
    },
    projectsBaseFolder: null,
  }
}

/**
 * Reads a stored policy of any version as a v2 policy. A v1 policy keeps its global fields; its per-service
 * settings are neither applied nor lost: the `services` object is moved verbatim into `legacy`.
 */
export function migratePolicy(stored) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return defaultPolicy()
  if (stored.schemaVersion !== 1) return stored
  const base = defaultPolicy()
  const migrated = {
    ...base,
    protectedHours: stored.protectedHours,
    costPct: stored.costPct,
    thresholds: stored.thresholds,
    projectsBaseFolder: stored.projectsBaseFolder ?? null,
  }
  if (stored.services && typeof stored.services === 'object') migrated.legacy = stored.services
  return migrated
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isPositive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0
const isValidIso = (v) => typeof v === 'string' && v !== '' && !Number.isNaN(Date.parse(v))

function validateProtectedRange(range, path, errors) {
  if (!isObject(range)) {
    errors.push({ path, message: 'must be an object {days, start, end}' })
    return
  }
  const { days, start, end } = range
  if (
    !Array.isArray(days) || days.length === 0 ||
    !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) ||
    new Set(days).size !== days.length
  ) {
    errors.push({ path: `${path}.days`, message: 'must be a non-empty list of distinct integers 0 (Sunday) to 6 (Saturday)' })
  }
  if (typeof start !== 'string' || !TIME_RE.test(start)) errors.push({ path: `${path}.start`, message: 'must be "HH:MM" (00:00 to 23:59)' })
  if (typeof end !== 'string' || !TIME_RE.test(end)) errors.push({ path: `${path}.end`, message: 'must be "HH:MM" (00:00 to 23:59)' })
  if (TIME_RE.test(start) && TIME_RE.test(end) && start === end) {
    errors.push({ path: `${path}.end`, message: 'must differ from start' })
  }
}

function validateProviderEntry(id, svc, protectedHours, errors) {
  const p = `providers.${id}`
  if (!isObject(svc)) {
    errors.push({ path: p, message: 'must be an object' })
    return
  }
  if (typeof svc.surplusEnabled !== 'boolean') errors.push({ path: `${p}.surplusEnabled`, message: 'must be true or false' })
  if (typeof svc.reservePct !== 'number' || !Number.isFinite(svc.reservePct) || svc.reservePct < 0 || svc.reservePct > 90) {
    errors.push({ path: `${p}.reservePct`, message: 'must be a number from 0 to 90' })
  }
  if (!Number.isInteger(svc.windowDays) || svc.windowDays < 1 || svc.windowDays > 6) {
    errors.push({ path: `${p}.windowDays`, message: 'must be an integer from 1 to 6' })
  }
  if (typeof svc.autoRunEnabled !== 'boolean') errors.push({ path: `${p}.autoRunEnabled`, message: 'must be true or false' })
  if (svc.disclosuresAckAt !== null && !isValidIso(svc.disclosuresAckAt)) {
    errors.push({ path: `${p}.disclosuresAckAt`, message: 'must be an ISO date string or null' })
  }
  if (svc.autoRunEnabled === true) {
    if (!Array.isArray(protectedHours) || protectedHours.length === 0) {
      errors.push({ path: `${p}.autoRunEnabled`, message: 'declare protected hours before enabling automatic runs' })
    }
    if (!isValidIso(svc.disclosuresAckAt)) {
      errors.push({ path: `${p}.autoRunEnabled`, message: 'acknowledge the disclosures before enabling automatic runs' })
    }
  }
}

/**
 * Validate a policy object. Returns {ok, errors: [{path, message}]}; never throws.
 * Every field of the data model is required (use defaultPolicy() to fill a new one).
 */
export function validatePolicy(policy) {
  const errors = []
  if (!isObject(policy)) return { ok: false, errors: [{ path: '', message: 'policy must be an object' }] }

  if (policy.schemaVersion !== POLICY_SCHEMA_VERSION) {
    errors.push({ path: 'schemaVersion', message: `must be ${POLICY_SCHEMA_VERSION}` })
  }

  if (!Array.isArray(policy.protectedHours)) {
    errors.push({ path: 'protectedHours', message: 'must be a list' })
  } else {
    policy.protectedHours.forEach((r, i) => validateProtectedRange(r, `protectedHours[${i}]`, errors))
  }

  if (!isObject(policy.providers)) {
    errors.push({ path: 'providers', message: 'must be an object' })
  } else {
    for (const [id, entry] of Object.entries(policy.providers)) {
      if (!isProviderId(id)) {
        errors.push({ path: `providers.${id}`, message: 'key must be a provider id' })
        continue
      }
      validateProviderEntry(id, entry, policy.protectedHours, errors)
    }
  }

  if (policy.legacy !== undefined && !isObject(policy.legacy)) {
    errors.push({ path: 'legacy', message: 'must be an object when present' })
  }

  const c = policy.costPct
  if (!isObject(c)) {
    errors.push({ path: 'costPct', message: 'must be an object {small, medium, large}' })
  } else {
    for (const k of ['small', 'medium', 'large']) {
      if (!isPositive(c[k])) errors.push({ path: `costPct.${k}`, message: 'must be a positive number' })
    }
    if (isPositive(c.small) && isPositive(c.medium) && isPositive(c.large) && !(c.small <= c.medium && c.medium <= c.large)) {
      errors.push({ path: 'costPct', message: 'must satisfy small <= medium <= large' })
    }
  }

  const t = policy.thresholds
  if (!isObject(t)) {
    errors.push({ path: 'thresholds', message: 'must be an object' })
  } else {
    for (const k of THRESHOLD_KEYS) {
      if (!isPositive(t[k])) errors.push({ path: `thresholds.${k}`, message: 'must be a positive number' })
    }
  }

  const base = policy.projectsBaseFolder
  if (base !== undefined && base !== null && typeof base !== 'string') {
    errors.push({ path: 'projectsBaseFolder', message: 'must be a string or null' })
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Pure policy edit: turn surplus on or off for one provider. The entry is created with the defaults on
 * first use. Turning surplus off also turns its automatic runs off in the same update (an automatic run
 * without surplus has no meaning), so validatePolicy still passes. Returns a new policy; the input is not mutated.
 */
export function setProviderSurplus(policy, providerId, enabled) {
  if (!isProviderId(providerId)) return policy
  const current = policy?.providers?.[providerId] ?? defaultProviderSurplus()
  const next = enabled === true
    ? { ...current, surplusEnabled: true }
    : { ...current, surplusEnabled: false, autoRunEnabled: false }
  return { ...policy, providers: { ...policy.providers, [providerId]: next } }
}

/** Removes a provider's entry (at deletion). A duplicate gets none, so it starts with everything off. */
export function pruneProvider(policy, providerId) {
  if (!policy?.providers || !(providerId in policy.providers)) return policy
  const providers = { ...policy.providers }
  delete providers[providerId]
  return { ...policy, providers }
}

/**
 * Reasons the automatic-run toggle of one provider cannot be switched on ('' when nothing blocks it).
 * Only blocks switching on: a provider already running automatically can always be switched off.
 */
export function autoRunBlockedReason(policy, providerId, sharedMode) {
  const entry = policy?.providers?.[providerId]
  const reasons = []
  if (!entry || entry.surplusEnabled !== true) reasons.push('Turn on surplus use for this provider first.')
  if (!Array.isArray(policy?.protectedHours) || policy.protectedHours.length === 0) reasons.push('Declare protected hours below first.')
  if (!sharedMode) reasons.push('Shared mode is off: automatic runs need a workspace id so the runner can read your quota state.')
  return reasons.join(' ')
}

/**
 * Global switch display state from the control record: 'stopped' only when a stop was actually
 * issued (autoRunEnabled === false), 'on' when true, 'unset' when there is no record yet.
 */
export function globalSwitchState(control) {
  if (control && control.autoRunEnabled === false) return 'stopped'
  if (control && control.autoRunEnabled === true) return 'on'
  return 'unset'
}

/**
 * Whether enabling a service's automatic runs may also switch the global switch on. Only a switch
 * that was never set is armed this way: the runner treats a missing control record as a stop, so
 * without it the first enablement would do nothing. An explicit stop is never overridden as a side
 * effect of a per-service toggle; the user resumes with "Switch back on" (SC-007).
 */
export function shouldArmGlobalSwitch(switchState) {
  return switchState === 'unset'
}
