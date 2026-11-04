// SurplusNotice (feature 006, T036): tells the user which service has quota that would expire unused,
// which waiting idea is suggested for it and why, and lets them start it by hand. Pure rendering of an
// `Evaluation` (contracts/evaluation.md); it never launches anything and never decides anything.
//
// Props:
//   evaluation       Evaluation | null | undefined  result of evaluateSurplus (null/undefined renders nothing)
//   ideas            Idea[]                         all ideas, used to resolve candidate and skipped idea ids
//   services         Service[]                      runtime providers (name, color and tool lookup by id)
//   onMarkLaunched   (ideaId, serviceId) => {ok, error?} | void
//                                                   called after the inline two-step confirmation
//                                                   (hook action markLaunchedManually)
//   onConfirmQuotas  (serviceId) => void            "values are still current" action, shown when the
//                                                   quota data is stale (FR-031); button hidden if absent
//   lease            runner lease payload | null    optional, T059, display only: designated device name,
//                                                   heartbeat age, running status and an informational
//                                                   "approved on runner" marker. Never an authorisation.
//   now              Date                           optional, defaults to the render time (heartbeat age only)
//
// Per service: rationale (the evaluation reason), the suggested idea, a preview of what would launch now
// (FR-010), expandable rule outcomes with inputs (FR-009), skipped ideas, a stale-data prompt, a copyable
// manual instruction (FR-011) and "Mark as launched manually".
import { useMemo, useRef, useState } from 'react'
import { buildManualInstruction } from '../surplus/instruction.js'
import { APPROVAL_INFO_ONLY, describeLease, isApprovedOnRunner } from '../surplus/runnerState.js'
import styles from './SurplusNotice.module.css'

const round1 = (n) => Math.round(n * 10) / 10
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v)

const fmtPct = (v) => (isNumber(v) ? `${round1(v)}%` : 'unknown')
const fmtHours = (v) => (isNumber(v) ? `${round1(v)} h ago` : 'never confirmed')
const fmtDays = (v) => (isNumber(v) ? `${v} d` : 'unknown')

// Inputs shown for FR-009, in a fixed order. Missing keys are skipped, null values read "unknown".
function inputRows(inputs) {
  if (!inputs) return []
  const rows = [
    ['Reset', inputs.nextResetDate ? `${inputs.nextResetDate} (in ${fmtDays(inputs.daysToReset)})` : 'not set'],
    ['Weekly remaining', fmtPct(inputs.weeklyRemainingPct)],
    ['Weekly data confirmed', fmtHours(inputs.weeklyAgeHours)],
    ['Session remaining', fmtPct(inputs.sessionRemainingPct)],
    ['Session data confirmed', fmtHours(inputs.sessionAgeHours)],
    ['Reserve kept', fmtPct(inputs.reservePct)],
    ['Window before reset', fmtDays(inputs.windowDays)],
  ]
  if (isNumber(inputs.freshnessHours)) rows.push(['Weekly freshness limit', `${round1(inputs.freshnessHours)} h`])
  if (isNumber(inputs.sessionMaxAgeHours)) rows.push(['Session freshness limit', `${round1(inputs.sessionMaxAgeHours)} h`])
  if (isNumber(inputs.sessionMinRoomPct)) rows.push(['Session minimum room', fmtPct(inputs.sessionMinRoomPct)])
  if (isNumber(inputs.maxRunMinutes)) rows.push(['Maximum run length', `${round1(inputs.maxRunMinutes)} min`])
  return rows
}

// Stale when the weekly rule R3 fails, or the session reading is missing or past its limit.
function staleProblems(result) {
  const problems = []
  const r3 = result.rules?.find((r) => r.id === 'R3')
  if (r3 && !r3.pass) problems.push(r3.detail)
  const i = result.inputs ?? {}
  const sessionStale = !isNumber(i.sessionAgeHours) || (isNumber(i.sessionMaxAgeHours) && i.sessionAgeHours > i.sessionMaxAgeHours)
  const r5 = result.rules?.find((r) => r.id === 'R5')
  if (r5 && !r5.pass && sessionStale) problems.push(r5.detail)
  return problems
}

function RuleList({ rules }) {
  return (
    <ul className={styles.ruleList}>
      {rules.map((rule) => (
        <li key={rule.id} className={styles.rule}>
          <span className={`${styles.ruleBadge} ${rule.pass ? styles.pass : styles.fail}`}>
            {rule.id} {rule.pass ? 'pass' : 'fail'}
          </span>
          <span className={styles.ruleDetail}>{rule.detail}</span>
        </li>
      ))}
    </ul>
  )
}

