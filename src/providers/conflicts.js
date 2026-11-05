// What differs between two versions of the same provider (shared-mode conflict, contracts/shared-records.md):
// "the user sees what changed". Pure; compares the stored shapes, never ids or timestamps.

const JSON_EQUAL = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

const money = (cost) => (cost ? `${cost.amount}${cost.currency}` : 'none')
const schedule = (s) => (!s ? 'none' : s.type === 'custom' ? `every ${s.cycleDays} days` : s.type)
const quotaLabels = (quotas) => (quotas ?? []).map((q) => q.label).join(', ') || 'none'
const fitText = (fits) => {
  const entries = Object.entries(fits ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))
  return entries.length ? entries.map(([task, level]) => `${task}: ${level}`).join(', ') : 'none set'
}
const surplusText = (s) => (s ? `${s.tool} tool` : 'off')

// Field by field: [label, value shown for each side]. A removed provider only has a name.
const FIELDS = [
  ['Name', (p) => p.name],
  ['Cost', (p) => money(p.cost)],
  ['Colour', (p) => p.color ?? 'none'],
  ['Flags', (p) => (p.flags ?? []).join(', ') || 'none'],
  ['Note', (p) => p.note || 'none'],
  ['Reset schedule', (p) => schedule(p.schedule)],
  ['Quotas', (p) => quotaLabels(p.quotas)],
  ['Fit per task', (p) => fitText(p.fits)],
  ['Surplus use', (p) => surplusText(p.surplus)],
]
const RAW = {
  Name: (p) => p.name,
  Cost: (p) => p.cost,
  Colour: (p) => p.color,
  Flags: (p) => p.flags,
  Note: (p) => p.note ?? '',
  'Reset schedule': (p) => p.schedule,
  Quotas: (p) => (p.quotas ?? []).map(({ id: _id, ...rest }) => rest),
  'Fit per task': (p) => p.fits,
  'Surplus use': (p) => p.surplus && { tool: p.surplus.tool },
}

/** [{ field, mine, theirs }] for every field that differs; [] when only ids, timestamps or quota ids moved. */
export function describeConflict(local, server) {
  if (!local || !server) return []
  const changes = []
  for (const [label, show] of FIELDS) {
    if (!JSON_EQUAL(RAW[label](local), RAW[label](server))) changes.push({ field: label, mine: show(local), theirs: show(server) })
  }
  return changes
}
