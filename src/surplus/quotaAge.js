// Human-readable age of a quota reading (feature 006, FR-031). Pure: `now` is always passed in.

const MIN_MS = 60 * 1000
const HOUR_MS = 60 * MIN_MS
const DAY_MS = 24 * HOUR_MS

/**
 * Label for the age of a quota reading stamp.
 * @param {string|null|undefined} stamp ISO string stored in quotaState[`__ts_<quotaId>`]
 * @param {Date} now
 * @returns {string} e.g. "updated 3 h ago", "never confirmed"
 */
export function formatQuotaAge(stamp, now) {
  if (typeof stamp !== 'string' || stamp === '') return 'never confirmed'
  const at = Date.parse(stamp)
  if (Number.isNaN(at)) return 'never confirmed'
  const diff = now.getTime() - at
  if (diff < MIN_MS) return 'updated just now'
  if (diff < HOUR_MS) return `updated ${Math.floor(diff / MIN_MS)} min ago`
  if (diff < DAY_MS) return `updated ${Math.floor(diff / HOUR_MS)} h ago`
  return `updated ${Math.floor(diff / DAY_MS)} d ago`
}
