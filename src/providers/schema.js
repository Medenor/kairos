// Provider definition schema and validation (data-model.md, research D15). Pure: no clock, no
// storage, no mutation. Every rule lives here so the form, the reducers and the shared-record
// validator all enforce the same limits.
import { TASKS } from '../data/tasks.js'
import { normalizeName } from './tiebreak.js'

export const PROVIDER_SCHEMA_VERSION = 1
export const FIT_LEVELS = Object.freeze(['strong', 'acceptable', 'weak', 'none'])
export const QUOTA_TYPES = Object.freeze(['consumed_pct', 'remaining_pct', 'currency'])
export const SCHEDULE_TYPES = Object.freeze(['weekly', 'monthly', 'custom', 'none'])
export const CYCLE_DAYS = Object.freeze({ weekly: 7, monthly: 30 })

export const LIMITS = Object.freeze({
  NAME_MAX: 60,
  NOTE_MAX: 500,
  FLAGS_MAX: 8,
  FLAG_MAX: 30,
  QUOTAS_MAX: 8,
  LABEL_MAX: 40,
  SUBNOTE_MAX: 60,
  CURRENCY_MAX: 3,
  CUSTOM_CYCLE_MAX: 366,
})

const DEFAULT_TASK_IDS = Object.freeze(TASKS.map((task) => task.id))
const COLOR_RE = /^#[0-9a-fA-F]{6}$/

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const isString = (v) => typeof v === 'string'
const missing = (v) => v === undefined || v === null

/** Value check for one quota reading: finite numbers only, percentages 0 to 100, balances >= 0. */
export function validateQuotaValue(quota, value) {
  if (!isFiniteNumber(value)) return { ok: false, message: 'Enter a number.' }
  if (quota?.type === 'currency') {
    return value >= 0 ? { ok: true } : { ok: false, message: 'A balance cannot be negative.' }
  }
  return value >= 0 && value <= 100 ? { ok: true } : { ok: false, message: 'Enter a percentage from 0 to 100.' }
}

function validateCost(cost, errors) {
  if (missing(cost)) return
  if (!isObject(cost)) return errors.push({ path: 'cost', message: 'Cost must have an amount and a currency symbol.' })
  if (!isFiniteNumber(cost.amount) || cost.amount < 0) errors.push({ path: 'cost.amount', message: 'Cost cannot be negative.' })
  if (!isString(cost.currency) || cost.currency.length < 1 || cost.currency.length > LIMITS.CURRENCY_MAX) {
    errors.push({ path: 'cost.currency', message: `Currency symbol must be 1 to ${LIMITS.CURRENCY_MAX} characters.` })
  }
}

function validateSchedule(schedule, errors) {
  if (!isObject(schedule) || !SCHEDULE_TYPES.includes(schedule.type)) {
    return errors.push({ path: 'schedule', message: 'Choose weekly, monthly, custom or none.' })
  }
  const { type, cycleDays } = schedule
  if (type === 'custom') {
    if (!Number.isInteger(cycleDays) || cycleDays < 1 || cycleDays > LIMITS.CUSTOM_CYCLE_MAX) {
      errors.push({ path: 'schedule.cycleDays', message: `Cycle must be a whole number of days from 1 to ${LIMITS.CUSTOM_CYCLE_MAX}.` })
    }
  } else if (type === 'none') {
    if (!missing(cycleDays)) errors.push({ path: 'schedule.cycleDays', message: 'A provider without a schedule has no cycle length.' })
  } else if (!missing(cycleDays) && cycleDays !== CYCLE_DAYS[type]) {
    errors.push({ path: 'schedule.cycleDays', message: `A ${type} schedule is ${CYCLE_DAYS[type]} days.` })
  }
}

