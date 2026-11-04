// REFERENCE DATA, NOT SHIPPED. The five former fixed providers declared the way a user would declare
// them (stored shape): fit per task chosen to mirror the former rules, gating per quota, low balance 5,
// schedules weekly/weekly/monthly/none/none. Used only by routing.reference.test.js (before/after).

export const ID = {
  claude: 'p_claudeaaaaaa',
  chatgpt: 'p_chatgptaaaaa',
  copilot: 'p_copilotaaaaa',
  openrouter: 'p_openrouteraa',
  kilocode: 'p_kilocodeaaaa',
}

// legacy state path (service, quota) -> [providerId, quotaId]
export const QUOTA = {
  'claude.weekly': [ID.claude, 'q_weekly22'],
  'claude.slot5h': [ID.claude, 'q_slot5haa'],
  'chatgpt.codex_remaining': [ID.chatgpt, 'q_remain22'],
  'chatgpt.codex_5h': [ID.chatgpt, 'q_codex5ha'],
  'copilot.monthly': [ID.copilot, 'q_monthly2'],
  'openrouter.credits': [ID.openrouter, 'q_credits2'],
  'kilocode.credits': [ID.kilocode, 'q_credits3'],
}

const pct = (id, label, type = 'consumed_pct', gates = null) => ({ id, label, type, currency: null, lowBalance: null, gates, subnote: null })
const balance = (id) => ({ id, label: 'Remaining balance', type: 'currency', currency: '$', lowBalance: 5, gates: ['oneshot'], subnote: null })

const base = (id, name, schedule, quotas, fits) => ({
  schemaVersion: 1, id, status: 'active', name, cost: null, color: null, flags: [], note: '', schedule, quotas, fits, surplus: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})

export function legacyProviders() {
  return [
    base(ID.claude, 'Claude', { type: 'weekly', cycleDays: 7 },
      [pct('q_weekly22', 'Weekly quota'), pct('q_slot5haa', '5h slot')],
      { coding_hard: 'strong', coding_light: 'acceptable', work_heavy: 'strong', daily_chat: 'acceptable', oneshot: 'none' }),
    base(ID.chatgpt, 'ChatGPT', { type: 'weekly', cycleDays: 7 },
      [pct('q_remain22', 'Weekly quota (remaining)', 'remaining_pct', ['coding_hard', 'coding_light']), pct('q_codex5ha', '5h slot (remaining)', 'remaining_pct', ['coding_hard', 'coding_light'])],
      { coding_hard: 'acceptable', coding_light: 'weak', work_heavy: 'acceptable', daily_chat: 'strong', oneshot: 'none' }),
    base(ID.copilot, 'GitHub Copilot', { type: 'monthly', cycleDays: 30 },
      [pct('q_monthly2', 'Monthly quota')],
      { coding_hard: 'acceptable', coding_light: 'strong', work_heavy: 'none', daily_chat: 'none', oneshot: 'weak' }),
    base(ID.openrouter, 'OpenRouter', { type: 'none', cycleDays: null },
      [balance('q_credits2')],
      { oneshot: 'acceptable' }),
    base(ID.kilocode, 'Kilocode', { type: 'none', cycleDays: null },
      [balance('q_credits3')],
      { oneshot: 'strong' }),
  ]
}
