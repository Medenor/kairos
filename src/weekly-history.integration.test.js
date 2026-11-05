import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { LEGACY_SERVICES as SERVICES } from './providers/fixtures/legacyServices.js'
import { createWeeklySnapshot } from './utils.js'

// The panel is real JSX with a CSS module, so it is loaded through Vite's SSR
// transform instead of being imported directly by Node.
let viteServer
let WeeklyHistoryPanel

before(async () => {
  viteServer = await createServer({
    configFile: new URL('../vite.config.js', import.meta.url).pathname,
    root: new URL('..', import.meta.url).pathname,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  const mod = await viteServer.ssrLoadModule('/src/components/WeeklyHistoryPanel.jsx')
  WeeklyHistoryPanel = mod.default
})

after(async () => {
  await viteServer?.close()
})

const CURRENT_WEEK = new Date('2026-04-24T12:00:00')

function makeState(overrides = {}) {
  const state = {}
  for (const service of SERVICES) {
    state[service.id] = {}
    for (const quota of service.quotas) {
      state[service.id][quota.id] = quota.value
    }
    state[service.id].__last_reset_date = null
  }
  for (const [serviceId, serviceState] of Object.entries(overrides)) {
    state[serviceId] = { ...(state[serviceId] || {}), ...serviceState }
  }
  return state
}

function shiftLocalDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function snapshotAt(weekDate, { overrides, providers = SERVICES } = {}) {
  return createWeeklySnapshot({
    workspaceId: 'workspace-1',
    state: makeState(overrides),
    providers,
    now: weekDate,
  })
}

function render(props) {
  return renderToStaticMarkup(
    React.createElement(WeeklyHistoryPanel, { providers: SERVICES, ...props })
  )
}

test('renders a multi-week comparison with an explicit gap for the unrecorded week (US2, US3/AC3)', () => {
  const history = [
    snapshotAt(shiftLocalDays(CURRENT_WEEK, -14), { overrides: { claude: { weekly: 78, slot5h: 61 } } }),
    snapshotAt(CURRENT_WEEK, { overrides: { claude: { weekly: 84, slot5h: 52 } } }),
  ]

  const markup = render({ weeklyHistory: history, selectedProviderId: 'claude', onSelectProvider: () => {} })

  assert.match(markup, /Weekly quota/)
  assert.match(markup, />78%</)
  assert.match(markup, />84%</)
  assert.match(markup, /5h slot/)
  assert.match(markup, /Missing week/)
  assert.match(markup, /No snapshot recorded for this week\./)
  assert.match(markup, /No quota values were recorded for this week\./)
  assert.match(markup, /2 recorded weeks/)
})

test('explains that history starts when Kairos begins recording when there are no snapshots (US3)', () => {
  const markup = render({ weeklyHistory: [], selectedProviderId: 'claude', onSelectProvider: () => {} })

  assert.match(markup, /No weekly snapshots recorded yet\./)
  assert.match(markup, /History starts from the first week Kairos records\./)
  assert.doesNotMatch(markup, /<table/)
})

test('explains that trends need more weeks when only one week is recorded (US3/AC1)', () => {
  const markup = render({
    weeklyHistory: [snapshotAt(CURRENT_WEEK)],
    selectedProviderId: 'claude',
    onSelectProvider: () => {},
  })

  assert.match(markup, /Trends need at least two recorded weeks/)
  assert.match(markup, /Recorded/)
  assert.doesNotMatch(markup, /recorded weeks</)
})

test('shows missing-service rows when a service was added after earlier snapshots (US3/AC2)', () => {
  const servicesWithoutCopilot = SERVICES.filter((service) => service.id !== 'copilot')
  const history = [
    snapshotAt(shiftLocalDays(CURRENT_WEEK, -7), { providers: servicesWithoutCopilot }),
    snapshotAt(CURRENT_WEEK),
  ]

  const markup = render({ weeklyHistory: history, selectedProviderId: 'copilot', onSelectProvider: () => {} })

  assert.match(markup, /Missing service/)
  assert.match(markup, /No history recorded for this provider this week/)
  assert.match(markup, /No quota values were recorded for this week\./)
})

test('keeps former services of the previous version reviewable from captured metadata (FR-007)', () => {
  const retiredSnapshot = {
    ...snapshotAt(shiftLocalDays(CURRENT_WEEK, -7)),
    providers: {},
    services: {
      archived_ai: {
        providerId: 'archived_ai',
        serviceName: 'Legacy Writer',
        capturedServiceMeta: { serviceName: 'Legacy Writer', color: '#666666', note: 'retired' },
        lastResetDate: null,
        quotas: {
          weekly: { quotaId: 'weekly', label: 'Weekly quota', type: 'consumed_pct', value: 81, currency: null },
        },
      },
    },
  }
  const history = [retiredSnapshot, snapshotAt(CURRENT_WEEK)]

  const markup = render({ weeklyHistory: history, selectedProviderId: 'archived_ai', onSelectProvider: () => {} })

  assert.match(markup, /Legacy Writer/)
  assert.match(markup, /Data from the previous version of Kairos/)
  assert.match(markup, />81%</)
  assert.match(markup, /Missing service/)
})

test('rendering history does not mutate the history it receives (FR-010)', () => {
  const history = [snapshotAt(shiftLocalDays(CURRENT_WEEK, -7)), snapshotAt(CURRENT_WEEK)]
  const before = JSON.stringify(history)

  render({ weeklyHistory: history, selectedProviderId: 'claude', onSelectProvider: () => {} })

  assert.equal(JSON.stringify(history), before)
})
