import { useEffect, useId, useRef, useState } from 'react'
import { TASKS } from '../data/tasks.js'
import { FIT_LEVELS, LIMITS } from '../providers/schema.js'
import { draftToInput, emptyDraft, emptyQuotaDraft, errorMap } from './providerDraft.js'
import styles from './ProviderForm.module.css'

const FIT_LABELS = { strong: 'Strong', acceptable: 'Acceptable', weak: 'Weak', none: 'None' }
const TYPE_LABELS = { consumed_pct: 'Consumed %', remaining_pct: 'Remaining %', currency: 'Currency balance' }
const SCHEDULE_LABELS = { weekly: 'Weekly', monthly: 'Monthly (30 days)', custom: 'Custom number of days', none: 'No schedule (pay-as-you-go)' }

function Field({ id, label, error, children, hint }) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      {children}
      {hint && <span className={styles.hint}>{hint}</span>}
      {error && <span className={styles.error} role="alert">{error}</span>}
    </div>
  )
}

// The form holds no rules: it builds an input, hands it to `onSubmit(input)` and shows the
// `{path, message}` errors that come back next to the field they name. Cancel never calls the handler.
// Props: initial (draft), mode 'create' | 'edit', onSubmit(input) -> {ok, errors?}, onCancel(), extra (render slot).
export default function ProviderForm({ initial, mode = 'create', onSubmit, onCancel, submitLabel, focusName = false }) {
  const uid = useId()
  const nameRef = useRef(null)
  useEffect(() => {
    if (focusName) nameRef.current?.focus()
  }, [focusName])
  const [draft, setDraft] = useState(() => initial ?? emptyDraft())
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState(null) // schedule change awaiting confirmation: { lastResetDate, date }

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const setQuota = (index, patch) =>
    setDraft((d) => ({ ...d, quotas: d.quotas.map((q, i) => (i === index ? { ...q, ...patch } : q)) }))
  const addQuota = () => setDraft((d) => ({ ...d, quotas: [...d.quotas, emptyQuotaDraft()] }))
  const removeQuota = (index) =>
    setDraft((d) => (d.quotas.length <= 1 ? d : { ...d, quotas: d.quotas.filter((_, i) => i !== index) }))
  const onTypeChange = (index, type) =>
    setDraft((d) => ({
      ...d,
      quotas: d.quotas.map((q, i) => {
        if (i !== index) return q
        if (!q.id) return { ...q, type }
        return { ...q, type, value: type === q.originalType ? q.originalValue : '' }
      }),
    }))
  const setFit = (taskId, level) => setDraft((d) => ({ ...d, fits: { ...d.fits, [taskId]: level } }))

  // Changing a quota's type means the stored number would mean something else: the value must be
  // entered again (FR-007). The reducer refuses it too; this only avoids a pointless round trip.
  const typeChangeErrors = () => {
    const found = {}
    draft.quotas.forEach((q, i) => {
      if (q.id && q.type !== q.originalType && String(q.value).trim() === '') {
        found[`quotas[${i}].value`] = 'Enter the value again: the quota type changed.'
      }
    })
    return found
  }

  function send(extra = {}) {
    const pending = mode === 'edit' ? typeChangeErrors() : {}
    if (Object.keys(pending).length > 0) {
      setErrors(pending)
      setNotice('Some fields need attention.')
      return
    }
    const result = onSubmit({ ...draftToInput(draft), ...extra })
    if (result?.ok) {
      setErrors({})
      setNotice('')
      setConfirm(null)
    } else if (result?.needsConfirmation) {
      setErrors({})
      setNotice('')
      setConfirm({ lastResetDate: result.needsConfirmation.lastResetDate, date: result.needsConfirmation.lastResetDate })
    } else {
      setConfirm(null)
      setErrors(errorMap(result?.errors))
      setNotice(result?.errors?.length ? 'Some fields need attention.' : 'The provider could not be saved.')
    }
  }

  function submit(event) {
    event.preventDefault()
    send()
  }

  const id = (name) => `${uid}-${name}`

  return (
    <form className={styles.form} onSubmit={submit} noValidate aria-label={mode === 'edit' ? 'Edit provider' : 'Add provider'}>
      <h3 className={styles.title}>{mode === 'edit' ? 'Edit provider' : 'Add provider'}</h3>
      {notice && <p className={styles.notice} role="alert">{notice}</p>}

      <Field id={id('name')} label="Name" error={errors.name}>
        <input id={id('name')} ref={nameRef} className={styles.input} value={draft.name} maxLength={LIMITS.NAME_MAX + 20}
          onChange={(e) => set({ name: e.target.value })} aria-invalid={Boolean(errors.name)} />
      </Field>

      <div className={styles.row}>
        <Field id={id('cost')} label="Monthly cost (optional)" error={errors['cost.amount']}>
          <input id={id('cost')} className={styles.input} inputMode="decimal" value={draft.costAmount}
            onChange={(e) => set({ costAmount: e.target.value })} aria-invalid={Boolean(errors['cost.amount'])} />
        </Field>
        <Field id={id('costcur')} label="Currency" error={errors['cost.currency']}>
          <input id={id('costcur')} className={styles.inputShort} value={draft.costCurrency} maxLength={LIMITS.CURRENCY_MAX}
            onChange={(e) => set({ costCurrency: e.target.value })} />
        </Field>
        <Field id={id('color')} label="Colour (#rrggbb)" error={errors.color}>
          <input id={id('color')} className={styles.inputShort} placeholder="#378add" value={draft.color}
            onChange={(e) => set({ color: e.target.value })} aria-invalid={Boolean(errors.color)} />
        </Field>
      </div>

      <Field id={id('flags')} label="Flags (comma separated, descriptive only)" error={errors.flags}>
        <input id={id('flags')} className={styles.input} value={draft.flags} onChange={(e) => set({ flags: e.target.value })} />
      </Field>
      <Field id={id('note')} label="Note" error={errors.note}>
        <textarea id={id('note')} className={styles.textarea} rows={2} value={draft.note} onChange={(e) => set({ note: e.target.value })} />
      </Field>

      <div className={styles.row}>
        <Field id={id('schedule')} label="Reset schedule" error={errors.schedule}>
          <select id={id('schedule')} className={styles.input} value={draft.scheduleType} onChange={(e) => set({ scheduleType: e.target.value })}>
            {Object.entries(SCHEDULE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        {draft.scheduleType === 'custom' && (
          <Field id={id('cycle')} label="Days between resets" error={errors['schedule.cycleDays']}>
            <input id={id('cycle')} className={styles.inputShort} inputMode="numeric" value={draft.cycleDays}
              onChange={(e) => set({ cycleDays: e.target.value })} aria-invalid={Boolean(errors['schedule.cycleDays'])} />
          </Field>
        )}
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Quotas ({draft.quotas.length}/{LIMITS.QUOTAS_MAX})</legend>
        {errors.quotas && <span className={styles.error} role="alert">{errors.quotas}</span>}
        {draft.quotas.map((q, i) => (
          <div key={q.ref} className={styles.quotaRow}>
            <div className={styles.row}>
              <Field id={id(`ql${i}`)} label="Label" error={errors[`quotas[${i}].label`]}>
                <input id={id(`ql${i}`)} className={styles.input} value={q.label} onChange={(e) => setQuota(i, { label: e.target.value })}
                  aria-invalid={Boolean(errors[`quotas[${i}].label`])} />
              </Field>
              <Field id={id(`qt${i}`)} label="Type" error={errors[`quotas[${i}].type`]}>
                <select id={id(`qt${i}`)} className={styles.input} value={q.type} onChange={(e) => onTypeChange(i, e.target.value)}>
                  {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field id={id(`qv${i}`)} label={q.id && q.type !== q.originalType ? 'New value (required: the type changed)' : q.type === 'currency' ? 'Current balance' : 'Current value (%)'} error={errors[`quotas[${i}].value`]}>
                <input id={id(`qv${i}`)} className={styles.inputShort} inputMode="decimal" value={q.value}
                  onChange={(e) => setQuota(i, { value: e.target.value })} aria-invalid={Boolean(errors[`quotas[${i}].value`])} />
              </Field>
            </div>
            {q.type === 'currency' && (
              <div className={styles.row}>
                <Field id={id(`qc${i}`)} label="Currency symbol" error={errors[`quotas[${i}].currency`]}>
                  <input id={id(`qc${i}`)} className={styles.inputShort} value={q.currency} maxLength={LIMITS.CURRENCY_MAX}
                    onChange={(e) => setQuota(i, { currency: e.target.value })} aria-invalid={Boolean(errors[`quotas[${i}].currency`])} />
                </Field>
                <Field id={id(`qb${i}`)} label="Low-balance level (default 5)" error={errors[`quotas[${i}].lowBalance`]}
                  hint="Below this the balance counts as under pressure.">
                  <input id={id(`qb${i}`)} className={styles.inputShort} inputMode="decimal" value={q.lowBalance}
                    onChange={(e) => setQuota(i, { lowBalance: e.target.value })} />
                </Field>
              </div>
            )}
            <div className={styles.gates} role="group" aria-label={`Tasks gated by ${q.label || 'this quota'}`}>
              <span className={styles.hint}>Gates: {q.gates ? '' : 'all tasks'}</span>
              {TASKS.map((task) => {
                const checked = q.gates ? q.gates.includes(task.id) : false
                return (
                  <label key={task.id} className={styles.check}>
                    <input type="checkbox" checked={checked}
                      onChange={(e) => {
                        const current = q.gates ?? []
                        const next = e.target.checked ? [...current, task.id] : current.filter((t) => t !== task.id)
                        setQuota(i, { gates: next.length ? next : null })
                      }} />
                    {task.name}
                  </label>
                )
              })}
              {errors[`quotas[${i}].gates`] && <span className={styles.error} role="alert">{errors[`quotas[${i}].gates`]}</span>}
            </div>
            <button type="button" className={styles.linkButton} onClick={() => removeQuota(i)} disabled={draft.quotas.length <= 1}>
              Remove quota
            </button>
          </div>
        ))}
        <button type="button" className={styles.secondary} onClick={addQuota} disabled={draft.quotas.length >= LIMITS.QUOTAS_MAX}>
          Add a quota
        </button>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Fit per task</legend>
        <p className={styles.hint}>Not set: treated as not suitable for that task.</p>
        <div className={styles.fitGrid}>
          {TASKS.map((task) => (
            <div key={task.id} className={styles.fitRow}>
              <label htmlFor={id(`fit-${task.id}`)} className={styles.fitLabel}>{task.name}</label>
              <select id={id(`fit-${task.id}`)} className={styles.input} value={draft.fits[task.id] ?? ''}
                onChange={(e) => setFit(task.id, e.target.value)}>
                <option value="">Not set</option>
                {FIT_LEVELS.map((level) => <option key={level} value={level}>{FIT_LABELS[level]}</option>)}
              </select>
              {errors[`fits.${task.id}`] && <span className={styles.error} role="alert">{errors[`fits.${task.id}`]}</span>}
            </div>
          ))}
        </div>
      </fieldset>

      {confirm && (
        <div className={styles.confirmBox} role="alertdialog" aria-label="Confirm schedule change">
          <p className={styles.notice}>
            The reset schedule changed. The recorded last reset date is {confirm.lastResetDate}. Keep it, correct it or clear it, then confirm.
          </p>
          <label className={styles.label} htmlFor={id('resetdate')}>Last reset date</label>
          <input id={id('resetdate')} type="date" className={styles.inputShort} value={confirm.date ?? ''}
            onChange={(e) => setConfirm({ ...confirm, date: e.target.value })} />
          <div className={styles.actions}>
            <button type="button" className={styles.primary}
              onClick={() => send({ confirmSchedule: true, lastResetDate: confirm.date || null })}>
              Confirm schedule change
            </button>
            <button type="button" className={styles.secondary} onClick={() => setConfirm(null)}>Back</button>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <button type="submit" className={styles.primary}>{submitLabel ?? (mode === 'edit' ? 'Save changes' : 'Add provider')}</button>
        <button type="button" className={styles.secondary} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
