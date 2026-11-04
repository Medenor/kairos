import test from 'node:test'
import assert from 'node:assert/strict'
import { compareByName, normalizeName } from './tiebreak.js'

test('normalizeName applies NFC, trim and case fold', () => {
  assert.equal(normalizeName('Café '), normalizeName('CAFÉ'))
  assert.equal(normalizeName('Café'), normalizeName('Café'))
  assert.equal(normalizeName('  Alpha  '), 'alpha')
  assert.equal(normalizeName(undefined), '')
})

function shuffle(list, seed) {
  const out = [...list]
  let s = seed
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1664525 + 1013904223) % 4294967296
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const NAMES = ['Alpha', 'alpine', 'Beta', 'Zulu', 'zulu ', 'Éclair', 'eclair', 'Gamma', 'delta', 'Delta2', 'omega', 'Omega']
const PROVIDERS = NAMES.map((name, i) => ({ id: `p_${String(i).padStart(2, 'a')}x`, name }))

test('compareByName orders by normalised name then id and is antisymmetric', () => {
  const a = { id: 'p_aaa', name: 'Alpha' }
  const b = { id: 'p_bbb', name: 'alpha ' }
  assert.equal(compareByName(a, b), -1)
  assert.equal(compareByName(b, a), 1)
  assert.equal(compareByName(a, a), 0)
  for (const x of PROVIDERS) for (const y of PROVIDERS) assert.equal(Math.sign(compareByName(x, y)) + Math.sign(compareByName(y, x)), 0)
})

test('compareByName is transitive: every shuffle sorts to the same sequence', () => {
  const expected = [...PROVIDERS].sort(compareByName).map((p) => p.id)
  for (let seed = 1; seed <= 50; seed += 1) {
    assert.deepEqual(shuffle(PROVIDERS, seed).sort(compareByName).map((p) => p.id), expected)
  }
})

test('compareByName never returns 0 for two providers with different ids', () => {
  for (const x of PROVIDERS) for (const y of PROVIDERS) if (x.id !== y.id) assert.notEqual(compareByName(x, y), 0)
})
