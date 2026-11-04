import { useMemo, useState } from 'react'
import { describeRunFailure, parseDiff, reviewState, sortRunsNewestFirst } from '../surplus/runs'
import styles from './RunReview.module.css'

// Run review (feature 006, US4). Output and proposed changes are drafts: they are shown as plain text
// (React text nodes, never HTML) and nothing here applies them anywhere. A decision only updates the
// idea through onDecision(ideaId, 'accepted' | 'discarded' | 'requeued'); run records stay read-only.

const STATUS_LABELS = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  needs_input: 'Needs input',
  interrupted: 'Interrupted',
}

const STATUS_CLASS = {
  completed: 'statusOk',
  running: 'statusNeutral',
  failed: 'statusBad',
  interrupted: 'statusWarn',
  needs_input: 'statusWarn',
}

const DECISION_LABELS = { accepted: 'Accepted', discarded: 'Discarded', requeued: 'Re-queued' }

const ACTION_LABELS = { accepted: 'Accept', discarded: 'Discard', requeued: 'Re-queue' }

const CONFIRM_TEXT = {
  discarded: 'Discard this result? The idea is archived. The run record is kept.',
}

const DIFF_CLASS = { add: 'diffAdd', del: 'diffDel', hunk: 'diffHunk', meta: 'diffMeta', context: 'diffContext' }

