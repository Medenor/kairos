import {
  RESET_DATE_KEY,
  getBarColor,
  getConsumedPct,
  getResetInfo,
  getServicePressure,
  getStatusBadge,
  quotaTimeKey,
} from '../utils'
import { formatQuotaAge } from '../surplus/quotaAge'
import styles from './ServiceCard.module.css'

function QuotaRow({ quota, value, onChange, stamp, now }) {
  const cPct = getConsumedPct(quota, value)
  const ageLabel = formatQuotaAge(stamp, now)
  const ageClass = `${styles.quotaAge} ${stamp ? '' : styles.quotaAgeNever}`

  const handleIncrement = (val) => {
    const newVal = Math.min(100, Math.max(0, value + val))
    onChange(newVal)
  }

  if (quota.type === 'currency') {
    return (
      <div className={styles.quotaBlock}>
        <div className={styles.creditRow}>
          <span className={styles.quotaLabel}>{quota.label}</span>
          <div className={styles.stepperWrap}>
            <button className={styles.stepBtn} onClick={() => handleIncrement(-1)}>−</button>
            <input
              className={styles.numInput}
              type="number"
              min={0}
              step={0.5}
              value={value}
              onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            />
            <button className={styles.stepBtn} onClick={() => handleIncrement(1)}>+</button>
          </div>
          <span className={styles.currencyUnit}>{quota.currency}</span>
          {value <= 0 && <span className={styles.subnote}>— exhausted</span>}
          {value > 0 && value < 2 && <span className={styles.subnote}>— low</span>}
        </div>
        <div className={styles.barRow}>
          <div className={styles.barWrap}>
            <div
              className={styles.bar}
              style={{ width: `${100 - Math.min(100, Math.round((value / 20) * 100))}%`, background: getBarColor(cPct) }}
            />
          </div>
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
          <button className={styles.stepBtn} onClick={() => handleIncrement(-5)} title="-5%">-5</button>
          <button className={styles.stepBtn} onClick={() => handleIncrement(-1)} title="-1%">-</button>
          <span className={styles.quotaValDisplay}>{value}%</span>
          <button className={styles.stepBtn} onClick={() => handleIncrement(1)} title="+1%">+</button>
          <button className={styles.stepBtn} onClick={() => handleIncrement(5)} title="+5%">+5</button>
        </div>
      </div>
      <div className={styles.barRow}>
        <div className={styles.barWrap}>
          <div
            className={styles.bar}
            style={{ width: `${cPct}%`, background: getBarColor(cPct) }}
          />
        </div>
      </div>
      <div className={ageClass}>{ageLabel}</div>
    </div>
  )
}

const BADGE_STYLES = {
  ok: { background: '#EAF3DE', color: '#3B6D11' },
  warn: { background: '#FAEEDA', color: '#854F0B' },
  crit: { background: '#FCEBEB', color: '#A32D2D' },
  off: { background: '#F1EFE8', color: '#5F5E5A' },
}

const RESET_LABELS = {
  weekly: 'Weekly reset',
  monthly: 'Monthly reset',
  payg: 'Pay-as-you-go',
}

function ResetTrackingRow({ svc, quotaState, onUpdate }) {
  const rawResetDate = quotaState[RESET_DATE_KEY]
  const lastResetDate = typeof rawResetDate === 'string' && rawResetDate ? rawResetDate : null
  const resetInfo = getResetInfo(lastResetDate, svc.resetCycleDays)

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
          max={new Date().toISOString().slice(0, 10)}
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

export default function ServiceCard({ svc, quotaState, onUpdate, onConfirm, now = new Date() }) {
  const pressure = getServicePressure(svc, { [svc.id]: quotaState })
  const badge = getStatusBadge(pressure)
  const costDisplay =
    svc.cost > 0 ? `${svc.cost.toFixed(2)}${svc.costCurrency}/mo` : 'Pay-as-you-go'

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.dot} style={{ background: svc.color }} />
          <span className={styles.name}>{svc.name}</span>
          <span className={styles.meta}>{costDisplay}</span>
        </div>
        <span className={styles.badge} style={BADGE_STYLES[badge.level]}>
          {badge.label}
        </span>
      </div>

      {svc.quotas.map((q) => (
        <QuotaRow
          key={q.id}
          quota={q}
          value={quotaState[q.id] ?? q.value}
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

      {svc.resetType !== 'payg' && (
        <ResetTrackingRow svc={svc} quotaState={quotaState} onUpdate={onUpdate} />
      )}

      <div className={styles.footer}>
        {RESET_LABELS[svc.resetType]} · {svc.note}
      </div>
      <div className={styles.flags}>
        {svc.flags.map((f) => (
          <span key={f} className={styles.flag}>{f}</span>
        ))}
      </div>
    </div>
  )
}
