import { useId, useState } from 'react'
import { DEFAULTS } from '../surplus/constants.js'
import { APPROVAL_INFO_ONLY, canRequestApproval, describeLease, isApprovedOnRunner } from '../surplus/runnerState.js'
import styles from './IdeaQueue.module.css'

const LIMIT = DEFAULTS.CONTEXT_LIMIT_CHARS

const STATUS_LABELS = {
  waiting: 'Waiting',
  launched_manually: 'Launched manually',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  needs_input: 'Needs input',
  archived: 'Archived',
}
const STATUS_TONES = {
  waiting: 'neutral',
  launched_manually: 'neutral',
  running: 'amber',
  completed: 'green',
  failed: 'red',
  needs_input: 'amber',
  archived: 'muted',
}
const PRIORITY_LABELS = { high: 'High', normal: 'Normal', low: 'Low' }
const SIZE_LABELS = { small: 'Small', medium: 'Medium', large: 'Large' }

const FOLDER_NOTE = 'checked only on the runner device'
const WITHDRAWN_NOTICE = 'Approval withdrawn: the idea changed, it must be approved again.'

function Chip({ tone = 'neutral', title, children }) {
  return <span className={`${styles.chip} ${styles[`tone_${tone}`]}`} title={title}>{children}</span>
}

// T059: runner-state chips. Display only (FR-013): the approved marker comes from the shared lease,
// which any client could write, so it never enables or triggers anything.
function RunnerChips({ idea, lease, runnerInfo }) {
  if (idea.status === 'archived') return null
  const approved = isApprovedOnRunner(lease, idea)
  const awaiting = idea.approvalRequested && !approved
  const running = idea.status === 'running' && runnerInfo
  if (!approved && !awaiting && !running) return null
  const offline = runnerInfo && !runnerInfo.online
  return (
    <>
      {running && (
        <Chip tone="amber" title={`${runnerInfo.summary}. ${APPROVAL_INFO_ONLY}`}>
          Running on {runnerInfo.deviceName}
        </Chip>
      )}
      {approved && (
        <Chip tone="green" title={APPROVAL_INFO_ONLY}>
          Approved on runner{offline ? ' (runner offline)' : ''}
          <span className={styles.visuallyHidden}>. {APPROVAL_INFO_ONLY}</span>
        </Chip>
      )}
      {awaiting && (
        <Chip tone="amber" title="Approve it in the prompt on the runner device. This page cannot approve a run.">
          Awaiting approval on the runner
        </Chip>
      )}
    </>
  )
}

function RunnerStatus({ info }) {
  if (!info) return null
  return (
    <p className={styles.runnerStatus} role="status">
      <strong>{info.summary}.</strong> {APPROVAL_INFO_ONLY}
    </p>
  )
}

function IdeaDetails({ idea }) {
  return (
    <dl className={styles.detailList}>
      <dt>Context</dt>
      <dd className={styles.pre}>{idea.context ? idea.context : 'None'}</dd>
      <dt>Working folder</dt>
      <dd>
        {idea.workingFolder ? <code className={styles.code}>{idea.workingFolder}</code> : 'None'}
        <span className={styles.note}> ({FOLDER_NOTE})</span>
      </dd>
    </dl>
  )
}

