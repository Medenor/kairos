import test from 'node:test'
import assert from 'node:assert/strict'
import { validateLeasePayload, keyForLease } from '../src/surplus/records.js'
import { createApiClient } from './api-client.js'
import { defaultConfig, takeOver } from './config.js'
import { start } from './fixtures/fake-api.js'
import { EXIT_CODES, LEASE_REASONS, LeaseError, createLease, readLeaseStatus } from './lease.js'

const KEY = keyForLease()
const T0 = Date.parse('2026-11-03T10:00:00.000Z')

const device = (deviceId, deviceName) => ({ ...defaultConfig({ deviceId, deviceName }), workspaceId: 'ws-test' })
const A = device('dev-a', 'Laptop')
const B = device('dev-b', 'Desktop')

function makeClock(startMs = T0) {
  let t = startMs
  const clock = () => new Date(t)
  clock.advance = (seconds) => {
    t += seconds * 1000
  }
  clock.iso = () => new Date(t).toISOString()
  return clock
}

async function withApi(fn) {
  const api = await start()
  const client = createApiClient({ apiBase: api.url, workspaceId: api.workspaceId, timeoutMs: 2000 })
  try {
    await fn({ api, client })
  } finally {
    await api.close()
  }
}

const leaseFor = (config, client, clock, extra = {}) => createLease({ config, api: client, now: clock, ...extra })
const puts = (api) => api.requests.filter((r) => r.method === 'PUT')

test('exit code mapping: a lease or designation problem is exit code 3', () => {
  assert.deepEqual({ ...EXIT_CODES }, { OK: 0, USAGE: 1, PREFLIGHT: 2, LEASE: 3 })
  assert.equal(new LeaseError(LEASE_REASONS.NOT_DESIGNATED, 'x').exitCode, 3)
})

test('first start writes designatedDeviceId and a valid live lease', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    const lease = leaseFor(A, client, clock)
    const { created } = await lease.claim()
    assert.equal(created, true)
    const record = api.find(KEY)
    assert.equal(validateLeasePayload(record.payload).valid, true)
    assert.equal(record.payload.designatedDeviceId, 'dev-a')
    assert.equal(record.payload.designatedDeviceName, 'Laptop')
    assert.equal(record.payload.designatedAt, clock.iso())
    assert.equal(record.payload.deviceId, 'dev-a')
    assert.equal(record.payload.heartbeatAt, clock.iso())
    assert.equal(record.payload.leaseSeconds, 180)
    assert.deepEqual(record.payload.approved, {})
    assert.equal(lease.isHeld(), true)
  }))

test('start after a take-over record (expired heartbeat) claims the lease and keeps designatedAt', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    await takeOver({ config: A, api: client, now: clock() })
    const designatedAt = api.find(KEY).payload.designatedAt
    clock.advance(5)
    await leaseFor(A, client, clock).claim()
    const payload = api.find(KEY).payload
    assert.equal(payload.designatedAt, designatedAt)
    assert.equal(payload.heartbeatAt, clock.iso())
    assert.equal(payload.startedAt, clock.iso())
  }))

test('the designated device restarts over its own expired lease but not over a live one', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    await leaseFor(A, client, clock).claim()
    clock.advance(100)
    await assert.rejects(
      () => leaseFor(A, client, clock).claim(),
      (error) => error instanceof LeaseError && error.exitCode === 3 && error.reason === LEASE_REASONS.LEASE_HELD,
    )
    clock.advance(81) // 181 s without heartbeat
    const second = leaseFor(A, client, clock)
    await second.claim()
    assert.equal(api.find(KEY).payload.startedAt, clock.iso())
  }))

test("a second device's start exits with code 3 even when the first lease has expired (FR-014)", () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    await leaseFor(A, client, clock).claim()
    clock.advance(10_000)
    const before = api.find(KEY)
    await assert.rejects(
      () => leaseFor(B, client, clock).claim(),
      (error) =>
        error instanceof LeaseError &&
        error.exitCode === EXIT_CODES.LEASE &&
        error.reason === LEASE_REASONS.NOT_DESIGNATED &&
        /Laptop/.test(error.message),
    )
    assert.deepEqual(api.find(KEY), before)
  }))

