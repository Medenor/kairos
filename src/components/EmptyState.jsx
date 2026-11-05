import styles from './EmptyState.module.css'

// Shown while no provider is declared (FR-001): nothing is pre-filled, so the first step is explained.
export default function EmptyState({ onAdd }) {
  return (
    <div className={styles.box}>
      <h2 className={styles.title}>No provider yet</h2>
      <p className={styles.text}>
        Kairos does not ship a provider list. Declare the AI subscriptions and pay-as-you-go balances you actually
        use, with their quotas and reset schedule, and Kairos recommends which one to use for each task.
      </p>
      <button type="button" className={styles.button} onClick={onAdd}>
        Add your first provider
      </button>
    </div>
  )
}
