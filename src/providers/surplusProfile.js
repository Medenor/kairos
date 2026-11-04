// Surplus eligibility of a provider (research D9). `SUPPORTED_TOOLS` lists terminal tools the runner
// has adapters for; it names tools, never providers. `surplusProblems` returns the unmet conditions as
// user-facing strings so the form can say exactly what is missing.

export const SUPPORTED_TOOLS = Object.freeze(['claude', 'codex'])

const PERCENT_TYPES = ['consumed_pct', 'remaining_pct']

function quotaProblem(provider, quotaId, role) {
  if (!quotaId) return `Designate the ${role} quota.`
  const quota = (provider.quotas ?? []).find((q) => q.id === quotaId)
  if (!quota) return `The ${role} quota no longer exists: designate another.`
  if (!PERCENT_TYPES.includes(quota.type)) return `The ${role} quota must be a percentage quota.`
  return null
}

export function surplusProblems(provider) {
  const profile = provider?.surplus
  if (!profile) return ['No terminal tool declared.']
  const problems = []
  if (!SUPPORTED_TOOLS.includes(profile.tool)) problems.push(`Choose a supported tool (${SUPPORTED_TOOLS.join(' or ')}).`)
  if (provider.schedule?.type !== 'weekly') problems.push('Surplus use needs a weekly reset schedule.')
  const weekly = quotaProblem(provider, profile.weeklyQuotaId, 'weekly')
  if (weekly) problems.push(weekly)
  const session = quotaProblem(provider, profile.sessionQuotaId, 'session window')
  if (session) problems.push(session)
  if (profile.weeklyQuotaId && profile.weeklyQuotaId === profile.sessionQuotaId) {
    problems.push('The weekly and session window quotas must be two different quotas.')
  }
  return problems
}

export const isSurplusEligible = (provider) => surplusProblems(provider).length === 0
