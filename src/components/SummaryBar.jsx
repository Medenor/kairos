import { summarizeProviders } from '../providers/summary'
import styles from './SummaryBar.module.css'

// Props: providers (runtime services), state (quota state), plus the reset/sync controls.
export default function SummaryBar({ providers, state, onReset, onSync, syncStatus = 'idle', syncMessage = '' }) {
  const summary = summarizeProviders(providers, state)

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
        <span className={styles.value} style={summary.underPressure > 0 ? { color: '#E24B4A' } : {}}>
          {summary.underPressure}
        </span>
      </div>
      <button className={styles.resetBtn} onClick={onReset} title="Clear every quota reading (providers are kept)">
        Clear readings
      </button>
      <button className={styles.syncBtn} onClick={onSync} title="Pull latest shared updates">
        Sync
      </button>
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