function InstructionBlock({ text, serviceName }) {
  const preRef = useRef(null)
  const [feedback, setFeedback] = useState('')

  const selectText = () => {
    const node = preRef.current
    if (!node || typeof window === 'undefined' || !window.getSelection) return false
    const range = document.createRange()
    range.selectNodeContents(node)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  }

  const fallback = () => {
    selectText()
    setFeedback('Copy is not available here. The instruction is selected: copy it with your keyboard.')
  }

  const copy = async () => {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      fallback()
      return
    }
    try {
      await clipboard.writeText(text)
      setFeedback('Instruction copied.')
    } catch {
      fallback()
    }
  }

  return (
    <div className={styles.instruction}>
      <div className={styles.instructionHead}>
        <span className={styles.label}>Manual instruction for {serviceName}</span>
        <button type="button" className={styles.button} onClick={copy}>
          Copy instruction
        </button>
      </div>
      <pre ref={preRef} className={styles.pre} tabIndex={0} aria-label={`Instruction to start the idea on ${serviceName}`}>
        {text}
      </pre>
      <p className={styles.feedback} role="status" aria-live="polite">
        {feedback}
      </p>
    </div>
  )
}

function MarkLaunched({ idea, serviceId, serviceName, onMarkLaunched }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  const confirm = () => {
    setError('')
    let result
    try {
      result = onMarkLaunched(idea.id, serviceId)
    } catch {
      result = { ok: false, error: { message: 'Could not save the change.' } }
    }
    if (result && result.ok === false) {
      setError(result.error?.message || 'Could not mark the idea as launched.')
      return
    }
    setConfirming(false)
  }

  if (typeof onMarkLaunched !== 'function') return null

  if (!confirming) {
    return (
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={() => setConfirming(true)}>
          Mark as launched manually
        </button>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    )
  }

  return (
    <div className={styles.confirm} role="group" aria-label="Confirm manual launch">
      <p className={styles.confirmText}>
        Confirm you started this idea on {serviceName} yourself? Its status will change to launched.
      </p>
      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.primaryButton}`} onClick={confirm}>
          Yes, I launched it
        </button>
        <button type="button" className={styles.button} onClick={() => { setConfirming(false); setError('') }}>
          Cancel
        </button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  )
}

// T059: runner state for one service, display only (FR-013). The marker is never an authorisation:
// the prompt on the runner device is the only approval.
function RunnerMarkers({ runnerInfo, runningIdea, suggestedIdea, lease }) {
  if (!runnerInfo) return null
  const approved = suggestedIdea ? isApprovedOnRunner(lease, suggestedIdea) : false
  const awaiting = suggestedIdea && suggestedIdea.approvalRequested && !approved
  return (
    <div className={styles.runnerBlock}>
      <p className={styles.meta}>{runnerInfo.summary}</p>
      {runningIdea && (
        <p className={styles.runnerRunning} role="status">
          <span className={`${styles.ruleBadge} ${styles.fail}`}>Running</span>{' '}
          {runningIdea.text} on {runnerInfo.deviceName}
        </p>
      )}
      {approved && (
        <p className={styles.meta} title={APPROVAL_INFO_ONLY}>
          <span className={`${styles.ruleBadge} ${styles.pass}`}>Approved on runner</span>{' '}
          Suggested idea. {APPROVAL_INFO_ONLY}
        </p>
      )}
      {awaiting && (
        <p className={styles.meta} title={APPROVAL_INFO_ONLY}>
          <span className={`${styles.ruleBadge} ${styles.fail}`}>Awaiting approval on the runner</span>{' '}
          Suggested idea. {APPROVAL_INFO_ONLY}
        </p>
      )}
    </div>
  )
}

function ServiceSection({ result, service, ideaById, selected, onMarkLaunched, onConfirmQuotas, lease, runnerInfo, ideas }) {
  const name = service?.name ?? result.serviceId
  const headingId = `surplus-${result.serviceId}-title`
  const candidate = result.eligible ? result.candidate : null
  const idea = candidate ? ideaById.get(candidate.ideaId) : null
  const surplusOn = result.rules?.find((r) => r.id === 'R1')?.pass === true
  const resetOk = result.rules?.find((r) => r.id === 'R2')?.pass === true
  const stale = surplusOn && resetOk ? staleProblems(result) : []

  const instruction = useMemo(() => {
    if (!idea) return { text: null, error: null }
    try {
      return { text: buildManualInstruction(idea, service), error: null }
    } catch (e) {
      return { text: null, error: e instanceof Error ? e.message : 'No instruction available.' }
    }
  }, [idea, service])

  const runningIdea = runnerInfo
    ? ideas.find((i) => i.status === 'running' && i.serviceId === result.serviceId) ?? null
    : null

  const skipped = (result.skipped ?? []).map((s) => ({ ...s, text: ideaById.get(s.ideaId)?.text ?? s.ideaId }))
  const rows = inputRows(result.inputs)

  const body = (
    <>
      {candidate && (
        <div className={styles.suggestion}>
          <span className={styles.label}>Suggested idea</span>
          <p className={styles.ideaText}>{idea ? idea.text : `Idea ${candidate.ideaId} (not found in the queue)`}</p>
          <p className={styles.meta}>
            Size {candidate.size}, about {fmtPct(candidate.costPct)} of the weekly quota
          </p>
          <p className={styles.preview}>
            <strong>Preview, nothing is launched:</strong> if you started a run now it would be this idea on {name}.
            {' '}{candidate.reason}.
          </p>
        </div>
      )}

      {stale.length > 0 && (
        <div className={styles.stale} role="group" aria-label={`Quota data for ${name} is stale`}>
          <p className={styles.staleText}>
            <strong>Quota data is stale, so no suggestion is made for {name}.</strong>{' '}
            {stale.join('; ')}.
          </p>
          {typeof onConfirmQuotas === 'function' ? (
            <button type="button" className={styles.button} onClick={() => onConfirmQuotas(result.serviceId)}>
              Confirm values are still current
            </button>
          ) : (
            <p className={styles.meta}>Update the quota values on the service card to refresh them.</p>
          )}
        </div>
      )}

      {candidate && instruction.text && (
        <>
          <InstructionBlock text={instruction.text} serviceName={name} />
          {idea && (
            <MarkLaunched idea={idea} serviceId={result.serviceId} serviceName={name} onMarkLaunched={onMarkLaunched} />
          )}
        </>
      )}
      {candidate && instruction.error && (
        <p className={styles.error} role="alert">No manual instruction available: {instruction.error}</p>
      )}

      <details className={styles.details}>
        <summary>Why: rule outcomes and inputs</summary>
        <RuleList rules={result.rules ?? []} />
        {rows.length > 0 && (
          <dl className={styles.inputs}>
            {rows.map(([k, v]) => (
              <div key={k} className={styles.inputRow}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {skipped.length > 0 && (
          <>
            <span className={styles.label}>Skipped ideas</span>
            <ul className={styles.skipList}>
              {skipped.map((s) => (
                <li key={s.ideaId}>
                  <span className={styles.skipText}>{s.text}</span>
                  <span className={styles.meta}> {s.reason}{s.detail ? `: ${s.detail}` : ''}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </>
  )

  return (
    <section className={`${styles.service} ${selected ? styles.selected : ''}`} aria-labelledby={headingId}>
      <header className={styles.serviceHead}>
        <span className={styles.dot} style={service?.color ? { background: service.color } : undefined} aria-hidden="true" />
        <h3 id={headingId} className={styles.serviceName}>{name}</h3>
        <span className={`${styles.badge} ${result.eligible ? styles.badgeOn : styles.badgeOff}`}>
          {selected ? 'Suggested now' : result.eligible ? 'Eligible' : 'Not eligible'}
        </span>
      </header>
      <RunnerMarkers runnerInfo={runnerInfo} lease={lease} suggestedIdea={idea} runningIdea={runningIdea} />
      <p className={styles.reason}>{result.reason}</p>
      {body}
    </section>
  )
}

export default function SurplusNotice({ evaluation, ideas, services, onMarkLaunched, onConfirmQuotas, lease = null, now }) {
  const ideaList = useMemo(() => (Array.isArray(ideas) ? ideas : []), [ideas])
  const runnerInfo = describeLease(lease, now ?? new Date())
  const ideaById = useMemo(() => new Map((Array.isArray(ideas) ? ideas : []).map((i) => [i.id, i])), [ideas])
  const serviceById = useMemo(() => new Map((Array.isArray(services) ? services : []).map((s) => [s.id, s])), [services])

  const results = useMemo(() => {
    const list = Array.isArray(evaluation?.services) ? evaluation.services : []
    const rank = (r) => (r.serviceId === evaluation?.selected?.serviceId ? 0 : r.eligible ? 1 : 2)
    return list.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r)
  }, [evaluation])

  if (!evaluation) return null

  const selected = evaluation.selected
  const selectedService = selected ? serviceById.get(selected.serviceId)?.name ?? selected.serviceId : null
  const selectedIdea = selected ? ideaById.get(selected.ideaId) : null

  return (
    <section className={styles.notice} aria-labelledby="surplus-notice-title">
      <div className={styles.header}>
        <div className={styles.kicker}>Surplus</div>
        <h2 id="surplus-notice-title" className={styles.title}>
          {selected ? `Quota on ${selectedService} would expire unused` : 'No surplus suggestion right now'}
        </h2>
        <p className={styles.summary} role="status">
          {selected
            ? `Preview: starting a run now would launch ${selectedIdea ? `"${selectedIdea.text}"` : `idea ${selected.ideaId}`} on ${selectedService}. Nothing is launched until you do it yourself.`
            : results.length === 0
              ? evaluation.reason || 'No service supports surplus runs.'
              : 'Nothing would launch now. The reason for each service is below.'}
        </p>
      </div>
      {results.map((result) => (
        <ServiceSection
          key={result.serviceId}
          result={result}
          service={serviceById.get(result.serviceId)}
          ideaById={ideaById}
          selected={selected?.serviceId === result.serviceId}
          onMarkLaunched={onMarkLaunched}
          onConfirmQuotas={onConfirmQuotas}
          lease={lease}
          runnerInfo={runnerInfo}
          ideas={ideaList}
        />
      ))}
    </section>
  )
}
