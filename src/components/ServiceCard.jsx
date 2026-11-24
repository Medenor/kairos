import { useState } from 'react'
import {
  DEFAULT_LOW_BALANCE,
  RESET_DATE_KEY,
  describeReading,
  getBarColor,
  getConsumedPct,
  getResetInfo,
  getServicePressure,
  getStatusBadge,
  quotaTimeKey,
} from '../utils'
import { formatQuotaAge } from '../surplus/quotaAge'
import styles from './ServiceCard.module.css'

const pad2 = (n) => String(n).padStart(2, '0')
const localToday = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

const isReading = (value) => typeof value === 'number' && Number.isFinite(value)

const BALANCE_NOTE = { exhausted: 'exhausted', low: 'low', ok: 'above the low-balance level' }

// A gauge that says what it shows: the bar is always drawn as the share already used, and the label
// states the direction of the number next to it. Only percentage quotas get one; a balance has no
// declared maximum, so it is shown as an amount and a state, never as an invented percentage.
function Gauge({ quota, reading }) {
  if (reading.consumedPct === null) return null
  return (
    <div className={styles.barRow}>
      <div
        className={styles.barWrap}
        role="progressbar"
        aria-label={`${quota.label}: ${reading.consumedPct}% used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={reading.consumedPct}
      >
        <div
          className={styles.bar}
          style={{ width: `${reading.consumedPct}%`, background: getBarColor(reading.consumedPct) }}
        />
      </div>
    </div>
  )
}

// One read-only line per quota, shown while the card is collapsed.
function GlanceRow({ quota, value, stamp, now }) {
  const reading = describeReading(quota, value)
  const age = isReading(value) ? formatQuotaAge(stamp, now) : ''
  return (
    <div className={styles.glanceRow}>
      <span className={styles.glanceLabel}>{quota.label}</span>
      <span className={styles.glanceValue}>
        {reading.text}
        {reading.balanceState && reading.balanceState !== 'ok' ? ` · ${BALANCE_NOTE[reading.balanceState]}` : ''}
      </span>
      <Gauge quota={quota} reading={reading} />
      {age && <span className={styles.glanceAge}>{age}</span>}
    </div>
  )
}

function QuotaRow({ quota, value, onChange, stamp, now }) {
  const unread = !isReading(value)
  const cPct = unread ? 0 : getConsumedPct(quota, value)
  const reading = describeReading(quota, value)
  const ageLabel = unread ? '' : formatQuotaAge(stamp, now)
  const ageClass = `${styles.quotaAge} ${stamp ? '' : styles.quotaAgeNever}`
  const isCurrency = quota.type === 'currency'
  const lowBalance = typeof quota.lowBalance === 'number' && quota.lowBalance > 0 ? quota.lowBalance : DEFAULT_LOW_BALANCE

  const handleIncrement = (val) => {
    const next = value + val
    onChange(isCurrency ? Math.max(0, next) : Math.min(100, Math.max(0, next)))
  }

  // No stored value yet (for instance a definition that arrived before its readings): never show
  // undefined or NaN, and let the user enter the first reading.
  if (unread) {
    return (
      <div className={styles.quotaBlock}>
        <div className={styles.stepperRow}>
          <span className={styles.quotaLabel}>
            {quota.label}
            {quota.subnote && <span className={styles.subnote}> ({quota.subnote})</span>}
          </span>
          <div className={styles.stepperWrap}>
            <span className={styles.subnote}>No reading yet</span>
            <input
              className={styles.numInput}
              type="number"
              min={0}
              max={isCurrency ? undefined : 100}
              step={isCurrency ? 0.5 : 1}
              placeholder={isCurrency ? quota.currency || '' : '%'}
              aria-label={`First reading for ${quota.label}`}
              onChange={(e) => {
                if (e.target.value === '') return
                const parsed = Number(e.target.value)
                if (Number.isFinite(parsed)) onChange(parsed)
              }}
            />
          </div>
        </div>
      </div>
    )
  }

  if (isCurrency) {
    return (
      <div className={styles.quotaBlock}>
        <div className={styles.creditRow}>
          <span className={styles.quotaLabel}>{quota.label}</span>
          <div className={styles.stepperWrap}>
            <button className={styles.stepBtn} onClick={() => handleIncrement(-1)} aria-label={`Decrease ${quota.label} by 1`}>−</button>
            <input
              className={styles.numInput}
              type="number"
              min={0}
              step={0.5}
              value={value}
              aria-label={`${quota.label} balance`}
              onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            />
            <button className={styles.stepBtn} onClick={() => handleIncrement(1)} aria-label={`Increase ${quota.label} by 1`}>+</button>
          </div>
          <span className={styles.currencyUnit}>{quota.currency}</span>
        </div>
        <div className={styles.balanceNote}>
          {reading.balanceState === 'exhausted' && 'Exhausted'}
          {reading.balanceState === 'low' && `Low: below ${lowBalance}${quota.currency ? ` ${quota.currency}` : ''}`}
          {reading.balanceState === 'ok' && `Above the low-balance level (${lowBalance}${quota.currency ? ` ${quota.currency}` : ''})`}
        </div>
        <div className={ageClass}>{ageLabel}</div>
      </div>
    )
  }

  return (
    <div className={styles.quotaBlock}>
      <div className={styles.stepperRow}>
        <span className={styles.quotaLabel}>
          {quota.label}
          {quota.subnote && <span className={styles.subnote}> ({quota.subnote})</span>}
        </span>
        <div className={styles.stepperWrap}>
          <button className={styles.stepBtn} onClick={() => handleIncrement(-5)} title="-5%" aria-label={`Decrease ${quota.label} by 5`}>-5</button>
          <button className={styles.stepBtn} onClick={() => handleIncrement(-1)} title="-1%" aria-label={`Decrease ${quota.label} by 1`}>−</button>
          <span className={styles.quotaValDisplay}>
            {reading.text}
            {reading.detail && <span className={styles.quotaValDetail}>{reading.detail}</span>}
          </span>
          <button className={styles.stepBtn} onClick={() => handleIncrement(1)} title="+1%" aria-label={`Increase ${quota.label} by 1`}>+</button>
          <button className={styles.stepBtn} onClick={() => handleIncrement(5)} title="+5%" aria-label={`Increase ${quota.label} by 5`}>+5</button>
        </div>
      </div>
      <Gauge quota={quota} reading={{ ...reading, consumedPct: cPct }} />
      <div className={ageClass}>{ageLabel}</div>
    </div>
  )
}

export function resetLabel(svc) {
  switch (svc.resetType) {
    case 'weekly': return 'Weekly reset'
    case 'monthly': return 'Monthly reset'
    case 'custom': return `Resets every ${svc.resetCycleDays} days`
    default: return 'No scheduled reset'
  }
}

// No reset tracking when there is no schedule: such a provider is never "overdue".
const hasSchedule = (svc) => svc.resetType !== 'none' && svc.resetType !== 'payg' && Boolean(svc.resetCycleDays)

export function costLabel(svc) {
  return typeof svc.cost === 'number' && svc.cost > 0 ? `${svc.cost.toFixed(2)}${svc.costCurrency ?? ''}/mo` : null
}

function ResetTrackingRow({ svc, quotaState, onUpdate, now }) {
  const rawResetDate = quotaState[RESET_DATE_KEY]
  const lastResetDate = typeof rawResetDate === 'string' && rawResetDate ? rawResetDate : null
  const resetInfo = getResetInfo(lastResetDate, svc.resetCycleDays, now)

  return (
    <div className={styles.resetBlock}>
      <div className={styles.resetHeader}>
        <span className={styles.resetLabel}>Last reset date</span>
        <span className={`${styles.resetState} ${styles[`resetState_${resetInfo.state}`] || ''}`}>
          {resetInfo.label}
        </span>
      </div>
      <div className={styles.resetControls}>
        <input
          className={styles.resetInput}
          type="date"
          value={lastResetDate || ''}
          max={localToday(now)}
          aria-label={`Last reset date for ${svc.name}`}
          onChange={(e) => onUpdate(svc.id, RESET_DATE_KEY, e.target.value || null)}
        />
        <button
          className={styles.clearBtn}
          onClick={() => onUpdate(svc.id, RESET_DATE_KEY, null)}
          disabled={!lastResetDate}
          title="Clear last reset date"
        >
          Clear
        </button>
      </div>
      {resetInfo.nextResetDate && <div className={styles.resetMeta}>Next reset: {resetInfo.nextResetDate}</div>}
    </div>
  )
}

// A provider is one collapsible card. Collapsed, it is a glance: name, status and one read-only line per
// quota, so a few providers fit in a screen. Opened, it holds the controls: steppers, "still current",
// reset tracking and the card actions. A provider with a quota that has no reading yet starts opened so
// the first reading can be entered; after that the card keeps whatever state the user left it in.
// `actions`: optional [{ label, onClick, disabled, title }] rendered as buttons (edit, delete, ...).
export default function ServiceCard({ svc, quotaState = {}, onUpdate, onConfirm, now = new Date(), actions = [] }) {
  const pressure = getServicePressure(svc, { [svc.id]: quotaState })
  const badge = getStatusBadge(pressure)
  const cost = costLabel(svc)
  const anyReading = svc.quotas.some((q) => isReading(quotaState[q.id]))
  const [startOpen] = useState(() => svc.quotas.some((q) => !isReading(quotaState[q.id])))

  return (
    <details className={styles.card} open={startOpen}>
      <summary className={styles.summary}>
        <div className={styles.header}>
          <div className={styles.identity}>
            <span className={styles.dot} style={{ background: svc.color || 'var(--color-border-md)' }} aria-hidden="true" />
            <span className={styles.name}>{svc.name}</span>
            {cost && <span className={styles.meta}>{cost}</span>}
          </div>
          <div className={styles.headerEnd}>
            {anyReading && (
              <span className={`${styles.badge} ${styles[`badge_${badge.level}`]}`}>
                {badge.label}
              </span>
            )}
            <span className={styles.toggle}>
              <span className={styles.toggleClosed}>Update</span>
              <span className={styles.toggleOpen}>Done</span>
            </span>
          </div>
        </div>
        <div className={styles.glance}>
          {svc.quotas.map((q) => (
            <GlanceRow key={q.id} quota={q} value={quotaState[q.id]} stamp={quotaState[quotaTimeKey(q.id)]} now={now} />
          ))}
        </div>
      </summary>

      <div className={styles.body}>
        {svc.quotas.map((q) => (
          <QuotaRow
            key={q.id}
            quota={q}
            value={quotaState[q.id]}
            onChange={(val) => onUpdate(svc.id, q.id, val)}
            stamp={quotaState[quotaTimeKey(q.id)]}
            now={now}
          />
        ))}

        {onConfirm && svc.quotas.length > 0 && (
          <div className={styles.confirmRow}>
            <button
              type="button"
              className={styles.confirmBtn}
              onClick={() => onConfirm(svc.id)}
              title="Mark the displayed values as still current, without changing them"
            >
              Still current
            </button>
          </div>
        )}

        {hasSchedule(svc) && (
          <ResetTrackingRow svc={svc} quotaState={quotaState} onUpdate={onUpdate} now={now} />
        )}

        <div className={styles.footer}>
          {resetLabel(svc)}{svc.note ? ` · ${svc.note}` : ''}
        </div>
        {actions.length > 0 && (
          <div className={styles.actionRow}>
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={styles.confirmBtn}
                onClick={action.onClick}
                disabled={action.disabled}
                title={action.title}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
        {svc.flags && svc.flags.length > 0 && (
          <div className={styles.flags}>
            {svc.flags.map((f) => (
              <span key={f} className={styles.flag}>{f}</span>
            ))}
          </div>
        )}
      </div>
    </details>
  )
}
