// Test-only sample providers (stored shape) and their runtime form (hand-written literals).
// Replaces the fixed SERVICES list as sample data in tests. Provider names here are
// deliberately generic: no test depends on a real vendor name.

export const WEEKLY_ID = 'p_weeklyaaaaaa'
export const WEEKLY_Q_WEEK = 'q_weekly22'
export const WEEKLY_Q_SESSION = 'q_session2'
export const MONTHLY_ID = 'p_monthlybbbbb'
export const MONTHLY_Q = 'q_monthly2'
export const PAYG_ID = 'p_paygcccccccc'
export const PAYG_Q = 'q_balance2'

export const SAMPLE_NOW_ISO = '2026-03-04T10:00:00.000Z'

const ALL_TASKS_FITS = { coding_hard: 'strong', coding_light: 'acceptable', work_heavy: 'strong', daily_chat: 'acceptable', oneshot: 'none' }

// Weekly subscription: two percentage quotas, eligible surplus profile (tool `claude`).
export function sampleWeekly(overrides = {}) {
  return {
    schemaVersion: 1,
    id: WEEKLY_ID,
    status: 'active',
    name: 'Alpha Weekly',
    cost: { amount: 20, currency: '€' },
    color: '#378add',
    flags: ['premium', 'multi-purpose'],
    note: 'Weekly plan',
    schedule: { type: 'weekly', cycleDays: 7 },
    quotas: [
      { id: WEEKLY_Q_WEEK, label: 'Weekly quota', type: 'consumed_pct', currency: null, lowBalance: null, gates: null, subnote: null },
      { id: WEEKLY_Q_SESSION, label: '5h slot', type: 'consumed_pct', currency: null, lowBalance: null, gates: null, subnote: null },
    ],
    fits: { ...ALL_TASKS_FITS },
    surplus: { tool: 'claude', weeklyQuotaId: WEEKLY_Q_WEEK, sessionQuotaId: WEEKLY_Q_SESSION },
    createdAt: '2026-03-01T08:00:00.000Z',
    updatedAt: '2026-03-01T08:00:00.000Z',
    ...overrides,
  }
}

// Monthly subscription: one percentage quota, no surplus profile.
export function sampleMonthly(overrides = {}) {
  return {
    schemaVersion: 1,
    id: MONTHLY_ID,
    status: 'active',
    name: 'Beta Monthly',
    cost: { amount: 9, currency: '€' },
    color: '#7f77dd',
    flags: [],
    note: '',
    schedule: { type: 'monthly', cycleDays: 30 },
    quotas: [
      { id: MONTHLY_Q, label: 'Monthly quota', type: 'consumed_pct', currency: null, lowBalance: null, gates: null, subnote: null },
    ],
    fits: { coding_light: 'strong', coding_hard: 'weak' },
    surplus: null,
    createdAt: '2026-03-01T08:01:00.000Z',
    updatedAt: '2026-03-01T08:01:00.000Z',
    ...overrides,
  }
}

// Pay-as-you-go: one currency balance, no schedule.
export function samplePayg(overrides = {}) {
  return {
    schemaVersion: 1,
    id: PAYG_ID,
    status: 'active',
    name: 'Gamma Credits',
    cost: null,
    color: null,
    flags: ['api'],
    note: '',
    schedule: { type: 'none', cycleDays: null },
    quotas: [
      { id: PAYG_Q, label: 'Remaining balance', type: 'currency', currency: '$', lowBalance: null, gates: null, subnote: null },
    ],
    fits: { oneshot: 'strong', coding_hard: 'acceptable' },
    surplus: null,
    createdAt: '2026-03-01T08:02:00.000Z',
    updatedAt: '2026-03-01T08:02:00.000Z',
    ...overrides,
  }
}

// Generic builder: sampleProvider() is the weekly one; sampleProvider({ ... }) overrides fields.
export function sampleProvider(overrides = {}) {
  return sampleWeekly(overrides)
}

export function sampleCatalogue() {
  return {
    schemaVersion: 1,
    providers: {
      [WEEKLY_ID]: sampleWeekly(),
      [MONTHLY_ID]: sampleMonthly(),
      [PAYG_ID]: samplePayg(),
    },
    order: [WEEKLY_ID, MONTHLY_ID, PAYG_ID],
    recordIndex: {},
    invalid: [],
  }
}

