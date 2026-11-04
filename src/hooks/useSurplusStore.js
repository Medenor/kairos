// useSurplusStore: local-first idea queue, surplus policy, runs, cycles, control and runner lease
// (feature 006, T024). All logic lives in src/surplus/engine.js and src/surplus/store.js; this hook
// only injects the browser edge (localStorage, clock, ids, API client, workspace id) and exposes
// the engine's snapshot to React.
//
// Works with no workspace and no network: ideas are saved to localStorage first. When a workspace id
// exists (options.workspaceId, else getWorkspaceId()) the records are also synced as `routing_config`
// records (debounce 220 ms, pull every 3 s, full reconcile every 30 s).
//
// Usage: const surplus = useSurplusStore({ workspaceId, quotaState, services })   // all optional
//   workspaceId  string, overrides the detected workspace id
//   quotaState   quota state from useSharedQuotaState (`state`, with `__ts_*` stamps). Enables the
//                reset-cycle readings (T028) and `evaluation` (T038); without it evaluation is null
//   services     runtime providers (src/providers/runtime.js); none by default
//   now          the dashboard's shared Date (FR-038); defaults to reading the clock on each evaluation
//
// Return value (state fields come from one immutable snapshot, actions are stable):
//   ideas[]            all ideas incl. archived, sorted by priority (high first), manual order, creation
//   policy             surplus policy (defaultPolicy() until edited)
//   runs[]             run records written by the runner (read-only here)
//   cycles[]           reset-cycle readings {serviceId, resetDate, lastWeeklyRemainingPct, readAt}
//                      (recorded here when a weekly-quota stamp changes and the reset date is valid)
//   evaluation         evaluateSurplus result (mode 'preview', see src/surplus/evaluation.js) | null
//                      when no quotaState is given. Derived with useMemo, never stored: recomputed on
//                      quota, idea, run, policy or services change, on open, and every 60 s while the
//                      page is visible (also when it becomes visible again). `now` is read in the hook;
//                      folderChecks is null (the browser cannot check folders, FR-033)
//   control            {autoRunEnabled, updatedAt} | null      (record `surplus-control`)
//   autoRunEnabled     boolean shortcut for control?.autoRunEnabled === true
//   lease              runner lease payload | null (display only: heartbeat age, device name, approved map)
//   invalid[]          unusable shared records {logicalKey, kind, recordId, version, errors}
//   sharedMode         boolean, true when a workspace id is set (automatic runs need it, FR-023)
//   workspaceId        string ('' when none)
//   syncStatus         'local' | 'connecting' | 'syncing' | 'ready' | 'conflict' | 'offline' | 'error'
//   syncMessage        string
//   pendingCount       number of local changes not yet written to the shared store
//   storageOk          false when localStorage refused a write (changes live in memory only)
//   addIdea({text, context?, workingFolder?, priority?, size?, approvalRequested?}) -> {ok, idea} | {ok:false, error}
//   updateIdea(id, changes)           -> {ok, idea, approvalWithdrawn} | {ok:false, error}
//                                        changes: text, context, workingFolder, priority, size, approvalRequested, order
//   reorder(orderedIds)               -> {ok} | {ok:false, error}      ids first-to-last get order 1..n
//   archiveIdea(id)                   -> {ok, idea} | {ok:false, error}
//   deleteIdea(id)                    -> {ok, idea} | {ok:false, error} (refused while running; soft-deleted remotely)
//   requestApproval(id)               -> {ok, idea} | {ok:false, error} (a request only, never an authorisation)
//   markLaunchedManually(id, serviceId) -> {ok, idea} | {ok:false, error}
//   decideRun(ideaId, decision)       -> {ok, idea} | {ok:false, error}  decision: accepted | discarded | requeued
//   updatePolicy(policyOrUpdater)     -> {ok, policy} | {ok:false, error, errors}  (full policy, or fn(current) => policy)
//   setAutoRunEnabled(enabled)        -> {ok} | {ok:false, error}  (enabling needs shared mode)
//   stopAutoRuns()                    -> {ok}   global stop: control autoRunEnabled=false, always allowed
//   refresh()                         -> Promise  flush pending edits then full pull
//   engine             internal handle, the extension point described below (engine.commit)
//   error shape: {field, code, message}
//
// Extension point: `engine.commit(nextState)` runs a pure update as a local edit (persisted and, in
// shared mode, synced). The hook itself uses it for the cycle readings.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createSurplusEngine } from '../surplus/engine'
import { applyCycleReadings, deriveCycleReadings } from '../surplus/cycleReadings'
import { evaluateSurplus } from '../surplus/evaluation'
import { makeUuid } from '../surplus/store'
import { createRecord, deleteRecord, getWorkspaceId, syncPull, updateRecord } from '../services/sharedStateApi'

