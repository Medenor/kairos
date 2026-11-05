import { describeDeletion } from '../providers/activeRun.js'
import styles from './DeleteProviderDialog.module.css'

// Confirmation before a provider is deleted (FR-004): names it, lists what is removed and what is kept,
// warns about a run in progress, and removes nothing until the explicit Delete.
// Props: provider (stored), runs, onConfirm(), onCancel().
export default function DeleteProviderDialog({ provider, runs = [], onConfirm, onCancel }) {
  const { willRemove, willKeep, runWarning } = describeDeletion(provider, runs)
  return (
    <div className={styles.dialog} role="alertdialog" aria-labelledby="delete-provider-title" aria-describedby="delete-provider-body">
      <h3 id="delete-provider-title" className={styles.title}>Delete {provider.name}?</h3>
      <div id="delete-provider-body" className={styles.body}>
        {runWarning && <p className={styles.warning} role="alert">{runWarning}</p>}
        <div className={styles.lists}>
          <div>
            <span className={styles.heading}>Will be removed</span>
            <ul className={styles.list}>{willRemove.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
          <div>
            <span className={styles.heading}>Will be kept</span>
            <ul className={styles.list}>{willKeep.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.danger} onClick={onConfirm}>Delete</button>
        <button type="button" className={styles.cancel} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
