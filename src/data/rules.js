// Routing rules — pure functions that take quota state and return a recommendation.
// state shape: { [serviceId]: { [quotaId]: number } }
//
// Each rule returns: { primary: serviceId, reason: string, alts: string[] }

const codexBlocked = (s) =>
  s.chatgpt.codex_remaining <= 0 || s.chatgpt.codex_5h <= 0

const claudeBlocked = (s) =>
  s.claude.weekly >= 100 || s.claude.slot5h >= 100

export const RULES = {
  coding_hard: (s) => {
    const c = s.claude.weekly
    const c5h = s.claude.slot5h

    if (claudeBlocked(s)) {
      return {
        primary: 'copilot',
        reason: 'Claude is blocked (weekly or 5h slot limit reached). Copilot to keep coding.',
        alts: ['chatgpt (Codex if available)'],
      }
    }
    if (c < 60 && c5h < 70) {
      return {
        primary: 'claude',
        reason: 'Claude available — best choice for complex coding.',
        alts: ['copilot for IDE completion in parallel'],
      }
    }
    if (c < 85) {
      return {
        primary: 'copilot',
        reason: `Claude under pressure (weekly ${c}%, 5h slot ${c5h}%). Copilot (per-request) to preserve Claude for work tasks.`,
        alts: ['claude for critical blocks only'],
      }
    }
    return {
      primary: 'chatgpt',
      reason: 'Claude nearly exhausted — redirect coding to ChatGPT or Copilot.',
      alts: ['copilot (IDE)'],
    }
  },

  coding_light: (s) => {
    const c = s.claude.weekly
    const cop = s.copilot.monthly

    if (cop < 50) {
      return {
        primary: 'copilot',
        reason: 'Copilot underused this month (per-request, not per-token). Best for light coding — saves Claude quota.',
        alts: [],
      }
    }
    if (c < 50) {
      return {
        primary: 'claude',
        reason: 'Copilot loaded but Claude still available — fine for light coding with context.',
        alts: ['copilot for IDE completion'],
      }
    }
    return {
      primary: 'chatgpt',
      reason: `Claude and Copilot under pressure — ChatGPT${codexBlocked(s) ? ' (chat, Codex exhausted)' : ' Codex'} for light tasks.`,
      alts: [],
    }
  },

  work_heavy: (s) => {
    const c = s.claude.weekly
    const c5h = s.claude.slot5h

    if (claudeBlocked(s)) {
      return {
        primary: 'chatgpt',
        reason: 'Claude blocked — ChatGPT as fallback for work tasks. Wait for reset for critical tasks.',
        alts: [],
      }
    }
    if (c < 75) {
      return {
        primary: 'claude',
        reason: 'Claude available — top choice for intensive work tasks (work, writing, analysis).',
        alts: [],
      }
    }
    if (c < 95) {
      return {
        primary: 'claude',
        reason: 'Claude loaded but work tasks justify the quota spend — absolute priority.',
        alts: ['chatgpt if task is less critical'],
      }
    }
    return {
      primary: 'chatgpt',
      reason: 'Claude nearly exhausted — ChatGPT for non-urgent work tasks.',
      alts: ['wait for Claude reset'],
    }
  },

  daily_chat: (s) => {
    const c = s.claude.weekly

    if (c < 40) {
      return {
        primary: 'claude',
        reason: 'Claude quota comfortable — fine for daily chat too.',
        alts: [],
      }
    }
    return {
      primary: 'chatgpt',
      reason: 'Redirect daily chat to ChatGPT (always available, token-efficient) — preserve Claude for work tasks and heavy coding.',
      alts: [],
    }
  },

  oneshot: (s) => {
    const kc = s.kilocode.credits
    const or = s.openrouter.credits

    if (kc > 1) {
      return {
        primary: 'kilocode',
        reason: `Kilocode balance available ($${kc.toFixed(2)}) — ideal for IDE one-shots.`,
        alts: or > 1 ? [`openrouter (direct API, $${or.toFixed(2)} available)`] : [],
      }
    }
    if (or > 1) {
      return {
        primary: 'openrouter',
        reason: `OpenRouter balance available ($${or.toFixed(2)}) — pay-as-you-go, no quota to manage.`,
        alts: [],
      }
    }
    return {
      primary: 'copilot',
      reason: 'API credits exhausted — use Copilot (fixed per-request) for light one-shots.',
      alts: ['chatgpt'],
    }
  },
}