test('two devices racing for the first designation: exactly one wins', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    const results = await Promise.allSettled([leaseFor(A, client, clock).claim(), leaseFor(B, client, clock).claim()])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    const loser = results.find((r) => r.status === 'rejected')
    assert.equal(loser.reason.exitCode, 3)
    assert.equal(api.records.size, 1)
  }))

test('heartbeat PUTs with expected_version and renews heartbeatAt', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    const lease = leaseFor(A, client, clock)
    await lease.claim()
    assert.equal(api.find(KEY).version, 1)
    clock.advance(60)
    const result = await lease.heartbeat()
    assert.equal(result.status, 'ok')
    const sent = puts(api)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].body.expected_version, 1)
    assert.equal(api.find(KEY).version, 2)
    assert.equal(api.find(KEY).payload.heartbeatAt, clock.iso())
    clock.advance(60)
    await lease.heartbeat()
    assert.equal(puts(api)[1].body.expected_version, 2)
    assert.equal(api.find(KEY).version, 3)
  }))

test('heartbeat is due every 60 s and maybeHeartbeat only sends when due', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    const lease = leaseFor(A, client, clock)
    assert.equal(lease.heartbeatIntervalMs, 60_000)
    assert.equal(lease.leaseMs, 180_000)
    await lease.claim()
    clock.advance(59)
    assert.equal(lease.heartbeatDue(), false)
    assert.equal(await lease.maybeHeartbeat(), null)
    assert.equal(puts(api).length, 0)
    clock.advance(1)
    assert.equal(lease.heartbeatDue(), true)
    const result = await lease.maybeHeartbeat()
    assert.equal(result.status, 'ok')
    assert.equal(puts(api).length, 1)
    assert.equal(lease.heartbeatDue(), false)
  }))

test('heartbeat publishes the display-only approved map and drops malformed entries', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    const lease = leaseFor(A, client, clock)
    await lease.claim({ approved: { 'i-1': 2 } })
    assert.deepEqual(api.find(KEY).payload.approved, { 'i-1': 2 })
    clock.advance(60)
    await lease.heartbeat({ approved: { 'i-1': 3, 'i-2': 1, bad: 0, worse: 'x', frac: 1.5 } })
    assert.deepEqual(api.find(KEY).payload.approved, { 'i-1': 3, 'i-2': 1 })
    clock.advance(60)
    await lease.heartbeat() // keeps the last published map
    assert.deepEqual(api.find(KEY).payload.approved, { 'i-1': 3, 'i-2': 1 })
    assert.equal(validateLeasePayload(api.find(KEY).payload).valid, true)
  }))

test('a forged approved map on the lease is overwritten and never copied', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    const lease = leaseFor(A, client, clock)
    await lease.claim({ approved: { real: 1 } })
    api.put(KEY, { ...api.find(KEY).payload, approved: { forged: 9 } })
    clock.advance(60)
    const result = await lease.heartbeat()
    assert.equal(result.status, 'ok') // same designation and instance: adopt the version and carry on
    assert.deepEqual(api.find(KEY).payload.approved, { real: 1 })
    assert.equal(puts(api).length, 2) // the 409 attempt and the retry
  }))

test('config --take-over on the second device: the first runner exits on its next heartbeat', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    const first = leaseFor(A, client, clock)
    await first.claim()
    clock.advance(30)
    await takeOver({ config: B, api: client, now: clock() })
    assert.equal(api.find(KEY).payload.designatedDeviceId, 'dev-b')
    clock.advance(30)
    const result = await first.heartbeat()
    assert.equal(result.status, 'lost')
    assert.equal(result.reason, LEASE_REASONS.NOT_DESIGNATED)
    assert.equal(result.exitCode, 3)
    assert.equal(first.isHeld(), false)
    // a lost lease stays lost and sends nothing further
    const count = api.requests.length
    assert.equal((await first.heartbeat()).status, 'lost')
    assert.equal(api.requests.length, count)
    // the old runner released its lease, so the new designated device can start at once
    assert.equal(api.find(KEY).payload.designatedDeviceId, 'dev-b')
    const second = leaseFor(B, client, clock)
    await second.claim()
    assert.equal(api.find(KEY).payload.deviceId, 'dev-b')
    assert.equal(second.isHeld(), true)
  }))

