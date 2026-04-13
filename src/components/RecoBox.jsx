import { SERVICES } from '../data/services'
import { RULES } from '../data/rules'
import styles from './RecoBox.module.css'

export default function RecoBox({ task, state }) {
  if (!task) {
    return (
      <div className={styles.box}>
        <p className={styles.empty}>Select a task type above to get a recommendation.</p>
      </div>
    )
  }

  const rule = RULES[task]
  if (!rule) return null

  const result = rule(state)
  const svc = SERVICES.find((s) => s.id === result.primary)
  if (!svc) return null

  return (
    <div className={styles.box}>
      <div className={styles.primary}>
        <span className={styles.dot} style={{ background: svc.color }} />
        <span className={styles.svcName}>{svc.name}</span>
      </div>
      <p className={styles.reason}>{result.reason}</p>
      {result.alts && result.alts.length > 0 && (
        <div className={styles.alts}>
          <span className={styles.altsLabel}>Alternatives</span>
          {result.alts.map((a) => (
            <div key={a} className={styles.altRow}>→ {a}</div>
          ))}
        </div>
      )}
    </div>
  )
}
