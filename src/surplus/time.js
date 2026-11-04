// Pure local-time helpers for the surplus feature (no Date.now(), no Node or browser APIs).
// All calendar maths use the local timezone of the runtime, which matches the user's own days.
import { DEFAULTS } from './constants.js'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const SEARCH_DAYS = 8 // today plus one full week ahead

function parseTime(value) {
  const m = typeof value === 'string' ? TIME_RE.exec(value) : null
  return m ? { h: Number(m[1]), min: Number(m[2]) } : null
}

/** Local midnight Date of a 'YYYY-MM-DD' reset date, or null when absent or invalid. */
export function resetDayStart(nextResetDate) {
  const m = typeof nextResetDate === 'string' ? DATE_RE.exec(nextResetDate) : null
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  const date = new Date(y, mo, d)
  // Reject overflow such as 2026-02-31.
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null
  return date
}

// Occurrences of one range as {start, end} Dates, for the calendar day offset from `now`'s day.
function occurrence(range, now, dayOffset) {
  const s = parseTime(range?.start)
  const e = parseTime(range?.end)
  if (!s || !e || !Array.isArray(range.days)) return null
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, s.h, s.min)
  if (!range.days.includes(start.getDay())) return null
  const crosses = e.h * 60 + e.min <= s.h * 60 + s.min
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset + (crosses ? 1 : 0), e.h, e.min)
  return { start, end }
}

/**
 * True when `now` is inside a protected range. A range belongs to the day it starts on
 * (`days` lists start days); when end <= start it ends the next morning.
 */
export function isInProtectedHours(protectedHours, now) {
  if (!Array.isArray(protectedHours)) return false
  for (const range of protectedHours) {
    for (const offset of [-1, 0]) {
      const occ = occurrence(range, now, offset)
      if (occ && occ.start <= now && now < occ.end) return true
    }
  }
  return false
}

/**
 * Earliest protected-hours start at or after `now` (a start equal to `now` counts), looking one
 * week ahead. Returns a Date, or null when no ranges are declared.
 */
export function nextProtectedStart(protectedHours, now) {
  if (!Array.isArray(protectedHours) || protectedHours.length === 0) return null
  let best = null
  for (const range of protectedHours) {
    for (let offset = 0; offset < SEARCH_DAYS; offset += 1) {
      const occ = occurrence(range, now, offset)
      if (occ && occ.start >= now) {
        if (!best || occ.start < best) best = occ.start
        break
      }
    }
  }
  return best
}

/**
 * Hard stop for a run started at `now`: the minimum of now + maxRunMinutes, the next protected
 * start and the local start of the reset day. Already inside protected hours, it is `now`
 * (no time available). Returns a Date.
 */
export function hardStopAt(now, policy, nextResetDate) {
  const maxMinutes = policy?.thresholds?.maxRunMinutes ?? DEFAULTS.MAX_RUN_MINUTES
  const bounds = [new Date(now.getTime() + maxMinutes * 60000)]
  const protectedHours = policy?.protectedHours ?? []
  if (isInProtectedHours(protectedHours, now)) bounds.push(new Date(now.getTime()))
  const protectedStart = nextProtectedStart(protectedHours, now)
  if (protectedStart) bounds.push(protectedStart)
  const resetStart = resetDayStart(nextResetDate)
  if (resetStart) bounds.push(resetStart)
  return new Date(Math.min(...bounds.map((d) => d.getTime())))
}