function validateQuota(quota, index, { taskIds, requireValues }, errors) {
  const p = `quotas[${index}]`
  if (!isObject(quota)) return errors.push({ path: p, message: 'Quota must be an object.' })
  const label = isString(quota.label) ? quota.label.trim() : ''
  if (label.length < 1 || label.length > LIMITS.LABEL_MAX) {
    errors.push({ path: `${p}.label`, message: `Label must be 1 to ${LIMITS.LABEL_MAX} characters.` })
  }
  if (!QUOTA_TYPES.includes(quota.type)) errors.push({ path: `${p}.type`, message: 'Choose consumed %, remaining % or currency balance.' })
  if (quota.type === 'currency') {
    if (!isString(quota.currency) || quota.currency.length < 1 || quota.currency.length > LIMITS.CURRENCY_MAX) {
      errors.push({ path: `${p}.currency`, message: `Currency symbol must be 1 to ${LIMITS.CURRENCY_MAX} characters.` })
    }
    if (!missing(quota.lowBalance) && (!isFiniteNumber(quota.lowBalance) || quota.lowBalance <= 0)) {
      errors.push({ path: `${p}.lowBalance`, message: 'Low-balance level must be greater than 0.' })
    }
  } else {
    if (!missing(quota.currency)) errors.push({ path: `${p}.currency`, message: 'Only a currency balance has a currency symbol.' })
    if (!missing(quota.lowBalance)) errors.push({ path: `${p}.lowBalance`, message: 'Only a currency balance has a low-balance level.' })
  }
  if (!missing(quota.gates)) {
    if (!Array.isArray(quota.gates) || quota.gates.length === 0 || !quota.gates.every((id) => taskIds.includes(id))) {
      errors.push({ path: `${p}.gates`, message: 'Choose at least one known task, or leave it for all tasks.' })
    }
  }
  if (!missing(quota.subnote) && (!isString(quota.subnote) || quota.subnote.length > LIMITS.SUBNOTE_MAX)) {
    errors.push({ path: `${p}.subnote`, message: `Note must be at most ${LIMITS.SUBNOTE_MAX} characters.` })
  }
  if (quota.value !== undefined || requireValues) {
    const checked = validateQuotaValue(quota, quota.value)
    if (!checked.ok) errors.push({ path: `${p}.value`, message: checked.message })
  }
}

/**
 * Validate a provider definition (stored shape, or form input where quotas may also carry a `value`).
 * options: { existingNames: names of the OTHER active providers, taskIds, requireValues }.
 * Returns { ok, errors: [{ path, message }] }.
 */
export function validateProvider(input, { existingNames = [], taskIds = DEFAULT_TASK_IDS, requireValues = false } = {}) {
  const errors = []
  if (!isObject(input)) return { ok: false, errors: [{ path: '', message: 'Provider must be an object.' }] }

  const name = isString(input.name) ? input.name.trim() : ''
  if (name.length < 1 || name.length > LIMITS.NAME_MAX) {
    errors.push({ path: 'name', message: `Name must be 1 to ${LIMITS.NAME_MAX} characters.` })
  } else if (existingNames.some((other) => normalizeName(other) === normalizeName(name))) {
    errors.push({ path: 'name', message: 'Another provider already uses this name.' })
  }

  validateCost(input.cost, errors)

  if (!missing(input.color) && !(isString(input.color) && COLOR_RE.test(input.color))) {
    errors.push({ path: 'color', message: 'Colour must look like #1a2b3c.' })
  }

  if (!missing(input.flags)) {
    if (!Array.isArray(input.flags) || input.flags.length > LIMITS.FLAGS_MAX) {
      errors.push({ path: 'flags', message: `At most ${LIMITS.FLAGS_MAX} flags.` })
    } else if (!input.flags.every((f) => isString(f) && f.length <= LIMITS.FLAG_MAX)) {
      errors.push({ path: 'flags', message: `Each flag is at most ${LIMITS.FLAG_MAX} characters.` })
    }
  }

  if (!missing(input.note) && (!isString(input.note) || input.note.length > LIMITS.NOTE_MAX)) {
    errors.push({ path: 'note', message: `Note must be at most ${LIMITS.NOTE_MAX} characters.` })
  }

  validateSchedule(input.schedule, errors)

  if (!Array.isArray(input.quotas) || input.quotas.length < 1) {
    errors.push({ path: 'quotas', message: 'Add at least one quota.' })
  } else if (input.quotas.length > LIMITS.QUOTAS_MAX) {
    errors.push({ path: 'quotas', message: `At most ${LIMITS.QUOTAS_MAX} quotas.` })
  } else {
    input.quotas.forEach((quota, i) => validateQuota(quota, i, { taskIds, requireValues }, errors))
    const ids = input.quotas.map((q) => q?.id).filter(Boolean)
    if (new Set(ids).size !== ids.length) errors.push({ path: 'quotas', message: 'Quota ids must be unique.' })
  }

  if (!missing(input.fits)) {
    if (!isObject(input.fits)) {
      errors.push({ path: 'fits', message: 'Fits must map tasks to a level.' })
    } else {
      for (const [taskId, level] of Object.entries(input.fits)) {
        if (!taskIds.includes(taskId)) errors.push({ path: `fits.${taskId}`, message: 'Unknown task.' })
        else if (!FIT_LEVELS.includes(level)) errors.push({ path: `fits.${taskId}`, message: 'Choose strong, acceptable, weak or none.' })
      }
    }
  }

  return { ok: errors.length === 0, errors }
}
