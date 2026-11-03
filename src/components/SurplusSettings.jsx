import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULTS, SUPPORTED_SERVICE_IDS } from '../surplus/constants'
import { autoRunBlockedReason, setServiceSurplus } from '../surplus/policy'
import styles from './SurplusSettings.module.css'

// Surplus settings (feature 006, T037). Pure view over the policy: every edit builds a new full
// policy through `onUpdatePolicy((current) => next)` and shows the validation errors it returns.
//
// Props:
//   policy          surplus policy (see src/surplus/policy.js)
//   onUpdatePolicy  (policyOrUpdater) => {ok, errors?: [{path, message}], error?: {message}}
//   services        SERVICES array (only used for display names)
//   sharedMode      boolean, true when a workspace id is set (automatic runs need it, FR-023)
//   autoRunEnabled  boolean, the global switch `surplus-control` (useSurplusStore().autoRunEnabled)
//   stopIssued      boolean, true only when a stop was issued (control record autoRunEnabled === false)
//   onStopAutoRuns  () => void, the global stop (useSurplusStore().stopAutoRuns), always available (SC-007)
//   onSetAutoRunEnabled  optional (bool) => void, shows "Resume" after a stop (useSurplusStore().setAutoRunEnabled)
//
// T058: per-service "Automatic runs" toggle (needs declared protected hours and shared mode), a
// disclosure dialog before the first activation (FR-012) that sets `disclosuresAckAt` in the same
// policy update, and an always-visible global stop.

const DAYS = [
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
  { value: 0, short: 'Sun', long: 'Sunday' },
]

const SIZES = [
  { key: 'small', label: 'Small' },
  { key: 'medium', label: 'Medium' },
  { key: 'large', label: 'Large' },
]

const NEW_RANGE = { days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' }

// Number input that keeps what the user types until blur, so intermediate values (empty, "1.")
// never reach the policy; only parsable numbers are committed.
function NumberField({ label, value, onCommit, min, max, step = 1, suffix }) {
  const id = useId()
  const [draft, setDraft] = useState(null)
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={id}>{label}</label>
      <div className={styles.inputWrap}>
        <input
          id={id}
          className={styles.numInput}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={draft ?? String(value)}
          onChange={(e) => {
            setDraft(e.target.value)
            const n = Number(e.target.value)
            if (e.target.value.trim() !== '' && Number.isFinite(n)) onCommit(n)
          }}
          onBlur={() => setDraft(null)}
        />
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
    </div>
  )
}

const DISCLOSURES = (name) => [
  `When a run starts, the idea text, its context information and a disposable copy of its working folder are sent to ${name}, the provider you chose for it.`,
  'While access to the shared store is unauthenticated, anyone on your local network can read the shared ideas.',
  'Provider rules on automated usage of subscriptions can change. You are responsible for staying within the rules of each provider.',
  'Each idea still needs your approval on the runner device. Nothing in this page approves a run, and you can stop all automatic runs at any time.',
]

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])'

