// Service definitions with quota types:
// - consumed_pct: 0–100, where 100 = fully consumed (Claude, Copilot)
// - remaining_pct: 0–100, where 0 = fully consumed (ChatGPT Codex — matches UI display)
// - currency: numeric balance that decreases (OpenRouter, Kilocode)

export const SERVICES = [
  {
    id: 'claude',
    name: 'Claude',
    cost: 21.78,
    costCurrency: '€',
    resetType: 'weekly',
    color: '#378ADD',
    quotas: [
      { id: 'weekly', label: 'Weekly quota', value: 70, type: 'consumed_pct' },
      { id: 'slot5h', label: '5h slot (current)', value: 40, type: 'consumed_pct' },
    ],
    flags: ['token-intensive', 'premium LLM', 'multi-purpose'],
    note: 'Everything disabled when weekly or 5h slot limit is reached',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    cost: 22.99,
    costCurrency: '€',
    resetType: 'weekly',
    color: '#1D9E75',
    quotas: [
      { id: 'codex_remaining', label: 'Codex — remaining', value: 75, type: 'remaining_pct', subnote: 'Codex only' },
      { id: 'codex_5h', label: '5h slot — remaining', value: 60, type: 'remaining_pct', subnote: 'Codex only' },
    ],
    flags: ['generalist', 'token-efficient', 'chat always available'],
    note: 'Main chat always active — only Codex is rate-limited',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    cost: 8.71,
    costCurrency: '€',
    resetType: 'monthly',
    color: '#7F77DD',
    quotas: [
      { id: 'monthly', label: 'Monthly quota', value: 20, type: 'consumed_pct' },
    ],
    flags: ['per-request', 'not per-token', 'CI/CD integrated'],
    note: 'CI/CD disabled if exhausted, IDE completion stays active',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    cost: 0,
    costCurrency: null,
    resetType: 'payg',
    color: '#D85A30',
    quotas: [
      { id: 'credits', label: 'Remaining balance', value: 10.00, type: 'currency', currency: '$' },
    ],
    flags: ['pay-as-you-go', 'API', 'diverse models'],
    note: 'Decreasing balance — manual top-up',
  },
  {
    id: 'kilocode',
    name: 'Kilocode',
    cost: 0,
    costCurrency: null,
    resetType: 'payg',
    color: '#BA7517',
    quotas: [
      { id: 'credits', label: 'Remaining balance', value: 8.00, type: 'currency', currency: '$' },
    ],
    flags: ['pay-as-you-go', 'API', 'IDE integrated'],
    note: 'Decreasing balance — manual top-up',
  },
]

export const TASKS = [
  {
    id: 'coding_hard',
    name: 'Heavy coding',
    desc: 'Architecture, complex debug, refactoring',
  },
  {
    id: 'coding_light',
    name: 'Light coding',
    desc: 'Completion, snippets, quick fixes',
  },
  {
    id: 'work_heavy',
    name: 'Intensive work task',
    desc: 'Writing, analysis, reports, pharma',
  },
  {
    id: 'daily_chat',
    name: 'Daily chat',
    desc: 'Quick questions, brainstorming',
  },
  {
    id: 'oneshot',
    name: 'API one-shot',
    desc: 'Punctual script, test, automation',
  },
]
