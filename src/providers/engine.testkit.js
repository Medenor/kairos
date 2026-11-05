// Test-only setup shared by the catalogue engine suites: an engine on a fake server with manual timers
// and a stepping clock, so a "device" is one call to setupDevice(server).
import { createCatalogueEngine } from './engine.js'
import { fakeServer, manualTimers, memoryStorage } from '../sync/fakeServer.testkit.js'
import { sampleInput, sequentialIds } from './fixtures/sampleProviders.js'

export { fakeServer, memoryStorage, sampleInput }

export function setupDevice({ server = fakeServer(), storage = memoryStorage(), ids = sequentialIds(), failBeforeCommit = false } = {}) {
  const timers = manualTimers()
  let tick = 0
  const engine = createCatalogueEngine({
    storage,
    api: server.api,
    now: () => new Date(Date.parse('2026-03-04T10:00:00.000Z') + (tick += 1) * 60000),
    newId: ids,
    beforeCommit: failBeforeCommit ? () => false : undefined,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  const fire = async () => {
    timers.fire()
    await engine.flush()
  }
  const add = (name, extra = {}) => {
    const result = engine.actions.addProvider(sampleInput({ name, ...extra }), { state: {} })
    assert.ok(result.ok, JSON.stringify(result.errors))
    return result.catalogue.order.at(-1)
  }
  return { engine, server, storage, timers, fire, add, snapshot: () => engine.getSnapshot() }
}

import assert from 'node:assert/strict'
