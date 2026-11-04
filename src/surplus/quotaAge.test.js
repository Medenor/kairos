import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatQuotaAge } from './quotaAge.js'

const now = new Date('2026-11-03T12:00:00.000Z')

test('missing or invalid stamps read as never confirmed', () => {
  assert.equal(formatQuotaAge(null, now), 'never confirmed')
  assert.equal(formatQuotaAge(undefined, now), 'never confirmed')
  assert.equal(formatQuotaAge('', now), 'never confirmed')
  assert.equal(formatQuotaAge('not a date', now), 'never confirmed')
})

test('formats minutes, hours and days', () => {
  assert.equal(formatQuotaAge('2026-11-03T11:59:30.000Z', now), 'updated just now')
  assert.equal(formatQuotaAge('2026-11-03T11:35:00.000Z', now), 'updated 25 min ago')
  assert.equal(formatQuotaAge('2026-11-03T09:00:00.000Z', now), 'updated 3 h ago')
  assert.equal(formatQuotaAge('2026-11-01T11:00:00.000Z', now), 'updated 2 d ago')
})

test('a stamp in the future (clock skew) reads as just now', () => {
  assert.equal(formatQuotaAge('2026-11-03T12:05:00.000Z', now), 'updated just now')
})
