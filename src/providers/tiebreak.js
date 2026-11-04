// Shared, order-independent tail of every provider ordering (research D7). Used by routing
// recommendations and by surplus selection so neither depends on creation or display order.

// NFC, trim and case fold. Two names are "the same" when their normal forms are equal.
export function normalizeName(name) {
  return String(name ?? '').normalize('NFC').trim().toLocaleLowerCase('en-US').normalize('NFC')
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

// Total order over providers with distinct ids: normalised name, then id.
export function compareByName(a, b) {
  return cmp(normalizeName(a?.name), normalizeName(b?.name)) || cmp(String(a?.id ?? ''), String(b?.id ?? ''))
}
