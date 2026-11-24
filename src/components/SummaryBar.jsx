import { useEffect, useRef, useState } from 'react'
import { summarizeProviders } from '../providers/summary'
import styles from './SummaryBar.module.css'

// Props: providers (runtime services), state (quota state), plus the reset/sync controls.
// "Clear readings" wipes every quota value at once, so it asks first; Esc or "Keep" backs out.
export default function SummaryBar({ providers, state, onReset, onSync, syncStatus = 'idle', syncMessage = '' }) {
  const summary = summarizeProviders(providers, state)
  const [confirming, setConfirming] = useState(false)
  const keepRef = useRef(null)
  useEffect(() => {
    if (confirming) keepRef.current?.focus()
  }, [confirming])

  return (
    <div className={styles.bar}>
      <div className={styles.stat}>
        <span className={styles.label}>Subscriptions / month</span>
        <span className={styles.value}>
          {summary.monthlyCosts.length === 0
            ? '—'
            : summary.monthlyCosts.map((c) => `${c.total.toFixed(2)}${c.currency}`).join(' + ')}
        </span>
      </div>
      <div className={styles.stat}>
        <span className={styles.label}>Providers under pressure</span>
        <span className={`${styles.value} ${summary.underPressure > 0 ? styles.valueAlert : ''}`}>
          {summary.underPressure}
        </span>
      </div>
      {confirming ? (
        <div
          className={styles.confirm}
          role="alertdialog"
          aria-label="Clear every quota reading?"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setConfirming(false)
          }}
        >
          <span className={styles.confirmText}>Clear every quota reading? Providers are kept.</span>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={() => {
              setConfirming(false)
              onReset()
            }}
          >
            Clear readings
          </button>
          <button type="button" className={styles.syncBtn} ref={keepRef} onClick={() => setConfirming(false)}>
            Keep
          </button>
        </div>
      ) : (
        <>
          <button className={styles.resetBtn} onClick={() => setConfirming(true)} title="Clear every quota reading (providers are kept)">
            Clear readings
          </button>
          <button className={styles.syncBtn} onClick={onSync} title="Pull latest shared updates">
            Sync
          </button>
        </>
      )}
      <div className={styles.syncMeta}>
        <span className={styles.syncLabel}>State</span>
        <span className={styles.syncValue} data-status={syncStatus}>
          {syncStatus}
        </span>
        {syncMessage ? <span className={styles.syncMessage}>{syncMessage}</span> : null}
      </div>
    </div>
  )
}