// Accessible modal (no window.confirm): focus moves into the dialog, Tab is kept inside, Escape
// cancels, and focus returns to the control that opened it.
function DisclosureDialog({ serviceName, onConfirm, onCancel }) {
  const titleId = useId()
  const descId = useId()
  const checkId = useId()
  const dialogRef = useRef(null)
  const cancelRef = useRef(onCancel)
  const [understood, setUnderstood] = useState(false)

  useEffect(() => {
    cancelRef.current = onCancel
  })

  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.focus()
    return () => {
      if (previous && typeof previous.focus === 'function' && previous.isConnected) previous.focus()
    }
  }, [])

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      cancelRef.current()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const items = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE))
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h3 id={titleId} className={styles.dialogTitle}>Enable automatic runs on {serviceName}?</h3>
        <div id={descId}>
          <p className={styles.hint}>Read and acknowledge before the first activation:</p>
          <ul className={styles.disclosureList}>
            {DISCLOSURES(serviceName).map((text) => <li key={text}>{text}</li>)}
          </ul>
        </div>
        <div className={styles.switchRow}>
          <input id={checkId} type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          <label htmlFor={checkId}>I have read and understood these points</label>
        </div>
        <div className={styles.dialogActions}>
          <button type="button" className={styles.button} onClick={onCancel}>Cancel</button>
          <button type="button" className={`${styles.button} ${styles.primary}`} disabled={!understood} onClick={onConfirm}>
            Enable automatic runs
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ServiceSection({ id, name, config, onChange, onToggleSurplus, onToggleAuto, autoBlockedReason }) {
  const switchId = useId()
  const autoId = useId()
  const autoHintId = useId()
  const autoDisabled = !config.autoRunEnabled && Boolean(autoBlockedReason)
  // Switching surplus off turns automatic runs off in the same policy update.
  return (
    <fieldset className={styles.group}>
      <legend className={styles.groupTitle}>{name}</legend>
      <div className={styles.switchRow}>
        <input
          id={switchId}
          type="checkbox"
          checked={config.surplusEnabled}
          onChange={(e) => onToggleSurplus(id, e.target.checked)}
        />
        <label htmlFor={switchId}>Use surplus quota for queued ideas</label>
      </div>
      <div className={styles.fields}>
        <NumberField
          label="Reserve to keep"
          value={config.reservePct}
          min={0}
          max={90}
          step={1}
          suffix="%"
          onCommit={(n) => onChange(id, { reservePct: n })}
        />
        <NumberField
          label="Window before reset"
          value={config.windowDays}
          min={1}
          max={6}
          step={1}
          suffix="days"
          onCommit={(n) => onChange(id, { windowDays: n })}
        />
      </div>
      <div className={styles.switchRow}>
        <input
          id={autoId}
          type="checkbox"
          checked={config.autoRunEnabled}
          disabled={autoDisabled}
          aria-describedby={autoHintId}
          onChange={(e) => onToggleAuto(id, e.target.checked)}
        />
        <label htmlFor={autoId}>Automatic runs</label>
      </div>
      <p id={autoHintId} className={styles.hint}>
        {autoDisabled
          ? autoBlockedReason
          : config.autoRunEnabled
            ? 'Approved ideas may start on the runner device when every rule holds. Untick to stop this service.'
            : 'Off. Enabling asks you to acknowledge the disclosures first.'}
      </p>
    </fieldset>
  )
}