export function formatTime(iso) {
  if (typeof iso !== 'string') return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function serviceName(serviceId, services) {
  return services.find((s) => s.id === serviceId)?.name ?? serviceId
}

function ideaTitle(run, idea) {
  const text = idea?.text ?? run.ideaSnapshot?.text ?? run.ideaId
  return text.length > 90 ? `${text.slice(0, 87)}...` : text
}

function inputsReason(decisionInputs) {
  return decisionInputs && typeof decisionInputs.reason === 'string' ? decisionInputs.reason : null
}

function DecisionActions({ run, idea, state, onDecision }) {
  const [confirming, setConfirming] = useState(null)

  if (state.decided) {
    return (
      <p className={styles.decided} role="status">
        Decision: {DECISION_LABELS[state.decision] ?? state.decision}. Nothing outside Kairos was changed.
      </p>
    )
  }
  if (state.actions.length === 0) {
    return <p className={styles.muted}>No decision is pending for this run.</p>
  }

  const choose = (decision) => {
    if (CONFIRM_TEXT[decision]) setConfirming(decision)
    else onDecision?.(idea.id, decision)
  }

  return (
    <div className={styles.actions}>
      {confirming ? (
        <div className={styles.confirm} role="group" aria-label="Confirm decision">
          <p className={styles.confirmText}>{CONFIRM_TEXT[confirming]}</p>
          <button
            type="button"
            className={`${styles.button} ${styles.danger}`}
            onClick={() => {
              setConfirming(null)
              onDecision?.(idea.id, confirming)
            }}
          >
            Confirm {ACTION_LABELS[confirming].toLowerCase()}
          </button>
          <button type="button" className={styles.button} onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className={styles.buttons} role="group" aria-label={`Decision for run ${run.id}`}>
          {state.actions.map((decision) => (
            <button
              key={decision}
              type="button"
              className={`${styles.button} ${decision === 'accepted' ? styles.primary : ''}`}
              onClick={() => choose(decision)}
            >
              {ACTION_LABELS[decision]}
            </button>
          ))}
        </div>
      )}
      <p className={styles.muted}>
        {state.actions.includes('accepted')
          ? 'Accepting only marks the result as reviewed. Kairos never applies it for you.'
          : 'Re-queue puts the idea back in the queue so it can run again.'}
      </p>
    </div>
  )
}

function Diff({ proposal }) {
  const lines = useMemo(() => parseDiff(proposal.diff), [proposal.diff])
  return (
    <section className={styles.block} aria-label="Proposed changes (draft)">
      <h4 className={styles.blockTitle}>
        Proposed changes <span className={styles.draftTag}>Draft, not applied</span>
      </h4>
      <p className={styles.muted}>
        {proposal.files} file{proposal.files === 1 ? '' : 's'} changed in the runner copy of the folder. Your
        original folder was not modified.
        {proposal.truncated ? ' The diff was cut at its size limit.' : ''}
      </p>
      {lines.length === 0 ? (
        <p className={styles.muted}>The diff is empty.</p>
      ) : (
        <pre className={styles.diff} tabIndex={0}>
          {lines.map((line, index) => (
            <span key={index} className={`${styles.diffLine} ${styles[DIFF_CLASS[line.kind]]}`}>
              {line.text}
              {'\n'}
            </span>
          ))}
        </pre>
      )}
    </section>
  )
}

function RunDetail({ run, idea, onDecision, services }) {
  const failure = describeRunFailure(run)
  const state = reviewState(run, idea)
  const reason = inputsReason(run.decisionInputs)
  const snapshot = run.ideaSnapshot

  return (
    <article className={styles.detail} aria-label={`Run ${run.id}`}>
      <header className={styles.detailHeader}>
        <h3 className={styles.detailTitle}>{idea?.text ?? snapshot?.text ?? run.ideaId}</h3>
        <span className={`${styles.status} ${styles[STATUS_CLASS[run.status] ?? 'statusNeutral']}`}>
          {STATUS_LABELS[run.status] ?? run.status}
        </span>
      </header>

      <dl className={styles.facts}>
        <div>
          <dt>Service</dt>
          <dd>{serviceName(run.serviceId, services)}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{formatTime(run.startedAt)}</dd>
        </div>
        <div>
          <dt>Ended</dt>
          <dd>{run.endedAt ? formatTime(run.endedAt) : 'Still running'}</dd>
        </div>
        <div>
          <dt>Estimated quota used</dt>
          <dd>about {run.estimatedCostPct}%</dd>
        </div>
        <div>
          <dt>Working folder</dt>
          <dd className={styles.path}>{snapshot?.workingFolder ?? 'None'}</dd>
        </div>
        {run.localRunDir ? (
          <div>
            <dt>Runner copy</dt>
            <dd className={styles.path}>{run.localRunDir}</dd>
          </div>
        ) : null}
      </dl>

      {snapshot?.context ? (
        <details className={styles.details}>
          <summary>Idea context</summary>
          <pre className={styles.text}>{snapshot.context}</pre>
        </details>
      ) : null}

      {failure ? (
        <p className={styles.failure} role="alert">
          <strong>{run.status === 'interrupted' ? 'Interrupted' : 'Failed'}:</strong> {failure.message}
          {failure.code ? <span className={styles.code}> ({failure.code})</span> : null}
          {state.retriable ? ' The idea can be run again.' : ''}
        </p>
      ) : null}

      <section className={styles.block} aria-label="Output (draft)">
        <h4 className={styles.blockTitle}>
          Output <span className={styles.draftTag}>Draft, not applied</span>
        </h4>
        {run.output === '' ? (
          <p className={styles.muted}>The run produced no output.</p>
        ) : (
          <pre className={styles.text} tabIndex={0}>
            {run.output}
          </pre>
        )}
        {run.truncated ? <p className={styles.muted}>The output was cut at its size limit.</p> : null}
      </section>

      {run.proposal ? <Diff proposal={run.proposal} /> : null}

      <details className={styles.details}>
        <summary>Decision inputs (why this run started)</summary>
        {reason ? <p className={styles.reason}>{reason}</p> : null}
        <pre className={styles.text}>{JSON.stringify(run.decisionInputs, null, 2)}</pre>
      </details>

      {/* key: reset the inline confirmation when another run is opened */}
      <DecisionActions key={run.id} run={run} idea={idea} state={state} onDecision={onDecision} />
    </article>
  )
}

export default function RunReview({ runs = [], ideas = [], onDecision, services = [] }) {
  const sorted = useMemo(() => sortRunsNewestFirst(runs), [runs])
  const ideaById = useMemo(() => new Map(ideas.map((idea) => [idea.id, idea])), [ideas])
  const [selectedId, setSelectedId] = useState(null)
  const selected = sorted.find((run) => run.id === selectedId) ?? sorted[0] ?? null

  return (
    <section className={styles.panel} aria-label="Run review">
      <h2 className={styles.title}>Run review</h2>
      <p className={styles.muted}>
        Results of automatic runs. Output and proposed changes are drafts: Kairos never applies them to your files.
      </p>
      {sorted.length === 0 ? (
        <p className={styles.empty}>No automatic run yet.</p>
      ) : (
        <div className={styles.layout}>
          <ul className={styles.list} aria-label="Runs">
            {sorted.map((run) => {
              const idea = ideaById.get(run.ideaId)
              const state = reviewState(run, idea)
              const active = run.id === selected.id
              return (
                <li key={run.id}>
                  <button
                    type="button"
                    className={`${styles.row} ${active ? styles.rowActive : ''}`}
                    aria-pressed={active}
                    onClick={() => setSelectedId(run.id)}
                  >
                    <span className={styles.rowTitle}>{ideaTitle(run, idea)}</span>
                    <span className={styles.rowMeta}>
                      <span className={`${styles.status} ${styles[STATUS_CLASS[run.status] ?? 'statusNeutral']}`}>
                        {STATUS_LABELS[run.status] ?? run.status}
                      </span>
                      <span>{serviceName(run.serviceId, services)}</span>
                      <span>{formatTime(run.startedAt)}</span>
                      {state.decidable ? <span className={styles.pending}>To review</span> : null}
                      {state.decided ? <span>{DECISION_LABELS[state.decision]}</span> : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <RunDetail run={selected} idea={ideaById.get(selected.ideaId)} onDecision={onDecision}  services={services} />
        </div>
      )}
    </section>
  )
}
