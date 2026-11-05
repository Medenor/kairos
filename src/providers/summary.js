// Dashboard summary over the declared providers: monthly cost per currency (never summed across
// currencies) and how many providers are under pressure. Unread quotas are ignored.
import { getServicePressure } from '../utils.js'

export const PRESSURE_THRESHOLD = 75

export function summarizeProviders(providers = [], state = {}) {
  const totals = new Map()
  let underPressure = 0
  for (const provider of providers) {
    if (typeof provider.cost === 'number' && provider.cost > 0 && provider.costCurrency) {
      totals.set(provider.costCurrency, (totals.get(provider.costCurrency) ?? 0) + provider.cost)
    }
    if (getServicePressure(provider, state) >= PRESSURE_THRESHOLD) underPressure += 1
  }
  const monthlyCosts = [...totals.entries()]
    .map(([currency, total]) => ({ currency, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0))
  return { providerCount: providers.length, monthlyCosts, underPressure }
}
