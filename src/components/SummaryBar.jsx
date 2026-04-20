import { SERVICES } from '../data/services'
import { getServicePressure } from '../utils'
import styles from './SummaryBar.module.css'

export default function SummaryBar({ state, onReset, onSync, syncStatus = 'idle', syncMessage = '' }) {
  const monthlyTotal = SERVICES.reduce((sum, svc) => sum + svc.cost, 0)
  const underPressure = SERVICES.filter(
    (svc) => getServicePressure(svc, { [svc.id]: state[svc.id] }) >= 75
  ).length

  return (
    <div className={styles.bar}>
      <div className={styles.stat}>
        <span className={styles.label}>Subscriptions / month</span>
        <span className={styles.value}>{monthlyTotal.toFixed(2)}€</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.label}>Services under pressure</span>
        <span className={styles.value} style={underPressure > 0 ? { color: '#E24B4A' } : {}}>
          {underPressure}
        </span>
      </div>
      <button className={styles.resetBtn} onClick={onReset} title="Reset all quotas to defaults">
        Reset
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