function ProtectedRange({ index, range, onChange, onRemove }) {
  const uid = useId()
  const toggleDay = (day, on) => {
    const days = on ? [...range.days, day] : range.days.filter((d) => d !== day)
    onChange(index, { days: DAYS.map((d) => d.value).filter((v) => days.includes(v)) })
  }
  return (
    <li className={styles.range}>
      <fieldset className={styles.dayGroup}>
        <legend className={styles.fieldLabel}>Days (range {index + 1})</legend>
        <div className={styles.days}>
          {DAYS.map((d) => (
            <label key={d.value} className={styles.dayChip} title={d.long}>
              <input
                type="checkbox"
                checked={range.days.includes(d.value)}
                onChange={(e) => toggleDay(d.value, e.target.checked)}
                aria-label={`${d.long}, range ${index + 1}`}
              />
              <span>{d.short}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className={styles.timeRow}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${uid}-start`}>Start</label>
          <input
            id={`${uid}-start`}
            className={styles.timeInput}
            type="time"
            value={range.start}
            onChange={(e) => onChange(index, { start: e.target.value })}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${uid}-end`}>End</label>
          <input
            id={`${uid}-end`}
            className={styles.timeInput}
            type="time"
            value={range.end}
            onChange={(e) => onChange(index, { end: e.target.value })}
          />
        </div>
        <button type="button" className={styles.linkBtn} onClick={() => onRemove(index)}>
          Remove range {index + 1}
        </button>
      </div>
    </li>
  )
}

export default function SurplusSettings({
  policy,
  onUpdatePolicy,
  services = [],
  sharedMode = false,
  autoRunEnabled = false,
  stopIssued = false,
  onStopAutoRuns,
  onSetAutoRunEnabled,
}) {
  const [errors, setErrors] = useState([])
  const [pendingAuto, setPendingAuto] = useState(null)
  const folderId = useId()
  const [folderDraft, setFolderDraft] = useState(null)

  const nameOf = (id) => services.find((s) => s.id === id)?.name || id

  // Applies `edit(current) -> next` through the store and surfaces its validation errors.
  const apply = (edit) => {
    const result = onUpdatePolicy(edit)
    if (result && result.ok === false) {
      const list = Array.isArray(result.errors) && result.errors.length > 0
        ? result.errors
        : [{ path: result.error?.field || '', message: result.error?.message || 'The change was refused.' }]
      setErrors(list)
    } else {
      setErrors([])
    }
    return result
  }

  const updateService = (id, changes) =>
    apply((cur) => ({ ...cur, services: { ...cur.services, [id]: { ...cur.services[id], ...changes } } }))

  // Reasons the automatic-run toggle cannot be switched on (validatePolicy enforces the first).
  const blockedReasonFor = (id) => autoRunBlockedReason(policy, id, sharedMode)

  // Surplus off also switches that service's automatic runs off, in the same policy update.
  const toggleSurplus = (id, on) => apply((cur) => setServiceSurplus(cur, id, on))

  // The runner treats a missing control record as a global stop, so enabling a service also sets
  // the global switch on (unless it already is).
  const enableAuto = (id, changes) => {
    const result = updateService(id, { autoRunEnabled: true, ...changes })
    if (result && result.ok !== false && !autoRunEnabled && typeof onSetAutoRunEnabled === 'function') onSetAutoRunEnabled(true)
  }

  // Turning off is immediate. Turning on asks for the disclosure acknowledgement the first time
  // only; the timestamp is read here, at the edge, and written together with autoRunEnabled.
  const toggleAuto = (id, on) => {
    if (!on) {
      updateService(id, { autoRunEnabled: false })
      return
    }
    if (blockedReasonFor(id)) return
    if (policy.services[id]?.disclosuresAckAt) enableAuto(id)
    else setPendingAuto(id)
  }

  const confirmAuto = () => {
    const id = pendingAuto
    setPendingAuto(null)
    if (id) enableAuto(id, { disclosuresAckAt: new Date().toISOString() })
  }

  const globalState = autoRunEnabled ? 'on' : stopIssued ? 'stopped' : 'unset'
  const anyAuto = SUPPORTED_SERVICE_IDS.some((id) => policy.services?.[id]?.autoRunEnabled === true)

  const updateRange = (index, changes) =>
    apply((cur) => ({
      ...cur,
      protectedHours: cur.protectedHours.map((r, i) => (i === index ? { ...r, ...changes } : r)),
    }))

  const addRange = () =>
    apply((cur) => ({ ...cur, protectedHours: [...cur.protectedHours, { ...NEW_RANGE, days: [...NEW_RANGE.days] }] }))

  const removeRange = (index) =>
    apply((cur) => ({ ...cur, protectedHours: cur.protectedHours.filter((_, i) => i !== index) }))

  const updateCost = (key, n) => apply((cur) => ({ ...cur, costPct: { ...cur.costPct, [key]: n } }))

  const updateFolder = (text) => {
    const trimmed = text.trim()
    apply((cur) => ({ ...cur, projectsBaseFolder: trimmed === '' ? null : trimmed }))
  }

  // FR-025: no dedicated policy field exists, so "suggestion-only" means autoRunEnabled=false on
  // every supported service. The switch is on when that is already true and can only be turned
  // on here; enabling a service happens per service in its own section (T058).
  const supported = SUPPORTED_SERVICE_IDS.filter((id) => policy.services?.[id])
  const suggestionOnly = supported.every((id) => policy.services[id].autoRunEnabled === false)
  const setAllSuggestionOnly = () =>
    apply((cur) => {
      const next = { ...cur.services }
      for (const id of SUPPORTED_SERVICE_IDS) if (next[id]) next[id] = { ...next[id], autoRunEnabled: false }
      return { ...cur, services: next }
    })
  const suggestionOnlyId = useId()

  const protectedHours = policy.protectedHours || []
  const folderValue = folderDraft ?? (policy.projectsBaseFolder || '')

  return (
    <section className={styles.panel} aria-labelledby="surplus-settings-title">
      <h3 id="surplus-settings-title" className={styles.title}>Surplus settings</h3>

      <p className={styles.notice} role="note">
        Provider rules on automated usage of subscriptions can change. Suggestions never use a
        provider on their own, and you can switch every service back to suggestion-only below at any time.
      </p>

      <div className={styles.stopBar}>
        <button
          type="button"
          className={styles.stopBtn}
          disabled={typeof onStopAutoRuns !== 'function'}
          onClick={() => onStopAutoRuns?.()}
        >
          Stop all automatic runs
        </button>
        <p className={styles.stopState} role="status">
          {globalState === 'on'
            ? 'Global switch: on. A run may start when a service has automatic runs enabled and every rule holds.'
            : globalState === 'stopped'
              ? 'Global switch: off. No automatic run will start.'
              : 'Global switch: not set yet. It turns on when you enable automatic runs for a service.'}
          {globalState === 'stopped' && anyAuto && typeof onSetAutoRunEnabled === 'function' && (
            <>
              {' '}
              <button type="button" className={styles.linkBtn} onClick={() => onSetAutoRunEnabled(true)}>
                Switch back on
              </button>
            </>
          )}
        </p>
      </div>

      {errors.length > 0 && (
        <ul className={styles.errors} role="alert">
          {errors.map((e, i) => (
            <li key={`${e.path}-${i}`}>
              {e.path ? <code>{e.path}</code> : null} {e.message}
            </li>
          ))}
        </ul>
      )}

      <div className={styles.switchRow}>
        <input
          id={suggestionOnlyId}
          type="checkbox"
          checked={suggestionOnly}
          disabled={suggestionOnly}
          onChange={() => setAllSuggestionOnly()}
        />
        <label htmlFor={suggestionOnlyId}>Suggestion-only for all services</label>
      </div>
      <p className={styles.hint}>
        {suggestionOnly
          ? 'Nothing runs automatically: ideas are only suggested for you to launch yourself.'
          : 'Some services have automatic runs enabled. Tick this to switch all of them back to suggestions.'}
        {!sharedMode && ' Automatic runs also need shared mode, which is off.'}
      </p>

      {supported.map((id) => (
        <ServiceSection
          key={id}
          id={id}
          name={nameOf(id)}
          config={policy.services[id]}
          onChange={updateService}
          onToggleSurplus={toggleSurplus}
          onToggleAuto={toggleAuto}
          autoBlockedReason={blockedReasonFor(id)}
        />
      ))}

      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>Protected hours</legend>
        <p className={styles.hint}>No run may be active during these hours. Several ranges can be declared; a range may cross midnight.</p>
        {protectedHours.length === 0 ? (
          <p className={styles.hint}>None declared.</p>
        ) : (
          <ul className={styles.rangeList}>
            {protectedHours.map((r, i) => (
              <ProtectedRange key={i} index={i} range={r} onChange={updateRange} onRemove={removeRange} />
            ))}
          </ul>
        )}
        <button type="button" className={styles.button} onClick={addRange}>Add protected hours</button>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>Estimated cost per idea size</legend>
        <p className={styles.hint}>Share of the weekly quota an idea is assumed to use (defaults {DEFAULTS.COST_SMALL_PCT}, {DEFAULTS.COST_MEDIUM_PCT} and {DEFAULTS.COST_LARGE_PCT} %). Must grow from small to large.</p>
        <div className={styles.fields}>
          {SIZES.map((s) => (
            <NumberField
              key={s.key}
              label={s.label}
              value={policy.costPct[s.key]}
              min={0.5}
              step={0.5}
              suffix="%"
              onCommit={(n) => updateCost(s.key, n)}
            />
          ))}
        </div>
      </fieldset>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={folderId}>Projects base folder</label>
        <input
          id={folderId}
          className={styles.textInput}
          type="text"
          placeholder="/Users/me/projects"
          autoComplete="off"
          spellCheck={false}
          value={folderValue}
          onChange={(e) => {
            setFolderDraft(e.target.value)
            updateFolder(e.target.value)
          }}
          onBlur={() => setFolderDraft(null)}
        />
        <p className={styles.hint}>Relative working folders of ideas are resolved against this folder.</p>
      </div>
      {pendingAuto && (
        <DisclosureDialog serviceName={nameOf(pendingAuto)} onConfirm={confirmAuto} onCancel={() => setPendingAuto(null)} />
      )}
    </section>
  )
}