// Quota state matching the sample catalogue (values and stamps).
export function sampleState() {
  return {
    [WEEKLY_ID]: {
      [WEEKLY_Q_WEEK]: 40,
      [`__ts_${WEEKLY_Q_WEEK}`]: '2026-03-04T08:00:00.000Z',
      [WEEKLY_Q_SESSION]: 20,
      [`__ts_${WEEKLY_Q_SESSION}`]: '2026-03-04T08:00:00.000Z',
      __last_reset_date: '2026-03-02',
    },
    [MONTHLY_ID]: {
      [MONTHLY_Q]: 30,
      [`__ts_${MONTHLY_Q}`]: '2026-03-04T08:00:00.000Z',
      __last_reset_date: '2026-03-01',
    },
    [PAYG_ID]: {
      [PAYG_Q]: 12,
      [`__ts_${PAYG_Q}`]: '2026-03-04T08:00:00.000Z',
      __last_reset_date: null,
    },
  }
}

// Runtime form (what toRuntimeService produces) written by hand from data-model.md.
export function sampleServices() {
  return [
    {
      id: WEEKLY_ID,
      name: 'Alpha Weekly',
      color: '#378add',
      cost: 20,
      costCurrency: '€',
      flags: ['premium', 'multi-purpose'],
      note: 'Weekly plan',
      resetType: 'weekly',
      resetCycleDays: 7,
      quotas: [
        { id: WEEKLY_Q_WEEK, label: 'Weekly quota', type: 'consumed_pct', currency: null, lowBalance: null, gates: null, subnote: null },
        { id: WEEKLY_Q_SESSION, label: '5h slot', type: 'consumed_pct', currency: null, lowBalance: null, gates: null, subnote: null },
      ],
      fits: { ...ALL_TASKS_FITS },
      surplus: { tool: 'claude', weeklyQuotaId: WEEKLY_Q_WEEK, sessionQuotaId: WEEKLY_Q_SESSION },
    },
    {
      id: MONTHLY_ID,
      name: 'Beta Monthly',
      color: '#7f77dd',
      cost: 9,
      costCurrency: '€',
      flags: [],
      note: '',
      resetType: 'monthly',
      resetCycleDays: 30,
      quotas: [
        { id: MONTHLY_Q, label: 'Monthly quota', type: 'consumed_pct', currency: null, lowBalance: null, gates: null, subnote: null },
      ],
      fits: { coding_light: 'strong', coding_hard: 'weak' },
      surplus: null,
    },
    {
      id: PAYG_ID,
      name: 'Gamma Credits',
      color: null,
      cost: null,
      costCurrency: null,
      flags: ['api'],
      note: '',
      resetType: 'none',
      resetCycleDays: null,
      quotas: [
        { id: PAYG_Q, label: 'Remaining balance', type: 'currency', currency: '$', lowBalance: null, gates: null, subnote: null },
      ],
      fits: { oneshot: 'strong', coding_hard: 'acceptable' },
      surplus: null,
    },
  ]
}

const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
function seqToken(n, length) {
  let out = ''
  let rest = n
  for (let i = 0; i < length; i += 1) {
    out = B32[rest % 32] + out
    rest = Math.floor(rest / 32)
  }
  return out
}

// Deterministic id source for reducers: newId('provider') -> p_aaaaaaaaaaab, newId('quota') -> q_aaaaaaab.
export function sequentialIds(start = 0) {
  let provider = start
  let quota = start
  return (kind) => (kind === 'provider' ? `p_${seqToken((provider += 1), 12)}` : `q_${seqToken((quota += 1), 8)}`)
}

// Form input for addProvider: quotas carry an entered `value` and a `ref` for surplus designations.
export function sampleInput(overrides = {}) {
  return {
    name: 'Delta Weekly',
    cost: { amount: 20, currency: '€' },
    color: '#112233',
    flags: ['premium'],
    note: 'note',
    schedule: { type: 'weekly' },
    quotas: [
      { ref: 'week', label: 'Weekly quota', type: 'consumed_pct', value: 30 },
      { ref: 'session', label: '5h slot', type: 'consumed_pct', value: 10 },
    ],
    fits: { coding_hard: 'strong' },
    surplus: { tool: 'claude', weeklyQuotaId: 'week', sessionQuotaId: 'session' },
    ...overrides,
  }
}
