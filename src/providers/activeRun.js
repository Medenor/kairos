// What a deletion or a surplus change affects while a run is in progress (FR-037, browser side).
// Pure: derived from the run records the browser already holds.

/** The running run of a provider, or null. Run records keep the persisted field name `serviceId`. */
export function activeRunFor(providerId, runs = []) {
  return runs.find((run) => run?.serviceId === providerId && run?.status === 'running') ?? null
}

/**
 * Lists for the delete confirmation: what will be removed, what is kept, and a warning when a run is
 * active. `provider` is the stored provider.
 */
export function describeDeletion(provider, runs = []) {
  const quotaCount = provider.quotas?.length ?? 0
  const willRemove = [
    `${quotaCount} quota${quotaCount === 1 ? '' : 's'} with their readings`,
    'the reset date',
    ...(provider.surplus ? ['its surplus settings'] : []),
  ]
  const willKeep = ['weekly history, marked as removed', 'past run and cycle records, shown with this name as removed']
  const run = activeRunFor(provider.id, runs)
  return {
    willRemove,
    willKeep,
    runWarning: run
      ? `A run is in progress for ${provider.name}. It will be stopped: partial output is kept and the idea goes back to waiting.`
      : null,
  }
}
