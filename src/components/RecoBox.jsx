import { recommend } from '../routing/engine'
import styles from './RecoBox.module.css'

const CAUSE_LABELS = { not_suitable: 'not suitable', blocked: 'blocked', unread: 'no reading' }

// Props: task (id or null), providers (runtime services), state (quota state), now (shared Date).
// The recommendation is computed by the generic engine from what the user declared; this component
// only displays it, including why each other provider was left out.
export default function RecoBox({ task, providers, state, now }) {
  if (!task) {
    return (
      <div className={styles.box}>
        <p className={styles.empty}>Select a task type above to get a recommendation.</p>
      </div>
    )
  }

  const result = recommend({ task, providers, state, now })
  const colorOf = (id) => providers.find((p) => p.id === id)?.color || 'var(--color-border-md)'

  if (!result.primary) {
    return (
      <div className={styles.box}>
        <p className={styles.reason}>{result.reason}</p>
        <Excluded excluded={result.excluded} />
      </div>
    )
  }

  return (
    <div className={styles.box}>
      <div className={styles.primary}>
        <span className={styles.dot} style={{ background: colorOf(result.primary.providerId) }} />
        <span className={styles.svcName}>{result.primary.name}</span>
      </div>
      <p className={styles.reason}>{result.reason}</p>
      {result.alternatives.length > 0 && (
        <div className={styles.alts}>
          <span className={styles.altsLabel}>Alternatives</span>
          {result.alternatives.map((alt) => (
            <div key={alt.providerId} className={styles.altRow}>→ {alt.name} ({alt.role})</div>
          ))}
        </div>
      )}
      <Excluded excluded={result.excluded} />
    </div>
  )
}

function Excluded({ excluded }) {
  if (excluded.length === 0) return null
  return (
    <details className={styles.excluded}>
      <summary className={styles.altsLabel}>Left out ({excluded.length})</summary>
      {excluded.map((item) => (
        <div key={item.providerId} className={styles.altRow}>
          {item.name}: {CAUSE_LABELS[item.cause]} — {item.detail}
        </div>
      ))}
    </details>
  )
}
