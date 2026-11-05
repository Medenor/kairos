// UI evidence for feature 007 without a browser: the real components are rendered to static markup through Vite's SSR
// transform (like weekly-history.integration.test.js). Interactions are covered by the reducers and the draft helper
// tests; this checks what the user sees in each state of the walkthrough (quickstart section 2).
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { toRuntimeServices } from './providers/runtime.js'
import { sampleCatalogue, sampleServices, sampleState, WEEKLY_ID } from './providers/fixtures/sampleProviders.js'
import { draftFromProvider } from './components/providerDraft.js'

let vite
let ProviderManager
let ProviderForm
let RecoBox
let DeleteProviderDialog
let EmptyState

before(async () => {
  vite = await createServer({
    configFile: new URL('../vite.config.js', import.meta.url).pathname,
    root: new URL('..', import.meta.url).pathname,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  ProviderManager = (await vite.ssrLoadModule('/src/components/ProviderManager.jsx')).default
  ProviderForm = (await vite.ssrLoadModule('/src/components/ProviderForm.jsx')).default
  RecoBox = (await vite.ssrLoadModule('/src/components/RecoBox.jsx')).default
  DeleteProviderDialog = (await vite.ssrLoadModule('/src/components/DeleteProviderDialog.jsx')).default
  EmptyState = (await vite.ssrLoadModule('/src/components/EmptyState.jsx')).default
})

after(async () => {
  await vite?.close()
})

const NOW = new Date(2026, 2, 4, 12)
const h = (Component, props) => renderToStaticMarkup(React.createElement(Component, props))
const plain = (markup) => markup.replaceAll('<!-- -->', '')
const manager = (over = {}) => {
  const catalogue = sampleCatalogue()
  return h(ProviderManager, {
    providers: toRuntimeServices(catalogue), stored: catalogue.providers, state: sampleState(), runs: [], now: NOW,
    onUpdateQuota() {}, onConfirmQuotas() {}, onAdd() {}, onUpdate() {}, onDelete() {}, onDuplicate() {}, onReorder() {}, ...over,
  })
}

test('no provider: an explanatory empty state invites a first provider and no card is shown (US1-1)', () => {
  const markup = manager({ providers: [], stored: {}, state: {} })
  assert.match(markup, /No provider yet/)
  assert.match(markup, /Add your first provider/)
  assert.doesNotMatch(markup, /Alpha Weekly|Beta Monthly|Claude|ChatGPT|Copilot|OpenRouter|Kilocode/)
  assert.match(h(EmptyState, { onAdd() {} }), /does not ship a provider list/)
})

test('declared providers are shown as cards with Edit, Duplicate, Move and Delete actions and no former provider appears', () => {
  const markup = manager()
  for (const name of ['Alpha Weekly', 'Beta Monthly', 'Gamma Credits']) assert.match(markup, new RegExp(name))
  for (const label of ['Edit', 'Duplicate', 'Move up', 'Move down', 'Delete']) assert.match(markup, new RegExp(`>${label}<`))
  assert.match(markup, />Add provider</)
  assert.match(markup, /20\.00€\/mo/)
  assert.match(markup, /Weekly reset/)
  assert.match(markup, /Monthly reset/)
  assert.match(markup, /No scheduled reset/)
  assert.doesNotMatch(markup, /Claude|ChatGPT|Copilot|OpenRouter|Kilocode/)
})

test('a quota with no stored value shows "No reading yet", never undefined or NaN', () => {
  const markup = manager({ state: { [WEEKLY_ID]: {} } })
  assert.match(markup, /No reading yet/)
  assert.doesNotMatch(markup, /undefined|NaN/)
})

test('the add form lists every field of the declaration, the fit grid default and the surplus section', () => {
  const markup = h(ProviderForm, { mode: 'create', onSubmit() {}, onCancel() {} })
  for (const text of ['Name', 'Monthly cost', 'Colour', 'Flags', 'Note', 'Reset schedule', 'Quotas (1/8)', 'Fit per task', 'Not set: treated as not suitable', 'Surplus use (optional)', 'Add provider', 'Cancel', 'Heavy coding', 'API one-shot']) {
    assert.match(markup, new RegExp(text.replace(/[()/]/g, '\\$&')), text)
  }
  assert.match(markup, /Weekly/)
  assert.match(markup, /Custom number of days/)
})

test('the edit form is pre-filled and the last quota cannot be removed', () => {
  const stored = sampleCatalogue().providers[WEEKLY_ID]
  const markup = h(ProviderForm, { mode: 'edit', initial: draftFromProvider(stored, sampleState()), onSubmit() {}, onCancel() {} })
  assert.match(markup, /Edit provider/)
  assert.match(markup, /value="Alpha Weekly"/)
  assert.match(markup, /value="40"/)
  assert.match(markup, /Save changes/)
  const one = { ...stored, quotas: [stored.quotas[0]], surplus: null }
  const single = h(ProviderForm, { mode: 'edit', initial: draftFromProvider(one, sampleState()), onSubmit() {}, onCancel() {} })
  assert.match(single, /<button[^>]*disabled=""[^>]*>Remove quota</)
})

test('the surplus section states what is missing for a provider that is not eligible (US5-5, SC-013)', () => {
  const stored = { ...sampleCatalogue().providers[WEEKLY_ID], schedule: { type: 'monthly', cycleDays: 30 } }
  const markup = h(ProviderForm, { mode: 'edit', initial: draftFromProvider(stored, sampleState()), onSubmit() {}, onCancel() {} })
  assert.match(markup, /Surplus use needs a weekly reset schedule/)
  const ok = h(ProviderForm, { mode: 'edit', initial: draftFromProvider(sampleCatalogue().providers[WEEKLY_ID], sampleState()), onSubmit() {}, onCancel() {} })
  assert.match(ok, /Surplus use is available for this provider once saved/)
})

test('the delete dialog names the provider, says what is removed and kept, and warns about a run in progress', () => {
  const stored = sampleCatalogue().providers[WEEKLY_ID]
  const markup = h(DeleteProviderDialog, { provider: stored, runs: [{ serviceId: WEEKLY_ID, status: 'running' }], onConfirm() {}, onCancel() {} })
  assert.match(markup, /Delete Alpha Weekly\?/)
  assert.match(markup, /Will be removed/)
  assert.match(markup, /Will be kept/)
  assert.match(markup, /weekly history/)
  assert.match(markup, /A run is in progress for Alpha Weekly/)
  assert.match(markup, />Delete</)
  assert.match(markup, />Cancel</)
})

test('the recommendation box shows the three distinct empty messages and a reasoned pick (US2)', () => {
  const services = sampleServices()
  const state = sampleState()
  assert.match(h(RecoBox, { task: null, providers: services, state, now: NOW }), /Select a task type/)
  assert.match(h(RecoBox, { task: 'coding_hard', providers: [], state: {}, now: NOW }), /No provider declared: add one/)
  assert.match(h(RecoBox, { task: 'daily_chat', providers: services.map((s) => ({ ...s, fits: {} })), state, now: NOW }), /No provider is suited to/)
  const pick = h(RecoBox, { task: 'coding_hard', providers: services, state, now: NOW })
  assert.match(pick, /Alpha Weekly/)
  assert.match(pick, /strong fit for &quot;Heavy coding&quot;|strong fit for "Heavy coding"/)
  assert.match(pick, /Alternatives/)
  const withExcluded = h(RecoBox, { task: 'oneshot', providers: services, state, now: NOW })
  assert.match(withExcluded, /Left out \(\d\)/)
})

test('notices of shared mode: a conflict offers keep theirs / reapply mine, a duplicate name offers a rename', () => {
  const markup = manager({
    notices: {
      conflicts: [{ key: `provider:${WEEKLY_ID}`, id: WEEKLY_ID, name: 'Alpha Weekly', local: { ...sampleCatalogue().providers[WEEKLY_ID], name: 'Mine', note: 'my note' }, server: { ...sampleCatalogue().providers[WEEKLY_ID], name: 'Theirs' } }],
      removedElsewhere: [{ id: 'p_gone', name: 'Old one' }],
      nameConflicts: [WEEKLY_ID],
      invalid: [{ key: 'provider:p_bad', errors: [{ path: 'name', message: 'bad' }] }],
    },
  })
  assert.match(markup, /was changed on another device/)
  assert.match(plain(markup), /Name: yours <em>Mine<\/em>, theirs <em>Theirs<\/em>/)
  assert.match(plain(markup), /Note: yours <em>my note<\/em>, theirs <em>Weekly plan<\/em>/)
  assert.match(markup, />Keep theirs</)
  assert.match(markup, />Reapply mine</)
  assert.match(markup, /was removed on another device/)
  assert.match(markup, /is used by two providers/)
  assert.match(markup, />Rename</)
  assert.match(markup, /shared provider records are invalid/)
})
