import { useId, useRef, useState } from 'react'
import { DEFAULTS } from '../surplus/constants.js'
import styles from './IdeaCapture.module.css'

const LIMIT = DEFAULTS.CONTEXT_LIMIT_CHARS

export const SHARED_STORE_NOTICE =
  'Shared mode is on: ideas are stored in the shared store and can be read by any device on the local network, because shared-store access is not authenticated. Do not put secrets in an idea.'

// Props:
//   onAdd(input) -> {ok, idea} | {ok:false, error:{field, code, message}}   (useSurplusStore().addIdea)
//   sharedMode   boolean, shows the shared-store visibility notice (FR-024)
export default function IdeaCapture({ onAdd, sharedMode = false }) {
  const uid = useId()
  const textRef = useRef(null)
  const [text, setText] = useState('')
  const [context, setContext] = useState('')
  const [workingFolder, setWorkingFolder] = useState('')
  const [priority, setPriority] = useState('normal')
  const [size, setSize] = useState('medium')
  const [approvalRequested, setApprovalRequested] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState(null)
  const [added, setAdded] = useState(false)

  const atLimit = context.length >= LIMIT
  const detailsId = `${uid}-details`

  function reset() {
    setText('')
    setContext('')
    setWorkingFolder('')
    setPriority('normal')
    setSize('medium')
    setApprovalRequested(false)
  }

  function submit(event) {
    event.preventDefault()
    const result = onAdd({
      text,
      context,
      workingFolder: workingFolder.trim() === '' ? null : workingFolder,
      priority,
      size,
      approvalRequested,
    })
    if (result?.ok) {
      reset()
      setError(null)
      setAdded(true)
      textRef.current?.focus()
    } else {
      setAdded(false)
      setError(result?.error?.message || 'The idea could not be saved.')
    }
  }

  return (
    <section className={styles.panel} aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} className={styles.title}>
        New idea
      </h2>

      {sharedMode && (
        <p className={styles.sharedNotice} role="note">
          {SHARED_STORE_NOTICE}
        </p>
      )}

      <form className={styles.form} onSubmit={submit}>
        <div className={styles.mainRow}>
          <label className={styles.srOnly} htmlFor={`${uid}-text`}>
            Idea text
          </label>
          <input
            id={`${uid}-text`}
            ref={textRef}
            className={styles.textInput}
            type="text"
            value={text}
            placeholder="Write an idea and press Enter"
            autoComplete="off"
            onChange={(event) => {
              setText(event.target.value)
              setAdded(false)
            }}
          />
          <button type="submit" className={styles.addButton}>
            Add
          </button>
        </div>

        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? 'Hide details' : 'Add context, folder, priority'}
        </button>

        <div id={detailsId} className={styles.details} hidden={!expanded}>
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
              placeholder="Goals, constraints, links, expected outcome"
              aria-describedby={`${uid}-counter`}
              onChange={(event) => setContext(event.target.value)}
            />
            <p
              id={`${uid}-counter`}
              className={atLimit ? styles.counterLimit : styles.counter}
              aria-live="polite"
            >
              {context.length} / {LIMIT} characters
              {atLimit ? ` (limit reached, nothing more can be added)` : ''}
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
              placeholder="/path/to/project or relative/path"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${uid}-folder-hint`}
              onChange={(event) => setWorkingFolder(event.target.value)}
            />
            <p id={`${uid}-folder-hint`} className={styles.hint}>
              Typed or pasted. Interpreted and checked only on the runner device.
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

          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={approvalRequested}
              onChange={(event) => setApprovalRequested(event.target.checked)}
            />
            <span>Request automatic-run approval (a request only; you approve it on the runner device)</span>
          </label>
        </div>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {added && !error && (
          <p className={styles.success} role="status">
            Idea added, waiting in the queue.
          </p>
        )}
      </form>
    </section>
  )
}