test('after a take-over the new device must wait while the old lease is still live', () =>
  withApi(async ({ client }) => {
    const clock = makeClock()
    await leaseFor(A, client, clock).claim()
    clock.advance(10)
    await takeOver({ config: B, api: client, now: clock() })
    await assert.rejects(
      () => leaseFor(B, client, clock).claim(),
      (error) => error.exitCode === 3 && error.reason === LEASE_REASONS.LEASE_HELD,
    )
    clock.advance(171)
    await leaseFor(B, client, clock).claim()
  }))

test('a lease taken by another process of the same device ends this runner (lease_taken)', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    const first = leaseFor(A, client, clock)
    await first.claim()
    clock.advance(200)
    const second = leaseFor(A, client, clock)
    await second.claim()
    clock.advance(10)
    const result = await first.heartbeat()
    assert.equal(result.status, 'lost')
    assert.equal(result.reason, LEASE_REASONS.LEASE_TAKEN)
    assert.equal(result.exitCode, 3)
    assert.equal(api.find(KEY).payload.startedAt, new Date(T0 + 200_000).toISOString())
  }))

test('a forged designation written by another client stops the runner but starts nothing', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    const lease = leaseFor(A, client, clock)
    await lease.claim()
    api.put(KEY, { ...api.find(KEY).payload, designatedDeviceId: 'attacker', designatedDeviceName: 'Evil' })
    clock.advance(60)
    const result = await lease.heartbeat()
    assert.equal(result.status, 'lost')
    assert.equal(result.reason, LEASE_REASONS.NOT_DESIGNATED)
    // the forged designation is not overwritten by the lease module; a fresh start is refused too
    assert.equal(api.find(KEY).payload.designatedDeviceId, 'attacker')
    await assert.rejects(() => leaseFor(A, client, clock).claim(), (error) => error.exitCode === 3)
  }))

test('a forged lease from another client (live, other instance) stops the runner but never grants a run', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    const lease = leaseFor(A, client, clock)
    await lease.claim()
    api.put(KEY, { ...api.find(KEY).payload, deviceId: 'forger', deviceName: 'Forger', startedAt: clock.iso() })
    clock.advance(60)
    const result = await lease.heartbeat()
    assert.equal(result.status, 'lost')
    assert.equal(result.reason, LEASE_REASONS.LEASE_TAKEN)
    assert.equal(lease.isHeld(), false)
    // another process of the designated device cannot claim over the forged live lease either
    await assert.rejects(
      () => leaseFor(A, client, clock).claim(),
      (error) => error.exitCode === 3 && error.reason === LEASE_REASONS.LEASE_HELD,
    )
  }))

test('a garbage lease payload stops the runner (lease_invalid) and a fresh claim repairs it only for the designated device', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    const lease = leaseFor(A, client, clock)
    await lease.claim()
    api.put(KEY, { nonsense: true })
    clock.advance(60)
    const result = await lease.heartbeat()
    assert.equal(result.status, 'lost')
    assert.equal(result.reason, LEASE_REASONS.LEASE_INVALID)
    // nobody is designated: start is refused until the user runs `config --take-over`
    await assert.rejects(
      () => leaseFor(A, client, clock).claim(),
      (error) => error.exitCode === 3 && error.reason === LEASE_REASONS.LEASE_INVALID,
    )
    api.put(KEY, { ...api.find(KEY).payload, designatedDeviceId: 'dev-a', designatedDeviceName: 'Laptop' })
    await leaseFor(A, client, clock).claim()
    assert.equal(validateLeasePayload(api.find(KEY).payload).valid, true)
  }))

test('a deleted lease record ends the runner (lease_missing) and is not recreated', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    const lease = leaseFor(A, client, clock)
    await lease.claim()
    await client.deleteRecord(api.find(KEY).id)
    clock.advance(60)
    const result = await lease.heartbeat()
    assert.equal(result.status, 'lost')
    assert.equal(result.reason, LEASE_REASONS.LEASE_MISSING)
    assert.equal(api.find(KEY), null)
  }))

