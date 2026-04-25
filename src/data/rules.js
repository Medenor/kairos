// Routing rules — pure functions that take quota state and return a recommendation.
// state shape: { [serviceId]: { [quotaId]: number } }
//
// Each rule returns: { primary: serviceId, reason: string, alts: string[] }

const SERVICE_LABELS = {
  claude: 'Claude',
  copilot: 'Copilot',
  chatgpt: 'ChatGPT',
}

// Returns true when both services have a valid daysRemaining and their
// quota pressures are within the comparable-pressure band (≤ 15 pts).
// Overdue services (daysRemaining < 0) are excluded — they have an unpredictable
// reset horizon and should not be treated as tiebreaker candidates.
function resetTiebreaker(sigA, sigB, pressureA, pressureB) {
  if (!sigA || !sigB) return false
  if (sigA.daysRemaining === null || sigB.daysRemaining === null) return false
  if (sigA.daysRemaining < 0 || sigB.daysRemaining < 0) return false
  return Math.abs(pressureA - pressureB) <= 15
}

// Returns a note to append when the selected service has a due/overdue reset,
// or when a reset is imminent (≤ 2 days) and quota should be spent before it refreshes.
function resetNote(signal) {
  if (!signal) return ''
  if (signal.state === 'due') return ' Reset due today — your quota may have already refreshed.'
  if (signal.state === 'overdue') return ' Reset overdue — consider logging the new reset date.'
  if (signal.state === 'countdown' && signal.daysRemaining <= 2)
    return ` Resets in ${signal.daysRemaining}d — spend it now before quota refreshes.`
  return ''
}

// Picks the service that resets sooner (spend it before it expires).
// Returns { primary, alt, primaryDays, altDays, primaryLabel, altLabel }.
function pickShorterReset(idA, idB, rs) {
  const primary = rs[idA].daysRemaining <= rs[idB].daysRemaining ? idA : idB
  const alt = primary === idA ? idB : idA
  return {
    primary,
    alt,
    primaryDays: rs[primary].daysRemaining,
    altDays: rs[alt].daysRemaining,
    primaryLabel: SERVICE_LABELS[primary],
    altLabel: SERVICE_LABELS[alt],
  }
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
        const { primary, primaryDays, altLabel, altDays, primaryLabel } = pickShorterReset('copilot', 'chatgpt', rs)
        return {
          primary,
          reason: `Claude blocked. ${primaryLabel} resets in ${primaryDays}d vs ${altLabel}'s ${altDays}d — spend it now.${resetNote(rs[primary])}`,
          alts: [primary === 'copilot' ? 'chatgpt (Codex if available)' : 'copilot'],
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
        const { primary, primaryDays, altLabel, altDays, primaryLabel } = pickShorterReset('claude', 'copilot', rs)
        return {
          primary,
          reason: `${primaryLabel} under pressure — but resets in ${primaryDays}d vs ${altLabel}'s ${altDays}d. Spend ${primaryLabel} now.${resetNote(rs[primary])}`,
          alts: [primary === 'claude' ? 'copilot for IDE completion in parallel' : 'claude for critical blocks only'],
        }
      }
      return {
        primary: 'copilot',
        reason: `Claude under pressure (weekly ${c}%, 5h slot ${c5h}%). Copilot (per-request) to preserve Claude for work tasks.${rs ? resetNote(rs.copilot) : ''}`,
        alts: ['claude for critical blocks only'],
      }
    }
    // Claude nearly exhausted — if reset is very close, nudge the user to wait for critical tasks.
    const claudeNearReset = rs?.claude?.state === 'countdown' && rs.claude.daysRemaining <= 2
    return {
      primary: 'chatgpt',
      reason: `Claude nearly exhausted — redirect coding to ChatGPT or Copilot.${claudeNearReset ? ` Claude resets in ${rs.claude.daysRemaining}d — consider waiting for critical tasks.` : ''}${rs ? resetNote(rs.chatgpt) : ''}`,
      alts: ['copilot (IDE)'],
    }
  },

  coding_light: (s, rs) => {
    const c = s.claude.weekly
    const cop = s.copilot.monthly

    if (cop < 50) {
      const copNearReset = rs?.copilot?.state === 'countdown' && rs.copilot.daysRemaining <= 2
      return {
        primary: 'copilot',
        reason: `Copilot underused this month (per-request, not per-token). Best for light coding — saves Claude quota.${copNearReset ? ` Copilot resets in ${rs.copilot.daysRemaining}d — good timing to use it up before the reset.` : ''}${rs ? resetNote(rs.copilot) : ''}`,
        alts: [],
      }
    }
    if (c < 50) {
      if (rs && resetTiebreaker(rs.copilot, rs.claude, cop, c)) {
        const { primary, primaryDays, altLabel, altDays, primaryLabel } = pickShorterReset('copilot', 'claude', rs)
        return {
          primary,
          reason: `${primaryLabel} resets in ${primaryDays}d vs ${altLabel}'s ${altDays}d — spend ${primaryLabel} now for light coding.${resetNote(rs[primary])}`,
          alts: [primary === 'copilot' ? 'claude for context-heavy tasks' : 'copilot for IDE completion'],
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

    if (claudeBlocked(s)) {
      const claudeEta =
        rs?.claude?.state === 'countdown' || rs?.claude?.state === 'due'
          ? ` Claude resets in ${rs.claude.daysRemaining}d.`
          : ''
      return {
        primary: 'chatgpt',
        reason: `Claude blocked — ChatGPT as fallback for work tasks.${claudeEta} Wait for reset for critical tasks.${rs ? resetNote(rs.chatgpt) : ''}`,
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
        const { primary, primaryDays, altLabel, altDays, primaryLabel } = pickShorterReset('claude', 'chatgpt', rs)
        return {
          primary,
          reason: `${primaryLabel} resets in ${primaryDays}d vs ${altLabel}'s ${altDays}d — work tasks justify spending ${primaryLabel} now.${resetNote(rs[primary])}`,
          alts: [primary === 'claude' ? 'chatgpt if task is less critical' : 'claude for critical work only'],
        }
      }
      return {
        primary: 'claude',
        reason: `Claude loaded but work tasks justify the quota spend — absolute priority.${rs ? resetNote(rs.claude) : ''}`,
        alts: ['chatgpt if task is less critical'],
      }
    }
    // Claude nearly exhausted — if reset is very close, nudge the user to consider waiting.
    const claudeNearReset = rs?.claude?.state === 'countdown' && rs.claude.daysRemaining <= 2
    return {
      primary: 'chatgpt',
      reason: `Claude nearly exhausted — ChatGPT for non-urgent work tasks.${claudeNearReset ? ` Claude resets in ${rs.claude.daysRemaining}d — consider waiting for critical work.` : ''}${rs ? resetNote(rs.chatgpt) : ''}`,
      alts: ['wait for Claude reset'],
    }
  },

  daily_chat: (s, rs) => {
    const c = s.claude.weekly

    // Preserve upcoming Claude refresh: if Claude resets in ≤ 2 days, redirect
    // daily chat to ChatGPT now so the refreshed quota is available for work tasks.
    if (rs?.claude?.state === 'countdown' && rs.claude.daysRemaining <= 2) {
      return {
        primary: 'chatgpt',
        reason: `Claude resets in ${rs.claude.daysRemaining}d — switch to ChatGPT now to preserve the upcoming refresh for work tasks.`,
        alts: [],
      }
    }

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

  oneshot: (s, rs) => {
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
