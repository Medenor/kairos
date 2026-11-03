import { useState } from 'react'
import { exportLocalStateForMigration } from '../services/localExport'
import { runLocalStorageMigration, getMigrationStatus } from '../services/sharedStateApi'
import styles from './MigrationPanel.module.css'

export default function MigrationPanel({ workspaceId }) {
  const [status, setStatus] = useState(null)
  const [running, setRunning] = useState(false)

  const runMigration = async () => {
    if (!workspaceId || running) return
    setRunning(true)
    try {
      const payload = exportLocalStateForMigration(workspaceId)
      const key = `mig-${Date.now()}`
      const job = await runLocalStorageMigration(workspaceId, payload, key)
      const final = await getMigrationStatus(workspaceId, job.id)
      setStatus(final)
    } catch (error) {
      setStatus({ status: 'failed', error_report: [{ message: error.message }] })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <h3 className={styles.title}>LocalStorage Migration</h3>
        <button className={styles.button} onClick={runMigration} disabled={!workspaceId || running}>
          {running ? 'Migrating...' : 'Migrate Local Data'}
        </button>
      </div>
      {status && (
        <p className={styles.meta}>
          Status: <strong>{status.status}</strong> · migrated {status.migrated_records || 0} · skipped{' '}
          {status.skipped_records || 0} · failed {status.failed_records || 0}
        </p>
      )}
    </div>
  )
}