test('transient failures retry while the lease is locally valid, then expire after 180 s', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    const lease = leaseFor(A, client, clock)
    await lease.claim()
    clock.advance(60)
    api.failNext(500, { times: 10 })
    const first = await lease.heartbeat()
    assert.equal(first.status, 'retry')
    assert.ok(first.error)
    assert.equal(lease.isHeld(), true)
    clock.advance(120) // 180 s after the last successful heartbeat: still valid (expiry is strictly after 180 s)
    assert.equal((await lease.heartbeat()).status, 'retry')
    assert.equal(lease.isHeld(), true)
    clock.advance(1)
    assert.equal(lease.isHeld(), false)
    const expired = await lease.heartbeat()
    assert.equal(expired.status, 'lost')
    assert.equal(expired.reason, LEASE_REASONS.LEASE_EXPIRED)
    assert.equal(expired.exitCode, 3)
  }))

test('a successful heartbeat after transient failures renews normally', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    const lease = leaseFor(A, client, clock)
    await lease.claim()
    clock.advance(60)
    api.failNext(503)
    assert.equal((await lease.heartbeat()).status, 'retry')
    clock.advance(10)
    assert.equal((await lease.heartbeat()).status, 'ok')
    assert.equal(api.find(KEY).payload.heartbeatAt, clock.iso())
  }))

test('verify reads the record without writing and reports designation or lease loss', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    const lease = leaseFor(A, client, clock)
    await lease.claim()
    clock.advance(30)
    assert.equal((await lease.verify()).status, 'ok')
    assert.equal(puts(api).length, 0)
    await takeOver({ config: B, api: client, now: clock() })
    const result = await lease.verify()
    assert.equal(result.status, 'lost')
    assert.equal(result.reason, LEASE_REASONS.NOT_DESIGNATED)
    assert.equal(lease.isHeld(), false)
  }))

test('release marks the lease expired but keeps the designation', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    const lease = leaseFor(A, client, clock)
    await lease.claim()
    await lease.release()
    const payload = api.find(KEY).payload
    assert.equal(payload.designatedDeviceId, 'dev-a')
    assert.equal(payload.heartbeatAt, new Date(0).toISOString())
    assert.equal(lease.isHeld(), false)
    await leaseFor(A, client, clock).claim() // restart is immediate
  }))

test('release does not touch a record that belongs to someone else', () =>
  withApi(async ({ api, client }) => {
    const clock = makeClock()
    const lease = leaseFor(A, client, clock)
    await lease.claim()
    await takeOver({ config: B, api: client, now: clock() })
    api.put(KEY, { ...api.find(KEY).payload, deviceId: 'dev-b', startedAt: clock.iso() })
    const before = api.find(KEY)
    await lease.release()
    assert.deepEqual(api.find(KEY), before)
  }))

test('readLeaseStatus describes the record for the status command', () =>
  withApi(async ({ client }) => {
    const clock = makeClock()
    assert.deepEqual(await readLeaseStatus({ config: A, api: client, now: clock }), {
      exists: false,
      valid: false,
      designatedDeviceId: null,
      designatedDeviceName: null,
      designatedHere: false,
      holderDeviceId: null,
      holderDeviceName: null,
      heartbeatAt: null,
      ageSeconds: null,
      expired: true,
      approved: {},
    })
    await leaseFor(A, client, clock, {}).claim({ approved: { 'i-1': 1 } })
    clock.advance(45)
    const here = await readLeaseStatus({ config: A, api: client, now: clock })
    assert.equal(here.exists, true)
    assert.equal(here.valid, true)
    assert.equal(here.designatedHere, true)
    assert.equal(here.holderDeviceName, 'Laptop')
    assert.equal(here.ageSeconds, 45)
    assert.equal(here.expired, false)
    assert.deepEqual(here.approved, { 'i-1': 1 })
    clock.advance(200)
    const there = await readLeaseStatus({ config: B, api: client, now: clock })
    assert.equal(there.designatedHere, false)
    assert.equal(there.designatedDeviceName, 'Laptop')
    assert.equal(there.expired, true)
  }))

test('heartbeat before claim is a programming error', () =>
  withApi(async ({ client }) => {
    const lease = leaseFor(A, client, makeClock())
    await assert.rejects(() => lease.heartbeat(), /claim/)
    assert.equal(lease.isHeld(), false)
  }))

test('API failure while claiming propagates as an ApiClientError, not a LeaseError', () =>
  withApi(async ({ api, client }) => {
    api.failNext(500)
    await assert.rejects(
      () => leaseFor(A, client, makeClock()).claim(),
      (error) => !(error instanceof LeaseError) && error.name === 'ApiClientError',
    )
  }))