function IdeaEditForm({ idea, onSave, onCancel, error }) {
  const uid = useId()
  const [text, setText] = useState(idea.text)
  const [context, setContext] = useState(idea.context || '')
  const [workingFolder, setWorkingFolder] = useState(idea.workingFolder || '')
  const [priority, setPriority] = useState(idea.priority)
  const [size, setSize] = useState(idea.size)

  function submit(event) {
    event.preventDefault()
    const changes = {}
    if (text !== idea.text) changes.text = text
    if (context !== (idea.context || '')) changes.context = context
    if (workingFolder !== (idea.workingFolder || '')) {
      changes.workingFolder = workingFolder.trim() === '' ? null : workingFolder
    }
    if (priority !== idea.priority) changes.priority = priority
    if (size !== idea.size) changes.size = size
    onSave(changes)
  }

  const atLimit = context.length >= LIMIT

  return (
    <form className={styles.editForm} onSubmit={submit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${uid}-text`}>
          Idea text
        </label>
        <input
          id={`${uid}-text`}
          className={styles.input}
          type="text"
          value={text}
          autoComplete="off"
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${uid}-context`}>
          Context
        </label>
        <textarea
          id={`${uid}-context`}
          className={styles.textarea}
          rows={5}
          value={context}
          maxLength={LIMIT}
          aria-describedby={`${uid}-counter`}
          onChange={(event) => setContext(event.target.value)}
        />
        <p id={`${uid}-counter`} className={atLimit ? styles.counterLimit : styles.hint} aria-live="polite">
          {context.length} / {LIMIT} characters{atLimit ? ' (limit reached)' : ''}
        </p>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${uid}-folder`}>
          Working folder
        </label>
        <input
          id={`${uid}-folder`}
          className={styles.input}
          type="text"
          value={workingFolder}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${uid}-folder-hint`}
          onChange={(event) => setWorkingFolder(event.target.value)}
        />
        <p id={`${uid}-folder-hint`} className={styles.hint}>
          Typed or pasted, {FOLDER_NOTE}.
        </p>
      </div>
      <div className={styles.selectRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${uid}-priority`}>
            Priority
          </label>
          <select
            id={`${uid}-priority`}
            className={styles.select}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${uid}-size`}>
            Size
          </label>
          <select
            id={`${uid}-size`}
            className={styles.select}
            value={size}
            onChange={(event) => setSize(event.target.value)}
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </div>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" className={styles.button}>
          Save
        </button>
        <button type="button" className={styles.button} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function IdeaItem({ idea, canMoveUp, canMoveDown, actions, onMove, withdrawn, onWithdrawnSeen, lease, runnerInfo }) {
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState(null)
  const archived = idea.status === 'archived'
  const running = idea.status === 'running'

  function run(result) {
    if (result && result.ok === false) {
      setError(result.error?.message || 'The action failed.')
      return false
    }
    setError(null)
    return true
  }

  function save(changes) {
    if (Object.keys(changes).length === 0) {
      setEditing(false)
      return
    }
    const result = actions.updateIdea(idea.id, changes)
    if (run(result)) {
      setEditing(false)
      if (result.approvalWithdrawn) onWithdrawnSeen(idea.id)
    }
  }

  function remove() {
    if (run(actions.deleteIdea(idea.id))) setConfirmDelete(false)
  }

  return (
    <li className={archived ? `${styles.item} ${styles.itemArchived}` : styles.item}>
      <div className={styles.itemHead}>
        <div className={styles.itemMain}>
          <p className={styles.itemText}>{idea.text}</p>
          <div className={styles.chips}>
            <Chip tone={STATUS_TONES[idea.status] || 'neutral'}>{STATUS_LABELS[idea.status] || idea.status}</Chip>
            <Chip tone="muted">{PRIORITY_LABELS[idea.priority] || idea.priority} priority</Chip>
            <Chip tone="muted">{SIZE_LABELS[idea.size] || idea.size}</Chip>
            {idea.approvalRequested && !lease && <Chip tone="amber">Approval requested</Chip>}
            <RunnerChips idea={idea} lease={lease} runnerInfo={runnerInfo} />
          </div>
        </div>
        {!archived && (
          <div className={styles.moves} role="group" aria-label={`Reorder: ${idea.text}`}>
            <button
              type="button"
              className={styles.iconButton}
              disabled={!canMoveUp}
              aria-label={`Move up: ${idea.text}`}
              title={canMoveUp ? 'Move up' : 'Already first in its priority'}
              onClick={() => onMove(idea.id, -1)}
            >
              <span aria-hidden="true">↑</span>
            </button>
            <button
              type="button"
              className={styles.iconButton}
              disabled={!canMoveDown}
              aria-label={`Move down: ${idea.text}`}
              title={canMoveDown ? 'Move down' : 'Already last in its priority'}
              onClick={() => onMove(idea.id, 1)}
            >
              <span aria-hidden="true">↓</span>
            </button>
          </div>
        )}
      </div>
      {withdrawn && (
        <p className={styles.withdrawn} role="status">
          {WITHDRAWN_NOTICE}
        </p>
      )}

      {open && !editing && <IdeaDetails idea={idea} />}

      {editing ? (
        <IdeaEditForm idea={idea} error={error} onSave={save} onCancel={() => { setEditing(false); setError(null) }} />
      ) : (
        <>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              aria-label={`${open ? 'Hide' : 'Show'} details: ${idea.text}`}
            >
              {open ? 'Hide details' : 'Details'}
            </button>
            <button
              type="button"
              className={styles.button}
              aria-label={`Edit: ${idea.text}`}
              onClick={() => { setEditing(true); setError(null) }}
            >
              Edit
            </button>
            {canRequestApproval(idea) && (
              <button
                type="button"
                className={styles.button}
                aria-label={`Request automatic-run approval: ${idea.text}`}
                onClick={() => run(actions.requestApproval(idea.id))}
              >
                Request approval
              </button>
            )}
            {!archived && (
              <button
                type="button"
                className={styles.button}
                aria-label={`Archive: ${idea.text}`}
                onClick={() => run(actions.archiveIdea(idea.id))}
              >
                Archive
              </button>
            )}
            {confirmDelete ? (
              <span className={styles.confirm} role="group" aria-label={`Confirm deletion: ${idea.text}`}>
                <button type="button" className={`${styles.button} ${styles.danger}`} onClick={remove}>
                  Confirm delete
                </button>
                <button type="button" className={styles.button} onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                className={styles.button}
                disabled={running}
                title={running ? 'A running idea cannot be deleted' : undefined}
                aria-label={`Delete: ${idea.text}`}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </button>
            )}
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </li>
  )
}

function AwaitingApproval({ ideas }) {
  const uid = useId()
  return (
    <section className={styles.awaiting} aria-labelledby={`${uid}-title`}>
      <h3 id={`${uid}-title`} className={styles.subtitle}>
        Awaiting approval
      </h3>
      <p className={styles.hint}>
        These ideas asked for automatic runs. Approval happens on the runner device, for exactly the text, context and
        folder shown here. This list never authorises a run.
      </p>
      {ideas.length === 0 ? (
        <p className={styles.empty}>No idea is waiting for approval.</p>
      ) : (
        <ul className={styles.plainList}>
          {ideas.map((idea) => (
            <li key={idea.id} className={styles.awaitingItem}>
              <p className={styles.itemText}>{idea.text}</p>
              <IdeaDetails idea={idea} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// Props:
//   ideas[]       all ideas incl. archived, already sorted (useSurplusStore().ideas)
//   invalid[]     unusable shared records {logicalKey, kind, recordId, version, errors}
//   actions       {updateIdea, reorder, archiveIdea, deleteIdea, requestApproval} from useSurplusStore
//   lease         runner lease payload | null (optional, T059, display only): device name, heartbeat age,
//                 `approved` map shown as an informational "approved on runner" marker, never an authorisation
//   now           Date, optional (defaults to the render time): used only for the heartbeat age
export default function IdeaQueue({ ideas = [], invalid = [], actions, lease = null, now }) {
  const uid = useId()
  const [showArchived, setShowArchived] = useState(false)
  const [withdrawnIds, setWithdrawnIds] = useState(() => new Set())
  const [queueError, setQueueError] = useState(null)

  const active = ideas.filter((idea) => idea.status !== 'archived')
  const archived = ideas.filter((idea) => idea.status === 'archived')
  const awaiting = active.filter((idea) => idea.approvalRequested)
  const visible = showArchived ? archived : active
  const runnerInfo = describeLease(lease, now ?? new Date())

  function move(id, delta) {
    const index = active.findIndex((idea) => idea.id === id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= active.length) return
    const ids = active.map((idea) => idea.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    const result = actions.reorder(ids)
    setQueueError(result && result.ok === false ? result.error?.message || 'The queue could not be reordered.' : null)
  }

  function markWithdrawn(id) {
    setWithdrawnIds((previous) => new Set(previous).add(id))
  }

  return (
    <section className={styles.panel} aria-labelledby={`${uid}-title`}>
      <div className={styles.header}>
        <h2 id={`${uid}-title`} className={styles.title}>
          Idea queue
        </h2>
        <button
          type="button"
          className={styles.button}
          aria-pressed={showArchived}
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? `Show queue (${active.length})` : `Show archived (${archived.length})`}
        </button>
      </div>

      <RunnerStatus info={runnerInfo} />

      {queueError && (
        <p className={styles.error} role="alert">
          {queueError}
        </p>
      )}

      {visible.length === 0 ? (
        <p className={styles.empty}>{showArchived ? 'No archived idea.' : 'No idea in the queue yet.'}</p>
      ) : (
        <ol className={styles.list}>
          {visible.map((idea, index) => {
            const isActive = !showArchived
            const prev = isActive ? visible[index - 1] : null
            const next = isActive ? visible[index + 1] : null
            return (
              <IdeaItem
                key={idea.id}
                idea={idea}
                canMoveUp={Boolean(prev) && prev.priority === idea.priority}
                canMoveDown={Boolean(next) && next.priority === idea.priority}
                actions={actions}
                onMove={move}
                withdrawn={withdrawnIds.has(idea.id)}
                onWithdrawnSeen={markWithdrawn}
                lease={lease}
                runnerInfo={runnerInfo}
              />
            )
          })}
        </ol>
      )}

      {!showArchived && <AwaitingApproval ideas={awaiting} />}

      {invalid.length > 0 && (
        <section className={styles.invalidBlock} aria-label="Invalid records">
          <h3 className={styles.subtitle}>Invalid records</h3>
          <ul className={styles.plainList}>
            {invalid.map((entry) => (
              <li key={`${entry.logicalKey}:${entry.recordId}`} className={styles.invalidItem}>
                <strong>Invalid record</strong> <code className={styles.code}>{entry.logicalKey}</code>
                {Array.isArray(entry.errors) && entry.errors.length > 0 && (
                  <ul className={styles.invalidErrors}>
                    {entry.errors.map((problem, i) => (
                      <li key={i}>
                        {typeof problem === 'string'
                          ? problem
                          : [problem.field, problem.message].filter(Boolean).join(': ')}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