const NO_SERVICES = []
const POLL_MS = 3000
const EVALUATION_REFRESH_MS = 60000
const API = { createRecord, updateRecord, deleteRecord, syncPull }

function browserStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function detectWorkspaceId() {
  try {
    return getWorkspaceId()
  } catch {
    return ''
  }
}

export function useSurplusStore(options = {}) {
  const [engine] = useState(() =>
    createSurplusEngine({
      storage: browserStorage(),
      api: API,
      now: () => new Date(),
      newId: () => makeUuid(globalThis.crypto),
    }),
  )
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot)

  // useSharedQuotaState stores the workspace id once it is known, so keep watching when none is given.
  const [detectedWorkspaceId, setDetectedWorkspaceId] = useState(detectWorkspaceId)
  useEffect(() => {
    const timer = setInterval(() => setDetectedWorkspaceId(detectWorkspaceId()), POLL_MS)
    return () => clearInterval(timer)
  }, [])
  const workspaceId = options.workspaceId || detectedWorkspaceId

  useEffect(() => {
    engine.setWorkspace(workspaceId)
  }, [engine, workspaceId])

  useEffect(() => {
    if (!workspaceId) return undefined
    const timer = setInterval(engine.tick, POLL_MS)
    const onHide = () => engine.flush()
    window.addEventListener('pagehide', onHide)
    return () => {
      clearInterval(timer)
      window.removeEventListener('pagehide', onHide)
    }
  }, [engine, workspaceId])

  useEffect(() => () => engine.dispose(), [engine])

  const quotaState = options.quotaState ?? null
  const services = options.services ?? NO_SERVICES

  // T028: a changed weekly-quota stamp (value entered or "still current") records the cycle reading.
  // The stamps seen last live in a ref, so the effect is idempotent and never loops: committing
  // cycles changes the engine snapshot, not quotaState.
  const seenStamps = useRef(null)
  useEffect(() => {
    if (!quotaState) return
    const { readings, stamps } = deriveCycleReadings(seenStamps.current, quotaState, services, new Date())
    seenStamps.current = stamps
    if (readings.length === 0) return
    const current = engine.getState()
    const cycles = applyCycleReadings(current.cycles, readings)
    if (cycles !== current.cycles) engine.commit({ ...current, cycles })
  }, [engine, quotaState, services])

  // T038: re-evaluate every 60 s while the page is visible, and right away when it becomes visible.
  const [clockTick, setClockTick] = useState(0)
  useEffect(() => {
    let timer = null
    const stop = () => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }
    const start = () => {
      stop()
      timer = setInterval(() => setClockTick((n) => n + 1), EVALUATION_REFRESH_MS)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setClockTick((n) => n + 1)
        start()
      } else stop()
    }
    if (document.visibilityState !== 'hidden') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const { ideas, policy, runs } = snapshot
  const sharedNow = options.now ?? null
  const evaluation = useMemo(
    () => {
      void clockTick // dependency only: a tick asks for a new `now`
      return quotaState
        ? evaluateSurplus({ now: sharedNow ?? new Date(), state: quotaState, services, policy, ideas, runs, folderChecks: null, mode: 'preview' })
        : null
    },
    [quotaState, services, policy, ideas, runs, clockTick, sharedNow],
  )

  return useMemo(() => ({ ...snapshot, evaluation, ...engine.actions, engine }), [snapshot, evaluation, engine])
}
