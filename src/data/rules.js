// Routing rules — pure functions that take quota state and return a recommendation.
// state shape: { [serviceId]: { [quotaId]: number } }
//
// Each rule returns: { primary: serviceId, reason: string, alts: string[] }

// Returns true when both services have a valid daysRemaining and their
// quota pressures are within the comparable-pressure band (≤ 15 pts).
function resetTiebreaker(sigA, sigB, pressureA, pressureB) {
  if (!sigA || !sigB) return false
  if (sigA.daysRemaining === null || sigB.daysRemaining === null) return false
  return Math.abs(pressureA - pressureB) <= 15
}

// Returns a note to append when the selected service has a due/overdue reset.
function resetNote(signal) {
  if (!signal) return ''
  if (signal.state === 'due') return ' Reset due today — your quota may have already refreshed.'
  if (signal.state === 'overdue') return ' Reset overdue — consider logging the new reset date.'
  return ''
}

const codexBlocked = (s) =>
  s.chatgpt.codex_remaining <= 0 || s.chatgpt.codex_5h <= 0

const claudeBlocked = (s) =>
  s.claude.weekly >= 100 || s.claude.slot5h >= 100

export const RULES = {
  coding_hard: (s, rs) => {
    const c = s.claude.weekly
    const c5h = s.claude.slot5h

    if (claudeBlocked(s)) {
      const copPressure = s.copilot.monthly
      const chatPressure = 100 - s.chatgpt.codex_remaining
      if (rs && resetTiebreaker(rs.copilot, rs.chatgpt, copPressure, chatPressure)) {
        const preferCop = rs.copilot.daysRemaining <= rs.chatgpt.daysRemaining
        const primary = preferCop ? 'copilot' : 'chatgpt'
        return {
          primary,
          reason: `Claude blocked. ${preferCop ? 'Copilot' : 'ChatGPT'} resets in ${preferCop ? rs.copilot.daysRemaining : rs.chatgpt.daysRemaining}d vs ${preferCop ? 'ChatGPT' : 'Copilot'}'s ${preferCop ? rs.chatgpt.daysRemaining : rs.copilot.daysRemaining}d — spend it now.${resetNote(rs[primary])}`,
          alts: [preferCop ? 'chatgpt (Codex if available)' : 'copilot'],
        }
      }
      return {
        primary: 'copilot',
        reason: `Claude is blocked (weekly or 5h slot limit reached). Copilot to keep coding.${rs ? resetNote(rs.copilot) : ''}`,
        alts: ['chatgpt (Codex if available)'],
      }
    }
    if (c < 60 && c5h < 70) {
      return {
        primary: 'claude',
        reason: `Claude available — best choice for complex coding.${rs ? resetNote(rs.claude) : ''}`,
        alts: ['copilot for IDE completion in parallel'],
      }
    }
    if (c < 85) {
      const copPressure = s.copilot.monthly
      if (rs && resetTiebreaker(rs.claude, rs.copilot, c, copPressure)) {
        const preferClaude = rs.claude.daysRemaining <= rs.copilot.daysRemaining
        const primary = preferClaude ? 'claude' : 'copilot'
        const primaryDays = preferClaude ? rs.claude.daysRemaining : rs.copilot.daysRemaining
        const altDays = preferClaude ? rs.copilot.daysRemaining : rs.claude.daysRemaining
        const altName = preferClaude ? 'Copilot' : 'Claude'
        const primaryName = preferClaude ? 'Claude' : 'Copilot'
        return {
          primary,
          reason: `${primaryName} under pressure — but resets in ${primaryDays}d vs ${altName}'s ${altDays}d. Spend ${primaryName} now.${resetNote(rs[primary])}`,
          alts: [preferClaude ? 'copilot for IDE completion in parallel' : 'claude for critical blocks only'],
        }
      }
      return {
        primary: 'copilot',
        reason: `Claude under pressure (weekly ${c}%, 5h slot ${c5h}%). Copilot (per-request) to preserve Claude for work tasks.${rs ? resetNote(rs.copilot) : ''}`,
        alts: ['claude for critical blocks only'],
      }
    }
    return {
      primary: 'chatgpt',
      reason: `Claude nearly exhausted — redirect coding to ChatGPT or Copilot.${rs ? resetNote(rs.chatgpt) : ''}`,
      alts: ['copilot (IDE)'],
    }
  },

  coding_light: (s, rs) => {
    const c = s.claude.weekly
    const cop = s.copilot.monthly

    if (cop < 50) {
      return {
        primary: 'copilot',
        reason: `Copilot underused this month (per-request, not per-token). Best for light coding — saves Claude quota.${rs ? resetNote(rs.copilot) : ''}`,
        alts: [],
      }
    }
    if (c < 50) {
      if (rs && resetTiebreaker(rs.copilot, rs.claude, cop, c)) {
        const preferCop = rs.copilot.daysRemaining <= rs.claude.daysRemaining
        const primary = preferCop ? 'copilot' : 'claude'
        const primaryName = preferCop ? 'Copilot' : 'Claude'
        const altName = preferCop ? 'Claude' : 'Copilot'
        const primaryDays = preferCop ? rs.copilot.daysRemaining : rs.claude.daysRemaining
        const altDays = preferCop ? rs.claude.daysRemaining : rs.copilot.daysRemaining
        return {
          primary,
          reason: `${primaryName} resets in ${primaryDays}d vs ${altName}'s ${altDays}d — spend ${primaryName} now for light coding.${resetNote(rs[primary])}`,
          alts: [preferCop ? 'claude for context-heavy tasks' : 'copilot for IDE completion'],
        }
      }
      return {
        primary: 'claude',
        reason: `Copilot loaded but Claude still available — fine for light coding with context.${rs ? resetNote(rs.claude) : ''}`,
        alts: ['copilot for IDE completion'],
      }
    }
    return {
      primary: 'chatgpt',
      reason: `Claude and Copilot under pressure — ChatGPT${codexBlocked(s) ? ' (chat, Codex exhausted)' : ' Codex'} for light tasks.${rs ? resetNote(rs.chatgpt) : ''}`,
      alts: [],
    }
  },

  work_heavy: (s, rs) => {
    const c = s.claude.weekly
    const c5h = s.claude.slot5h

    if (claudeBlocked(s)) {
      return {
        primary: 'chatgpt',
        reason: `Claude blocked — ChatGPT as fallback for work tasks. Wait for reset for critical tasks.${rs ? resetNote(rs.chatgpt) : ''}`,
        alts: [],
      }
    }
    if (c < 75) {
      return {
        primary: 'claude',
        reason: `Claude available — top choice for intensive work tasks (work, writing, analysis).${rs ? resetNote(rs.claude) : ''}`,
        alts: [],
      }
    }
    if (c < 95) {
      const chatPressure = 100 - s.chatgpt.codex_remaining
      if (rs && resetTiebreaker(rs.claude, rs.chatgpt, c, chatPressure)) {
        const preferClaude = rs.claude.daysRemaining <= rs.chatgpt.daysRemaining
        const primary = preferClaude ? 'claude' : 'chatgpt'
        const primaryName = preferClaude ? 'Claude' : 'ChatGPT'
        const altName = preferClaude ? 'ChatGPT' : 'Claude'
        const primaryDays = preferClaude ? rs.claude.daysRemaining : rs.chatgpt.daysRemaining
        const altDays = preferClaude ? rs.chatgpt.daysRemaining : rs.claude.daysRemaining
        return {
          primary,
          reason: `${primaryName} resets in ${primaryDays}d vs ${altName}'s ${altDays}d — work tasks justify spending ${primaryName} now.${resetNote(rs[primary])}`,
          alts: [preferClaude ? 'chatgpt if task is less critical' : 'claude for critical work only'],
        }
      }
      return {
        primary: 'claude',
        reason: `Claude loaded but work tasks justify the quota spend — absolute priority.${rs ? resetNote(rs.claude) : ''}`,
        alts: ['chatgpt if task is less critical'],
      }
    }
    return {
      primary: 'chatgpt',
      reason: `Claude nearly exhausted — ChatGPT for non-urgent work tasks.${rs ? resetNote(rs.chatgpt) : ''}`,
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
